import {
  terminalSlotLimit,
  terminalEnrollmentInputSchema,
  terminalEnrollmentMemberSchema,
  type TerminalEnrollmentInput,
  type TerminalEnrollmentMember,
  type TerminalEnrollmentReceipt,
  type TerminalJournal,
} from '@orqst/protocol';
import { TerminalAuthority, terminalDigest } from './authority.js';
import { terminalRPCSchema } from './rpc.js';
import {
  TerminalSupervisor,
  type TerminalBackend,
  type TerminalProfile,
  type TerminalStartBinding,
} from './supervisor.js';

export interface TerminalPairAdmission {
  preflight?(): void;
  claim(): void;
  assertOwner(): void;
  prepareRelease(evidence: unknown): () => void;
  reserveEnrollment?(record: {
    input: TerminalEnrollmentInput;
    manifestFile: string;
    member: TerminalEnrollmentMember;
  }): (receipt: TerminalEnrollmentReceipt) => void;
}
export interface TerminalPairSlot {
  profiles: TerminalProfile[];
  backend: TerminalBackend;
  journal: TerminalJournal;
}
interface PairEvidence {
  epoch: string;
  attempts: Array<ReturnType<TerminalSupervisor['snapshot']> & { slot: number }>;
}

/** One Node owner, a bounded team of independent slots. No provider semantics are inferred from PTY text. */
export class ManagedTerminalPair {
  private slots: Array<TerminalSupervisor | undefined>;
  private journals: TerminalJournal[];
  private attempts: Array<Set<string>>;
  private dispatched = new Set<string>();
  private reserved = false;
  private fenced = false;
  private retired = false;
  private retirement?: PairEvidence;
  private finishRetirement?: () => void;
  private capacity: number;
  private revision = 0;
  private enrollments = new Map<string, { key: string; receipt: TerminalEnrollmentReceipt }>();
  private enrolledMembers: TerminalEnrollmentMember[] = [];

  constructor(
    private authority: TerminalAuthority,
    slots: TerminalPairSlot[],
    private admission: TerminalPairAdmission,
    limit?: number,
  ) {
    this.capacity = terminalSlotLimit(limit);
    if (slots.length < 1 || slots.length > this.capacity)
      throw new Error('Terminal slots exceed configured capacity');
    this.attempts = slots.map(() => new Set());
    this.journals = slots.map((slot) => slot.journal);
    this.slots = slots.map((slot) => this.supervisor(slot));
  }

