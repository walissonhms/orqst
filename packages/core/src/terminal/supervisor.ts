// Owned Terminal library; the observer runtime never constructs this component.
import { randomUUID } from 'node:crypto';
import type { TerminalJournal, TerminalState } from '@orqst/protocol';
export type { TerminalState } from '@orqst/protocol';
import { TerminalAuthority, terminalDigest, type TerminalBinding } from './authority.js';
import { TerminalOutput } from './output.js';

export const terminalPolicy = Object.freeze({
  version: 1,
  activeInstances: 2,
  activeInstancesPerProject: 1,
  startupMs: 10_000,
  inputLeaseMs: 120_000,
  inputWriteBytes: 4096,
  inputBytesPerSecond: 16 * 1024,
  pasteBytes: 16 * 1024,
  replayBytes: 1024 * 1024,
  outputReadBytes: 64 * 1024,
  backendEventCodeUnits: 64 * 1024,
  resizePerSecond: 10,
  columns: Object.freeze([20, 300]),
  rows: Object.freeze([5, 100]),
});

export interface TerminalProfile {
  id: string;
  projectId: string;
  executable: string;
  executableSha256: string;
  executableVersion: string;
  argv: readonly string[];
  cwd: string;
  environmentProfile: string;
  permissions: string;
}
export interface TerminalEvents {
  started(): void;
  data(text: string): void;
  exit(exitCode: number, signal?: number): void;
  /** Private transport loss is uncertainty, never process exit evidence. */
  lost(): void;
}
export interface OwnedTerminalHandle {
  write(text: string): void;
  resize(cols: number, rows: number): void;
  signal(signal: 'SIGTERM' | 'SIGKILL'): void;
  /** Release listeners only. Must never signal the process. */
  dispose(): void;
}
export interface TerminalBackend {
  /** Revalidate the frozen profile before grant consumption; never launch or modify a process. */
  validate(profile: Readonly<TerminalProfile>): boolean;
  /** Must report started from backend evidence, never from arbitrary provider prose. */
  start(
    profile: Readonly<TerminalProfile>,
    events: TerminalEvents,
    identity?: { instanceId: string; epoch: string; manifestDigest: string },
  ): OwnedTerminalHandle;
}
interface Lease {
  id: string;
  clientId: string;
  expiresAt: number;
  sequence: number;
}
interface Attachment {
  generation: number;
  id: string;
  clientId: string;
  lease?: Lease;
}
interface Attempt {
  id: string;
  clientId: string;
  startExpiresAt: number;
  attachmentGeneration: number;
  rateAt: number;
  inputBytes: number;
  resizes: number;
  profile: Readonly<TerminalProfile>;
  digest: string;
  state: TerminalState;
  output: TerminalOutput;
  handle?: OwnedTerminalHandle;
  attachment?: Attachment;
  startupTimer?: ReturnType<typeof setTimeout>;
  exit?: { exitCode: number; signal?: number };
}

/** Owns only handles it creates. There is deliberately no PID/session adoption API. */
export class TerminalSupervisor {
  private profiles = new Map<string, Readonly<TerminalProfile>>();
  private attempts = new Map<string, Attempt>();
  private closed = false;

  constructor(
    private readonly authority: TerminalAuthority,
    private readonly backend: TerminalBackend,
    profiles: readonly TerminalProfile[],
    private readonly journal?: TerminalJournal,
  ) {
    if (journal && journal.epoch !== authority.epoch)
      throw new Error('Terminal journal epoch mismatch');
    journal?.assertOwner();
    if (profiles.length > 16) throw new Error('Terminal profile limit exceeded');
    for (const profile of profiles) {
      if (
        !profile.id ||
        profile.id.length > 128 ||
        !/^[a-f0-9]{64}$/.test(profile.executableSha256) ||
        !profile.executableVersion ||
        !profile.projectId ||
        profile.projectId.length > 128 ||
        this.profiles.has(profile.id) ||
        JSON.stringify(profile).length > 16 * 1024
      )
        throw new Error('Invalid terminal profile');
      this.profiles.set(
        profile.id,
        Object.freeze({ ...profile, argv: Object.freeze([...profile.argv]) }),
      );
    }
  }

  prepare(clientId: string, profileId: string) {
    if (this.closed) throw new Error('Terminal supervisor is closed');
    this.journal?.assertOwner();
    const profile = this.profiles.get(profileId);
    if (!profile || !this.validProfile(profile)) throw new Error('Terminal profile unavailable');
    // In-memory metadata remains bounded independently of optional durable retention.
    if (this.attempts.size >= 128) throw new Error('Terminal attempt limit exceeded');
    const id = randomUUID();
    const digest = terminalDigest(JSON.stringify([profile, terminalPolicy]));
    const challenge = this.authority.prepare(clientId, { operation: 'start', target: id, digest });
    this.journal?.prepare({
      instanceId: id,
      clientId,
      projectId: profile.projectId,
      manifestDigest: digest,
    });
    this.attempts.set(id, {
      id,
      clientId,
      startExpiresAt: challenge.expiresAt,
      profile,
      digest,
      state: 'prepared',
      attachmentGeneration: 0,
      output: new TerminalOutput(terminalPolicy.replayBytes),
      rateAt: this.authority.now(),
      inputBytes: 0,
      resizes: 0,
    });
    return { attemptId: id, profile, policy: terminalPolicy, challenge };
  }

