// Native-client boundary; never exposed by the observer Bridge or dashboard startup.
import { sign, type KeyObject } from 'node:crypto';
import { terminalNativeRequestSchema, type TerminalNativeConfirmation } from '@orqst/protocol';
import {
  terminalChallengeBytes,
  type TerminalAuthority,
  type TerminalChallenge,
} from './authority.js';
import type { TerminalCliAuthorization } from './cli-authorization.js';
import { terminalPolicy, type TerminalProfile, type TerminalSupervisor } from './supervisor.js';

export type TerminalConfirmation = TerminalNativeConfirmation;
export interface TerminalNativeHost<Document extends object> {
  /** Trusted native object/document identity; never page-provided origin, focus or click claims. */
  current(document: Document, requireFocus: boolean): boolean;
  /** Must present a native confirmation, Cancel by default. No renderer answer is accepted. */
  confirm(document: Document, details: TerminalConfirmation): Promise<boolean>;
  /** Native-owned policy only; never provided by a renderer or an observed session. */
  cliAuthorization?: TerminalCliAuthorization<Document>;
}
export type TerminalNativeReply =
  | { status: 'denied' | 'cancelled' | 'busy'; authorization?: 'blocked' | 'revoked' }
  | {
      status: 'ok';
      instanceId: string;
      opening?: 'ready' | 'incomplete';
      snapshot?: ReturnType<TerminalSupervisor['snapshot']>;
      output?: { bytes: Uint8Array; nextCursor: number; gap: boolean };
    };
export type TerminalNativeSupervisor = {
  [
    Method in
      | 'prepare'
      | 'launch'
      | 'snapshot'
      | 'canvasSessionEvidence'
      | 'requestAttach'
      | 'attach'
      | 'requestInput'
      | 'enableInput'
      | 'requestPaste'
      | 'paste'
      | 'requestStop'
      | 'stop'
      | 'write'
      | 'resize'
      | 'read'
      | 'detach'
      | 'revokeInput'
  ]: (
    ...args: Parameters<TerminalSupervisor[Method]>
  ) => ReturnType<TerminalSupervisor[Method]> | Promise<ReturnType<TerminalSupervisor[Method]>>;
};

interface View {
  profile: Readonly<TerminalProfile>;
  attachment?: string;
  lease?: string;
  policyEpoch?: string;
  leaseExpiresAt?: number;
  inputSequence?: number;
  leaseSequence?: number;
  inputUncertain?: boolean;
}

/** One enrolled native document. Signatures, leases and attachment IDs never cross IPC. */
export class TerminalNativeBroker<Document extends object> {
  private generation = 0;
  private busy = false;
  private closed = false;
  private views = new Map<string, View>();

  constructor(
    private readonly authority: TerminalAuthority,
    private readonly supervisor: TerminalNativeSupervisor,
    private readonly clientId: string,
    private readonly privateKey: KeyObject,
    private readonly document: Document,
    private readonly host: TerminalNativeHost<Document>,
  ) {
    if (
      !authority.isEnrolled(clientId) ||
      privateKey.type !== 'private' ||
      privateKey.asymmetricKeyType !== 'ed25519'
    )
      throw new Error('Invalid native terminal enrollment');
  }

