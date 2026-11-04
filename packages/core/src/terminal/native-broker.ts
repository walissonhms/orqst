// Native-client boundary; never exposed by the observer Bridge or dashboard startup.
import { sign, type KeyObject } from 'node:crypto';
import { terminalNativeRequestSchema, type TerminalNativeConfirmation } from '@orqst/protocol';
import {
  terminalChallengeBytes,
  type TerminalAuthority,
  type TerminalChallenge,
} from './authority.js';
import { terminalPolicy, type TerminalProfile, type TerminalSupervisor } from './supervisor.js';

export type TerminalConfirmation = TerminalNativeConfirmation;
export interface TerminalNativeHost<Document extends object> {
  /** Trusted native object/document identity; never page-provided origin, focus or click claims. */
  current(document: Document, requireFocus: boolean): boolean;
  /** Must present a native confirmation, Cancel by default. No renderer answer is accepted. */
  confirm(document: Document, details: TerminalConfirmation): Promise<boolean>;
}
export type TerminalNativeReply =
  | { status: 'denied' | 'cancelled' | 'busy' }
  | {
      status: 'ok';
      instanceId: string;
      snapshot?: ReturnType<TerminalSupervisor['snapshot']>;
      output?: { bytes: Uint8Array; nextCursor: number; gap: boolean };
    };
export type TerminalNativeSupervisor = {
  [
    Method in
      | 'prepare'
      | 'launch'
      | 'snapshot'
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
      if (request.action === 'start') {
        const prepared = await this.supervisor.prepare(this.clientId, request.profileId);
        const view: View = { profile: prepared.profile };
        // Also retain denied preparations within the supervisor's fixed attempt cap.
        this.views.set(prepared.attemptId, view);
        const result = await this.confirm(document, generation, prepared.challenge, view);
        if (result !== 'confirmed') return { status: result };
        await this.supervisor.launch(
          prepared.attemptId,
          this.proof(prepared.challenge, generation),
        );
        return await this.result(prepared.attemptId);
      }
      const id = request.instanceId;
      const view = this.views.get(id);
      if (!view) return { status: 'denied' }; // No adoption by session, PID or arbitrary instance ID.
      switch (request.action) {
        case 'attach': {
          if (view.attachment) return { status: 'denied' };
          const challenge = await this.supervisor.requestAttach(this.clientId, id);
          const result = await this.confirm(document, generation, challenge, view);
          if (result !== 'confirmed') return { status: result };
          const attachment = await this.supervisor.attach(id, this.proof(challenge, generation));
          if (generation !== this.generation || !this.current(document, true)) {
            await this.supervisor.detach(id, attachment);
            return { status: 'denied' };
          }
          view.attachment = attachment;
          break;
        }
        case 'input': {
          if (!view.attachment) return { status: 'denied' };
          const challenge = await this.supervisor.requestInput(id, view.attachment);
          const result = await this.confirm(document, generation, challenge, view);
          if (result !== 'confirmed') return { status: result };
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
          break;
        }
        case 'paste': {
          if (!view.attachment || !view.lease) return { status: 'denied' };
          const challenge = await this.supervisor.requestPaste(
            id,
            view.attachment,
            view.lease,
            request.sequence,
            request.text,
          );
          const result = await this.confirm(document, generation, challenge, view, {
            paste: request.text,
          });
          if (result !== 'confirmed') return { status: result };
          await this.supervisor.paste(
            id,
            view.attachment,
            view.lease,
            request.sequence,
            request.text,
            this.proof(challenge, generation),
          );
          break;
        }
        case 'stop': {
          const challenge = await this.supervisor.requestStop(this.clientId, id, request.signal);
          const result = await this.confirm(document, generation, challenge, view, {
            signal: request.signal,
          });
          if (result !== 'confirmed') return { status: result };
          await this.supervisor.stop(id, request.signal, this.proof(challenge, generation));
          break;
        }
        case 'write':
          if (!this.current(document, true) || !view.attachment || !view.lease)
            return { status: 'denied' };
          await this.supervisor.write(
            id,
            view.attachment,
            view.lease,
            request.sequence,
            request.text,
          );
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
  ): Promise<'confirmed' | 'denied' | 'cancelled'> {
    if (generation !== this.generation || !this.current(document, true)) return 'denied';
    if (challenge.operation === 'retire' || challenge.operation === 'delegate') return 'denied';
    const accepted = await this.host.confirm(
      document,
      Object.freeze({
        operation: challenge.operation,
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

  private proof(challenge: TerminalChallenge, generation: number) {
    // Recheck synchronously at the effect boundary, after the asynchronous dialog.
    if (
      generation !== this.generation ||
      !this.current(this.document, true) ||
      challenge.expiresAt <= this.authority.now()
    )
      throw new Error('Native grant revoked');
    return {
      challengeId: challenge.challengeId,
      signature: sign(null, terminalChallengeBytes(challenge), this.privateKey).toString(
        'base64url',
      ),
    };
  }

  private async result(instanceId: string): Promise<TerminalNativeReply> {
    return { status: 'ok', instanceId, snapshot: await this.supervisor.snapshot(instanceId) };
  }
}