  snapshot(id: string) {
    const attempt = this.get(id);
    this.owned(attempt);
    return {
      instanceId: id,
      epoch: this.authority.epoch,
      state: attempt.state,
      exit: attempt.exit && { ...attempt.exit },
    };
  }

  launch(id: string, proof: unknown): void {
    if (this.closed) throw new Error('Terminal supervisor is closed');
    const attempt = this.get(id);
    if (attempt.state !== 'prepared') throw new Error('Terminal attempt already used');
    const active = [...this.attempts.values()].filter((value) =>
      ['starting', 'running', 'ownership_lost'].includes(value.state),
    );
    if (
      active.length >= terminalPolicy.activeInstances ||
      active.some((value) => value.profile.projectId === attempt.profile.projectId)
    )
      throw new Error('Terminal admission limit exceeded');
    const valid = this.validProfile(attempt.profile);
    this.authority.consume(proof, { operation: 'start', target: id, digest: attempt.digest });
    if (!valid) {
      this.journal?.transition(id, 'start_failed');
      attempt.state = 'start_failed';
      return;
    }
    // Durable admission commits before a backend can have side effects. Never retry a proof.
    this.journal?.transition(id, 'starting');
    attempt.state = 'starting';
    try {
      attempt.startupTimer = setTimeout(() => this.lose(attempt), terminalPolicy.startupMs);
      attempt.startupTimer.unref();
      const start = () => {
        // Durable I/O may have delayed dispatch beyond the original one-use consent.
        if (
          !this.authority.isEnrolled(attempt.clientId) ||
          this.authority.now() >= attempt.startExpiresAt
        )
          throw new Error('Terminal start authorization expired');
        return this.backend.start(
          attempt.profile,
          {
            lost: () => this.lose(attempt),
            started: () => {
              if (attempt.state === 'starting') {
                if (!this.record(attempt, 'running')) return;
                attempt.state = 'running';
                clearTimeout(attempt.startupTimer);
              }
            },
            data: (text) => {
              if (!['starting', 'running'].includes(attempt.state)) return;
              if (!this.owned(attempt)) return;
              // A backend event is bounded too; no arbitrary allocation from an untrusted chunk.
              if (text.length > terminalPolicy.backendEventCodeUnits) return this.lose(attempt);
              try {
                attempt.output.append(Buffer.from(text));
              } catch {
                this.lose(attempt);
              }
            },
            exit: (exitCode, signal) => {
              if (!['starting', 'running'].includes(attempt.state)) return;
              if (
                !Number.isSafeInteger(exitCode) ||
                (signal !== undefined && !Number.isSafeInteger(signal))
              )
                return this.lose(attempt);
              const exit = { exitCode, ...(signal === undefined ? {} : { signal }) };
              if (!this.record(attempt, 'exited', exit)) return;
              attempt.state = 'exited';
              attempt.exit = exit;
              clearTimeout(attempt.startupTimer);
              if (attempt.attachment) attempt.attachment.lease = undefined;
              this.releaseHandle(attempt);
            },
          },
          { instanceId: id, epoch: this.authority.epoch, manifestDigest: attempt.digest },
        );
      };
      const handle = this.journal ? this.journal.withOwner(start) : start();
      attempt.handle = handle;
      if (['exited', 'ownership_lost'].includes(attempt.state)) this.releaseHandle(attempt);
    } catch {
      // A thrown start can have uncertain side effects. Never retry or signal a stored PID.
      this.lose(attempt);
    }
  }

  requestAttach(clientId: string, id: string) {
    if (this.closed) throw new Error('Terminal supervisor is closed');
    this.journal?.assertOwner();
    const attempt = this.get(id);
    if (!['running', 'exited'].includes(attempt.state)) throw new Error('Terminal unavailable');
    return this.authority.prepare(
      clientId,
      this.binding('attach', attempt, String(attempt.attachmentGeneration)),
    );
  }