  async dispatch(document: Document, raw: unknown): Promise<TerminalNativeReply> {
    if (!this.current(document, false)) return { status: 'denied' };
    const parsed = terminalNativeRequestSchema.safeParse(raw);
    if (!parsed.success) return { status: 'denied' };
    if (this.busy) return { status: 'busy' };
    this.busy = true;
    const request = parsed.data;
    const generation = this.generation;
    try {
      if (request.action === 'start' || request.action === 'open') {
        const prepared = await this.supervisor.prepare(this.clientId, request.profileId);
        const view: View = { profile: prepared.profile };
        // Also retain denied preparations within the supervisor's fixed attempt cap.
        this.views.set(prepared.attemptId, view);
        const result = await this.confirm(
          document,
          generation,
          prepared.challenge,
          view,
          {},
          request.action === 'open' ? 'open' : undefined,
        );
        if (result !== 'confirmed') return this.refusal(result, view);
        if (request.action === 'open') {
          // One explicit native review covers these three operations on this exact
          // immutable profile. Each operation still consumes its own signed challenge.
          try {
            await this.supervisor.launch(
              prepared.attemptId,
              this.proof(prepared.challenge, generation),
            );
            const attach = await this.supervisor.requestAttach(this.clientId, prepared.attemptId);
            view.attachment = await this.supervisor.attach(
              prepared.attemptId,
              this.proof(attach, generation, prepared.challenge.expiresAt),
            );
            const input = await this.supervisor.requestInput(prepared.attemptId, view.attachment);
            view.lease = await this.supervisor.enableInput(
              prepared.attemptId,
              view.attachment,
              this.proof(input, generation, prepared.challenge.expiresAt),
            );
            this.inputEnabled(view);
            const result = await this.result(prepared.attemptId);
            // The final snapshot is asynchronous too. Neither it nor fresh later
            // challenges may renew the original combined review's deadline.
            this.assertCurrent(input, generation, prepared.challenge.expiresAt);
            if (!view.attachment || !view.lease) throw new Error('Native grants revoked');
            return { ...result, opening: 'ready' };
          } catch {
            // Launch may have succeeded. Keep its identity/receipt; never retry,
            // signal, or adopt it. Remove only this document's output/input grants.
            view.lease = undefined;
            if (view.attachment) {
              const attachment = view.attachment;
              view.attachment = undefined;
              try {
                await this.supervisor.revokeInput(prepared.attemptId, attachment);
              } catch {
                /* Already unavailable. */
              }
              try {
                await this.supervisor.detach(prepared.attemptId, attachment);
              } catch {
                /* Already unavailable. */
              }
            }
            return { status: 'ok', instanceId: prepared.attemptId, opening: 'incomplete' };
          }
        }
        await this.supervisor.launch(
          prepared.attemptId,
          this.proof(prepared.challenge, generation),
        );
        return await this.result(prepared.attemptId);
      }
      const id = request.instanceId;
      const view = this.views.get(id);
      if (!view) return { status: 'denied' }; // No adoption by session, PID or arbitrary instance ID.
      if (
        this.host.cliAuthorization &&
        !['read', 'snapshot', 'detach', 'resize', 'stop'].includes(request.action) &&
        !this.policyCurrent(view)
      )
        return this.refusal('denied', view);
      switch (request.action) {
        case 'attach': {
          if (view.attachment) return { status: 'denied' };
          const challenge = await this.supervisor.requestAttach(this.clientId, id);
          const result = await this.confirm(document, generation, challenge, view);
          if (result !== 'confirmed') return this.refusal(result, view);
          const attachment = await this.supervisor.attach(id, this.proof(challenge, generation));
          if (generation !== this.generation || !this.current(document, true)) {
            await this.supervisor.detach(id, attachment);
            return { status: 'denied' };
          }
          view.attachment = attachment;
          break;
        }
        case 'input': {
          if (this.host.cliAuthorization && view.inputUncertain) return { status: 'denied' };
          if (!view.attachment) return { status: 'denied' };
          const challenge = await this.supervisor.requestInput(id, view.attachment);
          const result = await this.confirm(document, generation, challenge, view);
          if (result !== 'confirmed') return this.refusal(result, view);
          const lease = await this.supervisor.enableInput(
            id,
            view.attachment,
            this.proof(challenge, generation),
          );
          if (generation !== this.generation || !this.current(document, true)) {
            await this.supervisor.revokeInput(id, view.attachment);
            return { status: 'denied' };
          }
          view.lease = lease;
          this.inputEnabled(view);
          break;
        }
        case 'paste': {
          await this.resumeInput(id, view, generation);
          if (!view.attachment || !view.lease) return { status: 'denied' };
          const challenge = await this.supervisor.requestPaste(
            id,
            view.attachment,
            view.lease,
            this.sequence(view, request.sequence),
            request.text,
          );
          const result = await this.confirm(document, generation, challenge, view, {
            paste: request.text,
          });
          if (result !== 'confirmed') return this.refusal(result, view);
          const sequence = this.consumeSequence(view, request.sequence);
          await this.supervisor.paste(
            id,
            view.attachment,
            view.lease,
            sequence,
            request.text,
            this.proof(challenge, generation),
          );
          view.inputUncertain = false;
          break;
        }
        case 'stop': {
          const challenge = await this.supervisor.requestStop(this.clientId, id, request.signal);
          const result = await this.confirm(document, generation, challenge, view, {
            signal: request.signal,
          });
          if (result !== 'confirmed') return this.refusal(result, view);
          await this.supervisor.stop(id, request.signal, this.proof(challenge, generation));
          break;
        }
        case 'write':
          await this.resumeInput(id, view, generation);
          if (
            generation !== this.generation ||
            !this.current(document, true) ||
            !view.attachment ||
            !view.lease
          )
            return { status: 'denied' };
          await this.supervisor.write(
            id,
            view.attachment,
            view.lease,
            this.consumeSequence(view, request.sequence),
            request.text,
          );
          view.inputUncertain = false;
          break;
        case 'resize':
          if (!view.attachment) return { status: 'denied' };
          await this.supervisor.resize(id, view.attachment, request.columns, request.rows);
          break;
        case 'read':
          if (!view.attachment) return { status: 'denied' };
          return {
            status: 'ok',
            instanceId: id,
            output: await this.supervisor.read(id, view.attachment, request.cursor),
          };
        case 'detach':
          if (!view.attachment) return { status: 'denied' };
          await this.supervisor.detach(id, view.attachment);
          view.attachment = undefined;
          view.lease = undefined;
          break;
        case 'snapshot':
          break;
      }
      return await this.result(id);
    } catch {
      // Never expose backend diagnostics, private paths or input in an IPC error.
      return { status: 'denied' };
    } finally {
      this.busy = false;
    }
  }

