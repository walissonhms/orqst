import type { TerminalJournal } from '@orqst/protocol';
import { TerminalAuthority, terminalDigest } from './authority.js';
import { terminalRPCSchema } from './rpc.js';
import { TerminalSupervisor, type TerminalBackend, type TerminalProfile } from './supervisor.js';

export interface TerminalPairAdmission {
  claim(): void;
  assertOwner(): void;
  prepareRelease(evidence: unknown): () => void;
}
interface PairEvidence {
  epoch: string;
  attempts: Array<ReturnType<TerminalSupervisor['snapshot']> & { slot: number }>;
}

/** One Node owner, at most two independent slots. No provider semantics are inferred from PTY text. */
export class ManagedTerminalPair {
  private slots: TerminalSupervisor[];
  private journals: TerminalJournal[];
  private attempts: Array<Set<string>>;
  private dispatched = new Set<string>();
  private reserved = false;
  private fenced = false;
  private retired = false;
  private retirement?: PairEvidence;
  private finishRetirement?: () => void;

  constructor(
    private authority: TerminalAuthority,
    slots: Array<{
      profiles: TerminalProfile[];
      backend: TerminalBackend;
      journal: TerminalJournal;
    }>,
    private admission: TerminalPairAdmission,
  ) {
    if (slots.length < 1 || slots.length > 2) throw new Error('One or two slots required');
    this.attempts = slots.map(() => new Set());
    this.journals = slots.map((slot) => slot.journal);
    this.slots = slots.map(
      ({ profiles, backend, journal }) =>
        new TerminalSupervisor(
          authority,
          {
            validate: (profile) => backend.validate(profile),
            start: (profile, events, identity) => {
              this.active();
              // Supervisor consumed the native proof and durably recorded starting before this call.
              admission.claim();
              this.reserved = true;
              admission.assertOwner();
              if (!identity) throw new Error('Owned terminal identity required');
              this.dispatched.add(identity.instanceId);
              return backend.start(profile, events, identity);
            },
          },
          profiles,
          journal,
        ),
    );
  }

  dispatch(slot: number, raw: unknown): unknown {
    this.active();
    const supervisor = this.slots[slot];
    if (!supervisor) throw new Error('Unknown terminal slot');
    const request = terminalRPCSchema.parse(raw);
    if (this.reserved && request.operation !== 'snapshot') this.admission.assertOwner();
    switch (request.operation) {
      case 'prepare': {
        const prepared = supervisor.prepare(...request.args);
        this.attempts[slot]!.add(prepared.attemptId);
        return prepared;
      }
      case 'launch':
        return supervisor.launch(...request.args);
      case 'snapshot':
        return supervisor.snapshot(...request.args);
      case 'requestAttach':
        return supervisor.requestAttach(...request.args);
      case 'attach':
        return supervisor.attach(...request.args);
      case 'requestInput':
        return supervisor.requestInput(...request.args);
      case 'enableInput':
        return supervisor.enableInput(...request.args);
      case 'requestPaste':
        return supervisor.requestPaste(...request.args);
      case 'paste':
        return supervisor.paste(...request.args);
      case 'requestStop':
        return supervisor.requestStop(...request.args);
      case 'stop':
        return supervisor.stop(...request.args);
      case 'write':
        return supervisor.write(...request.args);
      case 'resize':
        return supervisor.resize(...request.args);
      case 'read': {
        const output = supervisor.read(...request.args);
        return { ...output, bytes: Array.from(output.bytes) };
      }
      case 'detach':
        return supervisor.detach(...request.args);
      case 'revokeInput':
        return supervisor.revokeInput(...request.args);
    }
  }

  private evidence(): PairEvidence {
    if (!this.reserved || this.retired) throw new Error('No retirable terminal reservation');
    this.admission.assertOwner();
    if (this.retirement) return this.retirement;
    for (const journal of this.journals) journal.assertOwner();
    const attempts = this.attempts.flatMap((ids, slot) =>
      [...ids].map((id) => ({ slot, ...this.slots[slot]!.snapshot(id) })),
    );
    if (
      attempts.some(
        (attempt) =>
          !['prepared', 'exited', 'start_failed'].includes(attempt.state) ||
          (this.dispatched.has(attempt.instanceId) &&
            (attempt.state !== 'exited' || !attempt.exit)),
      )
    )
      throw new Error('Every dispatched terminal requires its owned exit');
    return { epoch: this.authority.epoch, attempts };
  }

  prepareRetire() {
    const evidence = this.evidence();
    return {
      evidence,
      challenge: this.authority.prepare('desktop-managed', {
        operation: 'retire',
        target: this.authority.epoch,
        digest: terminalDigest(JSON.stringify(evidence)),
      }),
    };
  }

  retire(proof: unknown) {
    const evidence = this.evidence();
    this.authority.consume(proof, {
      operation: 'retire',
      target: this.authority.epoch,
      digest: terminalDigest(JSON.stringify(evidence)),
    });
    if (!this.finishRetirement) {
      const finish = this.admission.prepareRelease(evidence);
      this.retirement = evidence;
      this.finishRetirement = finish;
      this.close(); // Fence all dispatch before releasing shared capacity.
    }
    this.finishRetirement();
    this.retired = true;
  }

  closeSlot(slot: number) {
    this.slots[slot]?.shutdown();
  }

  close() {
    if (this.fenced) return;
    this.fenced = true;
    for (const supervisor of this.slots) supervisor.shutdown();
  }

  private active() {
    if (this.fenced || this.retired) throw new Error('Terminal pair is fenced');
  }
}