  attach(id: string, proof: unknown): string {
    if (this.closed) throw new Error('Terminal supervisor is closed');
    this.journal?.assertOwner();
    const attempt = this.get(id);
    if (!['running', 'exited'].includes(attempt.state)) throw new Error('Terminal unavailable');
    if (attempt.attachment && this.authority.isEnrolled(attempt.attachment.clientId))
      throw new Error('Terminal already attached');
    const clientId = this.authority.consume(
      proof,
      this.binding('attach', attempt, String(attempt.attachmentGeneration)),
    );
    attempt.attachmentGeneration++;
    const attachmentId = randomUUID();
    attempt.attachment = {
      id: attachmentId,
      clientId,
      generation: 0,
    };
    return attachmentId;
  }

  detach(id: string, attachmentId: string): void {
    const attempt = this.get(id);
    this.attachment(attempt, attachmentId);
    attempt.attachment = undefined;
    attempt.attachmentGeneration++;
  }

  read(id: string, attachmentId: string, cursor: number) {
    const attempt = this.get(id);
    this.attachment(attempt, attachmentId);
    return attempt.output.read(cursor);
  }

  requestInput(id: string, attachmentId: string) {
    const attempt = this.live(id);
    const attachment = this.attachment(attempt, attachmentId);
    return this.authority.prepare(
      attachment.clientId,
      this.binding('input', attempt, JSON.stringify([attachmentId, attachment.generation])),
    );
  }

  enableInput(id: string, attachmentId: string, proof: unknown): string {
    const attempt = this.live(id);
    const attachment = this.attachment(attempt, attachmentId);
    const clientId = this.authority.consume(
      proof,
      this.binding('input', attempt, JSON.stringify([attachmentId, attachment.generation])),
    );
    if (clientId !== attachment.clientId) throw new Error('Terminal client mismatch');
    attachment.generation++;
    attachment.lease = {
      id: randomUUID(),
      clientId,
      expiresAt: this.authority.now() + terminalPolicy.inputLeaseMs,
      sequence: 0,
    };
    return attachment.lease.id;
  }

  /** Trusted native broker calls this on blur, navigation or transport loss. Never renews. */
  revokeInput(id: string, attachmentId: string): void {
    const attachment = this.attachment(this.get(id), attachmentId);
    attachment.lease = undefined;
    attachment.generation++;
  }

  write(id: string, attachmentId: string, leaseId: string, sequence: number, text: string): void {
    if (
      typeof text !== 'string' ||
      text.length > terminalPolicy.inputWriteBytes ||
      Buffer.byteLength(text) > terminalPolicy.inputWriteBytes
    )
      throw new Error('Terminal input limit exceeded');
    this.writeAuthorized(id, attachmentId, leaseId, sequence, text);
  }

  requestPaste(id: string, attachmentId: string, leaseId: string, sequence: number, text: string) {
    const attempt = this.live(id);
    const attachment = this.attachment(attempt, attachmentId);
    this.pasteSize(text);
    this.inputLease(attachment, leaseId, sequence);
    return this.authority.prepare(
      attachment.clientId,
      this.binding('paste', attempt, JSON.stringify([attachmentId, leaseId, sequence, text])),
    );
  }

  paste(
    id: string,
    attachmentId: string,
    leaseId: string,
    sequence: number,
    text: string,
    proof: unknown,
  ): void {
    const attempt = this.live(id);
    const attachment = this.attachment(attempt, attachmentId);
    this.pasteSize(text);
    this.inputLease(attachment, leaseId, sequence);
    this.authority.consume(
      proof,
      this.binding('paste', attempt, JSON.stringify([attachmentId, leaseId, sequence, text])),
    );
    this.writeAuthorized(id, attachmentId, leaseId, sequence, text);
  }

