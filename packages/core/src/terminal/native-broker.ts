// Experimental native-client boundary. Not imported by Bridge, Desktop or dashboard startup.
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
    private readonly supervisor: TerminalSupervisor,
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
        const prepared = this.supervisor.prepare(this.clientId, request.profileId);
        const view: View = { profile: prepared.profile };
        // Also retain denied preparations within the supervisor's fixed attempt cap.
        this.views.set(prepared.attemptId, view);
        const result = await this.confirm(document, generation, prepared.challenge, view);
        if (result !== 'confirmed') return { status: result };
        this.supervisor.launch(prepared.attemptId, this.proof(prepared.challenge, generation));
        return this.result(prepared.attemptId);
      }
      const id = request.instanceId;
      const view = this.views.get(id);
      if (!view) return { status: 'denied' }; // No adoption by session, PID or arbitrary instance ID.
      switch (request.action) {
        case 'attach': {
          if (view.attachment) return { status: 'denied' };
          const challenge = this.supervisor.requestAttach(this.clientId, id);
          const result = await this.confirm(document, generation, challenge, view);
          if (result !== 'confirmed') return { status: result };
          view.attachment = this.supervisor.attach(id, this.proof(challenge, generation));
          break;
        }
        case 'input': {
          if (!view.attachment) return { status: 'denied' };
          const challenge = this.supervisor.requestInput(id, view.attachment);
          const result = await this.confirm(document, generation, challenge, view);
          if (result !== 'confirmed') return { status: result };
          view.lease = this.supervisor.enableInput(
            id,
            view.attachment,
            this.proof(challenge, generation),
          );
          break;
        }
        case 'paste': {
          if (!view.attachment || !view.lease) return { status: 'denied' };
          const challenge = this.supervisor.requestPaste(
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
          this.supervisor.paste(
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
          const challenge = this.supervisor.requestStop(this.clientId, id, request.signal);
          const result = await this.confirm(document, generation, challenge, view, {
            signal: request.signal,
          });
          if (result !== 'confirmed') return { status: result };
          this.supervisor.stop(id, request.signal, this.proof(challenge, generation));
          break;
        }
        case 'write':
          if (!this.current(document, true) || !view.attachment || !view.lease)
            return { status: 'denied' };
          this.supervisor.write(id, view.attachment, view.lease, request.sequence, request.text);
          break;
        case 'resize':
          if (!view.attachment) return { status: 'denied' };
          this.supervisor.resize(id, view.attachment, request.columns, request.rows);
          break;
        case 'read':
          if (!view.attachment) return { status: 'denied' };
          return {
            status: 'ok',
            instanceId: id,
            output: this.supervisor.read(id, view.attachment, request.cursor),
          };
        case 'detach':
          if (!view.attachment) return { status: 'denied' };
          this.supervisor.detach(id, view.attachment);
          view.attachment = undefined;
          view.lease = undefined;
          break;
        case 'snapshot':
          break;
      }
      return this.result(id);
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
    for (const [id, view] of this.views) {
      view.lease = undefined;
      if (!view.attachment) continue;
      try {
        this.supervisor.revokeInput(id, view.attachment);
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
        this.supervisor.detach(id, view.attachment);
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
    if (!this.current(document, true)) return 'denied';
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

  private result(instanceId: string): TerminalNativeReply {
    return { status: 'ok', instanceId, snapshot: this.supervisor.snapshot(instanceId) };
  }
}