  private supervisor(
    { profiles, backend, journal }: TerminalPairSlot,
    startBinding?: TerminalStartBinding,
  ) {
    const admission = this.admission;
    return new TerminalSupervisor(
      this.authority,
      {
        validate: (profile) => backend.validate(profile),
        preflight: () => {
          this.active();
          backend.preflight?.();
          admission.preflight?.();
          if (this.reserved) admission.assertOwner();
        },
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
      startBinding,
    );
  }

  /** Read-only: receipt lookup never retries an effect or changes the current selection. */
  enrollmentInspect(opId?: string) {
    this.active();
    return structuredClone({
      version: 1 as const,
      epoch: this.authority.epoch,
      revision: this.revision,
      capacity: this.capacity,
      reservedSlots: this.slots.length,
      members: this.enrolledMembers,
      receipt: opId ? (this.enrollments.get(opId)?.receipt ?? null) : null,
    });
  }

  /** Append one slot on this owner. Inspection must be read-only; create may open a journal. */
  enroll(
    raw: TerminalEnrollmentInput,
    manifestFile: string,
    inspect: () => {
      member: Omit<TerminalEnrollmentMember, 'slot' | 'admissionRevision' | 'status'>;
      create(): TerminalPairSlot;
    },
  ): TerminalEnrollmentReceipt {
    this.active();
    const input = terminalEnrollmentInputSchema.parse(raw);
    if (input.epoch !== this.authority.epoch) throw new Error('Enrollment epoch changed');
    const key = terminalDigest(JSON.stringify([input, manifestFile]));
    const previous = this.enrollments.get(input.opId);
    if (previous) {
      if (previous.key !== key) throw new Error('Enrollment operation rebound');
      return structuredClone(previous.receipt);
    }
    if (this.enrollments.size >= 128) throw new Error('Enrollment operation budget exceeded');
    const save = (receipt: TerminalEnrollmentReceipt) => {
      this.enrollments.set(input.opId, { key, receipt: structuredClone(receipt) });
      return structuredClone(receipt);
    };
    const rejected = (reason: TerminalEnrollmentReceipt['reason']) =>
      save({ ...input, revision: this.revision, status: 'rejected', reason, member: null });
    if (input.expectedRevision !== this.revision) return rejected('revision_conflict');
    if (this.slots.length >= this.capacity) return rejected('capacity');
    if (this.enrolledMembers.some((member) => member.status !== 'ready'))
      return rejected('effect_uncertain');
    let candidate: ReturnType<typeof inspect>;
    try {
      if (!this.admission.reserveEnrollment) throw new Error('Incremental admission unavailable');
      this.admission.preflight?.();
      candidate = inspect();
      terminalEnrollmentMemberSchema.parse({
        ...candidate.member,
        slot: this.slots.length,
        admissionRevision: this.revision + 1,
        status: 'uncertain',
      });
      if (
        candidate.member.workspaceId !== input.workspaceId ||
        candidate.member.featureId !== input.featureId
      )
        throw new Error('Enrollment scope changed');
    } catch {
      return rejected('invalid_profile');
    }
    // Enter the effect boundary synchronously. Partial file/journal writes retain this UUID/slot.
    const member: TerminalEnrollmentMember = {
      ...candidate.member,
      slot: this.slots.length,
      admissionRevision: ++this.revision,
      status: 'uncertain',
    };
    this.slots.push(undefined);
    this.attempts.push(new Set());
    this.enrolledMembers.push(member);
    let finish: ((receipt: TerminalEnrollmentReceipt) => void) | undefined;
    let receiptAttempted = false;
    try {
      this.reserved = true;
      this.admission.claim();
      finish = this.admission.reserveEnrollment!({ input, manifestFile, member });
      const slot = candidate.create();
      this.journals.push(slot.journal);
      this.slots[member.slot] = this.supervisor(slot, {
        version: 1,
        bindingDigest: member.bindingDigest,
        admissionRevision: member.admissionRevision,
      });
      const receipt: TerminalEnrollmentReceipt = {
        ...input,
        revision: this.revision,
        status: 'ready',
        reason: 'admitted',
        member: { ...member, status: 'ready' },
      };
      receiptAttempted = true;
      finish(receipt);
      member.status = 'ready';
      return save(receipt);
    } catch {
      // No rollback, release, retry, signal or adoption after entering durable admission.
      // A materialized supervisor is inaccessible until its durable ready receipt exists.
      const receipt: TerminalEnrollmentReceipt = {
        ...input,
        revision: this.revision,
        status: 'uncertain',
        reason: 'effect_uncertain',
        member,
      };
      if (finish && !receiptAttempted) {
        try {
          finish(receipt);
        } catch {
          /* Preserve partial evidence, never retry a receipt write. */
        }
      }
      return save(receipt);
    }
  }

  dispatch(slot: number, raw: unknown): unknown {
    this.active();
    const supervisor = this.slots[slot];
    if (!supervisor) throw new Error('Unknown terminal slot');
    if (this.enrolledMembers.some((member) => member.slot === slot && member.status !== 'ready'))
      throw new Error('Terminal enrollment uncertain');
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
    if (this.enrolledMembers.some((member) => member.status !== 'ready'))
      throw new Error('Uncertain enrollment retains terminal capacity');
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
    for (const supervisor of this.slots) supervisor?.shutdown();
  }

  private active() {
    if (this.fenced || this.retired) throw new Error('Terminal pair is fenced');
  }
}