  resize(id: string, attachmentId: string, cols: number, rows: number): void {
    const attempt = this.live(id);
    this.attachment(attempt, attachmentId);
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 20 ||
      cols > 300 ||
      rows < 5 ||
      rows > 100
    )
      throw new Error('Invalid terminal dimensions');
    this.rate(attempt);
    if (++attempt.resizes > terminalPolicy.resizePerSecond)
      throw new Error('Terminal resize rate exceeded');
    this.effect(attempt, () => attempt.handle!.resize(cols, rows));
  }

  requestStop(clientId: string, id: string, signal: 'SIGTERM' | 'SIGKILL') {
    const attempt = this.live(id);
    this.validSignal(signal);
    return this.authority.prepare(clientId, this.binding('stop', attempt, signal));
  }

  stop(id: string, signal: 'SIGTERM' | 'SIGKILL', proof: unknown): void {
    const attempt = this.live(id);
    this.validSignal(signal);
    this.authority.consume(proof, this.binding('stop', attempt, signal));
    // A successful signal call is not exit evidence. Escalation needs another grant.
    this.effect(attempt, () => attempt.handle!.signal(signal));
  }

  /** Explicit Core teardown: revoke controls, retain uncertainty, never signal or retry. */
  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    for (const attempt of this.attempts.values()) {
      attempt.attachment = undefined;
      if (attempt.state === 'prepared') {
        this.record(attempt, 'start_failed');
        attempt.state = 'start_failed';
      } else if (['starting', 'running'].includes(attempt.state)) this.lose(attempt);
    }
    try {
      this.journal?.release();
    } catch {
      // An unavailable/fenced journal must not turn teardown into an implicit signal.
    }
  }

  private validProfile(profile: Readonly<TerminalProfile>): boolean {
    try {
      return this.backend.validate(profile) === true;
    } catch {
      return false;
    }
  }

  private pasteSize(text: string): void {
    if (
      typeof text !== 'string' ||
      text.length > terminalPolicy.pasteBytes ||
      Buffer.byteLength(text) > terminalPolicy.pasteBytes
    )
      throw new Error('Terminal paste limit exceeded');
  }

  private validSignal(signal: string): void {
    if (!['SIGTERM', 'SIGKILL'].includes(signal)) throw new Error('Invalid terminal stop signal');
  }

  private writeAuthorized(
    id: string,
    attachmentId: string,
    leaseId: string,
    sequence: number,
    text: string,
  ): void {
    const attempt = this.live(id);
    const attachment = this.attachment(attempt, attachmentId);
    const lease = this.inputLease(attachment, leaseId, sequence);
    this.rate(attempt);
    const bytes = Buffer.byteLength(text);
    if (!bytes || attempt.inputBytes + bytes > terminalPolicy.inputBytesPerSecond)
      throw new Error('Terminal input rate exceeded');
    attempt.inputBytes += bytes;
    lease.sequence++;
    this.effect(attempt, () => attempt.handle!.write(text));
  }

  private inputLease(attachment: Attachment, leaseId: string, sequence: number): Lease {
    const lease = attachment.lease;
    if (
      !lease ||
      lease.id !== leaseId ||
      lease.expiresAt <= this.authority.now() ||
      !this.authority.isEnrolled(lease.clientId) ||
      !Number.isSafeInteger(sequence) ||
      sequence !== lease.sequence
    )
      throw new Error('Terminal input authorization denied');
    return lease;
  }

  private rate(attempt: Attempt): void {
    if (this.authority.now() - attempt.rateAt >= 1000) {
      attempt.rateAt = this.authority.now();
      attempt.inputBytes = 0;
      attempt.resizes = 0;
    }
  }

  private binding(
    operation: TerminalBinding['operation'],
    attempt: Attempt,
    detail = '',
  ): TerminalBinding {
    return {
      operation,
      target: attempt.id,
      digest: terminalDigest(JSON.stringify([attempt.digest, detail])),
    };
  }

  private get(id: string): Attempt {
    const attempt = this.attempts.get(id);
    if (!attempt) throw new Error('Unknown terminal instance');
    return attempt;
  }

  private live(id: string): Attempt {
    const attempt = this.get(id);
    if (!this.owned(attempt)) throw new Error('Terminal journal ownership lost');
    if (attempt.state !== 'running' || !attempt.handle)
      throw new Error('Terminal is not owned and running');
    return attempt;
  }

  private attachment(attempt: Attempt, id: string): Attachment {
    if (!this.owned(attempt)) throw new Error('Terminal journal ownership lost');
    const attachment = attempt.attachment;
    if (!attachment || attachment.id !== id || !this.authority.isEnrolled(attachment.clientId))
      throw new Error('Terminal attachment unavailable');
    return attachment;
  }

  private effect(attempt: Attempt, operation: () => void): void {
    try {
      if (this.journal) this.journal.withOwner(operation);
      else operation();
    } catch {
      this.lose(attempt);
      throw new Error('Terminal effect uncertain; input revoked');
    }
  }

  private lose(attempt: Attempt): void {
    if (['exited', 'start_failed'].includes(attempt.state)) return;
    if (attempt.state !== 'ownership_lost') {
      try {
        this.journal?.transition(attempt.id, 'ownership_lost');
      } catch {
        // Keep the last durable state uncertain; recovery must never infer an exit.
      }
    }
    attempt.state = 'ownership_lost';
    attempt.attachment = undefined;
    clearTimeout(attempt.startupTimer);
    this.releaseHandle(attempt);
  }

  private owned(attempt: Attempt): boolean {
    try {
      this.journal?.assertOwner();
      return true;
    } catch {
      this.lose(attempt);
      return false;
    }
  }

  private record(attempt: Attempt, state: TerminalState, exit?: Attempt['exit']): boolean {
    try {
      this.journal?.transition(attempt.id, state, exit);
      return true;
    } catch {
      this.lose(attempt);
      return false;
    }
  }

  private releaseHandle(attempt: Attempt): void {
    const handle = attempt.handle;
    attempt.handle = undefined;
    try {
      handle?.dispose();
    } catch {
      // Disposal cannot authorize a signal or erase already confirmed exit evidence.
    }
  }
}