  /** Native blur/transport loss. Invalidates pending dialogs and leases, never signals. */
  revokeInput(): void {
    this.generation++;
    this.clearInputLeases(true);
  }

  /** Owned native sheet: revoke leases without renewing or replacing its pending review. */
  suspendInput(): void {
    this.clearInputLeases(false);
  }

  private clearInputLeases(invalidateAttachments: boolean): void {
    for (const [id, view] of this.views) {
      const hadLease = view.lease !== undefined;
      view.lease = undefined;
      // A sheet must revoke an existing lease. With no lease, changing the
      // attachment generation would cancel the explicit first input review itself.
      if (!view.attachment || (!invalidateAttachments && !hadLease)) continue;
      try {
        void Promise.resolve(this.supervisor.revokeInput(id, view.attachment)).catch(() => {});
      } catch {
        /* Already unavailable. */
      }
    }
  }

  /** Navigation/destruction: permanently revoke this document; leave Core's work alive. */
  close(): void {
    this.revokeInput();
    for (const [id, view] of this.views) {
      if (!view.attachment) continue;
      try {
        void Promise.resolve(this.supervisor.detach(id, view.attachment)).catch(() => {});
      } catch {
        /* Already unavailable. */
      }
      view.attachment = undefined;
    }
    this.authority.revoke(this.clientId);
    this.closed = true;
  }

  private current(document: Document, focus: boolean): boolean {
    try {
      return (
        !this.closed &&
        document === this.document &&
        this.authority.isEnrolled(this.clientId) &&
        this.host.current(document, focus)
      );
    } catch {
      return false;
    }
  }

  private async confirm(
    document: Document,
    generation: number,
    challenge: TerminalChallenge,
    view: View,
    detail: Pick<TerminalConfirmation, 'signal' | 'paste'> = {},
    operation?: 'open',
  ): Promise<'confirmed' | 'denied' | 'cancelled'> {
    if (generation !== this.generation || !this.current(document, true)) return 'denied';
    if (challenge.operation === 'retire' || challenge.operation === 'delegate') return 'denied';
    if (this.host.cliAuthorization) {
      const policy = this.host.cliAuthorization;
      if (challenge.operation === 'start') {
        const status = await policy.authorizeCli(document, view.profile);
        if (status !== 'allowed') return 'denied';
        view.policyEpoch = policy.epoch(view.profile);
      }
      if (challenge.operation !== 'stop' && !this.policyCurrent(view)) return 'denied';
      this.assertCurrent(challenge, generation);
      return 'confirmed';
    }
    const accepted = await this.host.confirm(
      document,
      Object.freeze({
        operation: operation ?? challenge.operation,
        instanceId: challenge.target,
        profile: view.profile,
        policy: terminalPolicy,
        ...detail,
      }),
    );
    if (!accepted) return 'cancelled';
    if (
      generation !== this.generation ||
      !this.current(document, true) ||
      challenge.expiresAt <= this.authority.now()
    )
      return 'denied';
    return 'confirmed';
  }

  private assertCurrent(
    challenge: TerminalChallenge,
    generation: number,
    consentExpiresAt = challenge.expiresAt,
  ): void {
    // Recheck synchronously at the effect boundary, after the asynchronous dialog.
    if (
      generation !== this.generation ||
      !this.current(this.document, true) ||
      Math.min(challenge.expiresAt, consentExpiresAt) <= this.authority.now()
    )
      throw new Error('Native grant revoked');
  }

  private proof(challenge: TerminalChallenge, generation: number, consentExpiresAt?: number) {
    this.assertCurrent(challenge, generation, consentExpiresAt);
    const view = this.views.get(challenge.target);
    if (
      this.host.cliAuthorization &&
      (!view || (challenge.operation !== 'stop' && !this.policyCurrent(view)))
    )
      throw new Error('CLI policy revoked');
    return {
      challengeId: challenge.challengeId,
      signature: sign(null, terminalChallengeBytes(challenge), this.privateKey).toString(
        'base64url',
      ),
    };
  }

  /** Release authority is tied to this owned attempt, independent of revoked CLI-use policy. */
  ownsRetirementAttempt(instanceId: string): boolean {
    return !this.closed && this.views.has(instanceId);
  }

  private policyCurrent(view: View): boolean {
    const policy = this.host.cliAuthorization;
    return (
      !!policy &&
      !!view.policyEpoch &&
      policy.current(this.document, view.profile) === 'allowed' &&
      policy.epoch(view.profile) === view.policyEpoch
    );
  }

  private refusal(status: 'denied' | 'cancelled', view: View): TerminalNativeReply {
    if (!this.host.cliAuthorization) return { status };
    const current = this.host.cliAuthorization.current(this.document, view.profile);
    if (
      current === 'allowed' &&
      view.policyEpoch === this.host.cliAuthorization.epoch(view.profile)
    )
      return { status };
    return { status, authorization: current === 'blocked' ? 'blocked' : 'revoked' };
  }

  private inputEnabled(view: View, resetSequence = true): void {
    if (!this.host.cliAuthorization) return;
    view.leaseExpiresAt = this.authority.now() + terminalPolicy.inputLeaseMs - 1000;
    view.leaseSequence = 0;
    if (resetSequence) view.inputSequence = 0;
  }

  /** Focus only resumes an existing owned view under the same policy epoch. Never adopts. */
  private async resumeInput(id: string, view: View, generation: number): Promise<void> {
    if (!this.host.cliAuthorization) return;
    if (
      !this.current(this.document, true) ||
      !this.policyCurrent(view) ||
      !view.attachment ||
      view.inputSequence === undefined ||
      view.inputUncertain
    )
      throw new Error('Input is unavailable');
    if (view.lease && (view.leaseExpiresAt ?? 0) > this.authority.now()) return;
    const challenge = await this.supervisor.requestInput(id, view.attachment);
    const lease = await this.supervisor.enableInput(
      id,
      view.attachment,
      this.proof(challenge, generation),
    );
    try {
      this.assertCurrent(challenge, generation);
      if (!this.policyCurrent(view)) throw new Error('CLI policy revoked');
      view.lease = lease;
    } catch (error) {
      view.lease = undefined;
      await this.supervisor.revokeInput(id, view.attachment);
      throw error;
    }
    this.inputEnabled(view, false);
  }

  private sequence(view: View, sequence: number): number {
    if (!this.host.cliAuthorization) return sequence;
    if (view.inputUncertain || sequence !== view.inputSequence || view.leaseSequence === undefined)
      throw new Error('Input sequence mismatch');
    return view.leaseSequence;
  }

  private consumeSequence(view: View, sequence: number): number {
    const nativeSequence = this.sequence(view, sequence);
    if (this.host.cliAuthorization) {
      view.inputSequence!++;
      view.leaseSequence!++;
      view.inputUncertain = true;
    }
    return nativeSequence;
  }

  private async result(instanceId: string) {
    return {
      status: 'ok' as const,
      instanceId,
      snapshot: await this.supervisor.snapshot(instanceId),
    };
  }
}
