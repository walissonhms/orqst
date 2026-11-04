import { terminalIdentity } from '../../../packages/core/src/terminal/identity.js';
import {
  inspectDesktopAdmission,
  DesktopAdmissionRefused,
} from '../../../packages/core/src/managed-codex/desktop-admission-inspection.js';
import {
  TerminalStartupError,
  terminalStartupFailureSchema,
  terminalStartupIdSchema,
} from '../../../packages/core/src/terminal/startup-failure.js';
import {
  terminalSlotLimit,
  workspaceFeatureSchema,
  featureViewStateSchema,
  type FeatureUpdate,
  type FeatureCreate,
  terminalLayoutRecordSchema,
  type TerminalLayoutRecord,
  terminalEnrollmentInputSchema,
  terminalEnrollmentInspectionSchema,
  terminalEnrollmentReceiptSchema,
  type TerminalEnrollmentInput,
  type TerminalEnrollmentReceipt,
} from '@orqst/protocol';
import { fork } from 'node:child_process';
import { randomUUID, type KeyObject } from 'node:crypto';
import type { TerminalNativeSupervisor } from '../../../packages/core/src/terminal/native-broker.js';
import {
  interactiveTerminalEnvironment,
  readInteractiveTerminalConfig,
} from '../../../packages/core/src/terminal/interactive-profile.js';
import {
  terminalRPCReplySchema,
  terminalPairReadySchema,
  terminalPairRPCSchema,
  terminalRPCOutputSchema,
  terminalRPCSchema,
} from '../../../packages/core/src/terminal/rpc.js';

class CoreOperationDenied extends Error {}
export class FeatureRevisionConflict extends Error {}
export class TerminalEnrollmentUncertain extends Error {}

/** Electron is a client: Node owns SQLite, lifecycle, grants and PTYs across view hide/detach. */
export async function connectManagedTerminalCore(
  files: string[],
  host: string,
  publicKey: KeyObject,
  admissionDirectory: string,
  limit?: number,
  startupId: string = randomUUID(),
) {
  terminalStartupIdSchema.parse(startupId);
  // Passive before fork, with authoritative admission repeated in the child against races.
  try {
    inspectDesktopAdmission(admissionDirectory);
  } catch (error) {
    throw new TerminalStartupError({
      stage: 'core_admission',
      code: error instanceof DesktopAdmissionRefused ? error.code : 'admission_invalid',
      effects: 'possible',
    });
  }
  const config = readInteractiveTerminalConfig(files[0]!);
  const child = fork(
    host,
    [
      JSON.stringify(files),
      publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
      admissionDirectory,
      String(terminalSlotLimit(limit)),
      startupId,
    ],
    {
      execPath: config.node.path,
      execArgv: [],
      cwd: config.state,
      env: interactiveTerminalEnvironment(config),
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'json',
    },
  );
  let exited = false;
  const exit = new Promise<void>((resolve) =>
    child.once('exit', () => {
      exited = true;
      resolve();
    }),
  );
  let closed = false;
  let initialized = false;
  let epoch = '';
  let admissionOwner = '';
  let identities: Array<{
    slot: number;
    terminalId: string;
    alias?: string;
    provider: 'codex' | 'claude' | 'opencode';
  }> = [];
  let ready: () => void;
  let failed: (error: Error) => void;
  const startup = new Promise<void>((resolve, reject) => {
    ready = resolve;
    failed = reject;
  });
  const pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  // A timed-out enrollment is never replayed. Its late transport ACK cannot close old panes.
  const enrollmentTimeouts = new Set<string>();
  const close = (
    cause: Error = new TerminalStartupError({
      stage: 'core_startup',
      code: 'startup_eof',
      effects: 'possible',
    }),
  ) => {
    if (closed) return;
    closed = true;
    clearTimeout(startupTimer);
    const error = cause;
    failed(error);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    if (child.connected) child.disconnect();
  };
  const protocolError = () =>
    close(
      new TerminalStartupError({
        stage: 'core_startup',
        code: 'startup_protocol',
        effects: 'possible',
      }),
    );
  const startupTimer = setTimeout(
    () =>
      close(
        new TerminalStartupError({
          stage: 'core_startup',
          code: 'startup_timeout',
          effects: 'possible',
        }),
      ),
    10000,
  );
  child.on('error', () => close());
  child.on('exit', () => close());
  child.on('disconnect', () => close());
  child.on('message', (raw: unknown) => {
    if (closed) return;
    const refusal = terminalStartupFailureSchema.safeParse(raw);
    if (!initialized && refusal.success) {
      if (refusal.data.id !== startupId) return protocolError();
      return close(new TerminalStartupError(refusal.data.failure));
    }
    const started = terminalPairReadySchema.safeParse(raw);
    if (!initialized && started.success) {
      if (
        started.data.id !== startupId ||
        JSON.stringify(started.data.initialFiles) !== JSON.stringify(files) ||
        started.data.identities.length !== files.length ||
        started.data.identities.some((identity, slot) => {
          const expected = terminalIdentity(readInteractiveTerminalConfig(files[slot]!));
          return (
            identity.slot !== slot ||
            identity.terminalId !== expected.terminalId ||
            identity.alias !== expected.alias
          );
        })
      )
        return protocolError();
      identities = started.data.identities;
      epoch = started.data.epoch;
      admissionOwner = started.data.admissionOwner;
      initialized = true;
      clearTimeout(startupTimer);
      ready();
      return;
    }
    const parsed = terminalRPCReplySchema.safeParse(raw);
    if (!initialized || !parsed.success) return protocolError();
    const request = pending.get(parsed.data.id);
    if (!request && enrollmentTimeouts.delete(parsed.data.id)) return;
    if (!request) return close();
    pending.delete(parsed.data.id);
    clearTimeout(request.timer);
    if (parsed.data.ok) request.resolve(parsed.data.value);
    else request.reject(new CoreOperationDenied('Managed Terminal operation denied'));
  });
  const call = (body: Record<string, unknown>, selectedId: string = randomUUID()) =>
    new Promise<unknown>((resolve, reject) => {
      if (closed || !initialized || pending.size >= 16)
        return reject(new Error('Managed Terminal unavailable'));
      const id = selectedId;
      const request = terminalPairRPCSchema.parse({
        ...body,
        ...(body.kind === 'terminal' ? {} : { id }),
      });
      const enrollment = body.kind === 'enroll' || body.kind === 'enrollmentInspect';
      if (enrollment && enrollmentTimeouts.size >= 128)
        return reject(new TerminalEnrollmentUncertain('Enrollment transport budget exhausted'));
      const timer = setTimeout(() => {
        if (!enrollment) return close();
        pending.delete(id);
        enrollmentTimeouts.add(id);
        reject(
          new TerminalEnrollmentUncertain(
            'Enrollment reply unconfirmed; inspect opId without retry',
          ),
        );
      }, 12000);
      pending.set(id, { resolve, reject, timer });
      try {
        child.send(request, (error) => {
          if (error) close();
        });
      } catch {
        close();
      }
    });
  await startup;
  const readFeature = async (featureId: string) =>
    workspaceFeatureSchema.parse(await call({ kind: 'featureRead', featureId }));
  const readView = async () =>
    featureViewStateSchema.parse(await call({ kind: 'featureViewRead' }));
  const featureMutation = async (
    body: Record<string, unknown>,
    expectedRevision: number,
    revision: () => Promise<number>,
  ) => {
    try {
      return await call(body);
    } catch (error) {
      // Only an explicit Core refusal is eligible for a CAS diagnosis. Transport loss
      // stays uncertain even if a later read could find a committed mutation.
      if (error instanceof CoreOperationDenied && (await revision()) !== expectedRevision)
        throw new FeatureRevisionConflict('Feature revision changed');
      throw error;
    }
  };
  const supervisor = (slot: number) =>
    Object.fromEntries(
      terminalRPCSchema.options.map((schema) => {
        const operation = schema.shape.operation.value;
        return [
          operation,
          async (...args: unknown[]) => {
            const request = terminalRPCSchema.parse({ id: randomUUID(), operation, args });
            const result = await call({ kind: 'terminal', slot, request }, request.id);
            if (operation !== 'read') return result;
            const output = terminalRPCOutputSchema.parse(result);
            return { ...output, bytes: Uint8Array.from(output.bytes) };
          },
        ];
      }),
    ) as TerminalNativeSupervisor;
  const supervisors = files.map((_file, slot) => supervisor(slot));
  let enrollmentRevision = 0;
  const enrollmentOperations = new Map<
    string,
    { key: string; receipt?: TerminalEnrollmentReceipt }
  >();
  return {
    identities,
    admissionOwner,
    initialFiles: [...files],
    get epoch() {
      return epoch;
    },
    async enrollmentInspect(opId?: string) {
      const value = terminalEnrollmentInspectionSchema.parse(
        await call({ kind: 'enrollmentInspect', ...(opId ? { opId } : {}) }),
      );
      if (value.epoch !== epoch) throw new TerminalEnrollmentUncertain('Enrollment epoch changed');
      if (value.receipt && value.receipt.opId !== opId)
        throw new TerminalEnrollmentUncertain('Enrollment inspection binding changed');
      // Inspection is evidence only: never materialize a slot from a timed-out operation.
      return value;
    },
    async enroll(input: TerminalEnrollmentInput, manifestFile: string) {
      const validated = terminalEnrollmentInputSchema.parse(input);
      if (input.epoch !== epoch) throw new Error('Enrollment epoch changed');
      const key = JSON.stringify([validated, manifestFile]);
      const prior = enrollmentOperations.get(input.opId);
      if (prior) {
        if (prior.key !== key) throw new Error('Enrollment operation rebound');
        if (prior.receipt) return structuredClone(prior.receipt);
        throw new TerminalEnrollmentUncertain(
          'Enrollment already attempted; inspect opId without retry',
        );
      }
      if (enrollmentOperations.size >= 128) throw new Error('Enrollment operation budget exceeded');
      const operation: { key: string; receipt?: TerminalEnrollmentReceipt } = { key };
      enrollmentOperations.set(input.opId, operation);
      const receipt = terminalEnrollmentReceiptSchema.parse(
        await call({ kind: 'enroll', input, manifestFile }),
      );
      if (
        receipt.epoch !== epoch ||
        receipt.opId !== input.opId ||
        receipt.expectedRevision !== input.expectedRevision ||
        receipt.workspaceId !== input.workspaceId ||
        receipt.featureId !== input.featureId
      )
        throw new TerminalEnrollmentUncertain('Enrollment receipt binding changed');
      if (receipt.status === 'ready') {
        const member = receipt.member;
        if (!member || member.status !== 'ready' || member.admissionRevision !== receipt.revision)
          throw new TerminalEnrollmentUncertain('Enrollment receipt member changed');
        const previous = identities[member.slot];
        if (previous) {
          if (previous.terminalId !== member.terminalId || previous.provider !== member.provider)
            throw new TerminalEnrollmentUncertain('Enrollment slot rebound');
        } else {
          if (member.slot !== supervisors.length || receipt.revision !== enrollmentRevision + 1)
            throw new TerminalEnrollmentUncertain('Enrollment continuity unconfirmed');
          supervisors.push(supervisor(member.slot));
          identities.push({
            slot: member.slot,
            terminalId: member.terminalId,
            provider: member.provider,
            ...(member.alias ? { alias: member.alias } : {}),
          });
          enrollmentRevision = receipt.revision;
        }
      }
      operation.receipt = structuredClone(receipt);
      return receipt;
    },
    features: {
      list: async () => workspaceFeatureSchema.array().parse(await call({ kind: 'featureList' })),
      read: readFeature,
      create: async (input: Omit<FeatureCreate, 'workspaceId'>) =>
        workspaceFeatureSchema.parse(await call({ kind: 'featureCreate', input })),
      update: async (featureId: string, input: FeatureUpdate) =>
        workspaceFeatureSchema.parse(
          await featureMutation(
            { kind: 'featureUpdate', featureId, input },
            input.expectedRevision,
            async () => (await readFeature(featureId)).revision,
          ),
        ),
      assign: async (featureId: string, slot: number, expectedRevision: number) =>
        workspaceFeatureSchema.parse(
          await featureMutation(
            { kind: 'featureAssign', featureId, slot, expectedRevision },
            expectedRevision,
            async () => (await readFeature(featureId)).revision,
          ),
        ),
      readView,
      saveView: async (input: { featureId: string | null; expectedRevision: number }) =>
        featureViewStateSchema.parse(
          await featureMutation(
            { kind: 'featureViewSave', input },
            input.expectedRevision,
            async () => (await readView()).revision,
          ),
        ),
      readLayout: async (featureId: string) => {
        const value = await call({ kind: 'featureLayoutRead', featureId });
        return value === null ? null : terminalLayoutRecordSchema.parse(value);
      },
      saveLayout: (featureId: string, record: TerminalLayoutRecord) =>
        call({ kind: 'featureLayoutSave', featureId, record }),
    },
    layouts: {
      read: async () => {
        const value = await call({ kind: 'layoutRead' });
        return value === null ? null : terminalLayoutRecordSchema.parse(value);
      },
      save: (record: TerminalLayoutRecord) => call({ kind: 'layoutSave', record }),
      import: async (record: TerminalLayoutRecord) =>
        terminalLayoutRecordSchema.parse(await call({ kind: 'layoutImport', record })),
    },
    supervisors,
    close,
    async closeAndWait(): Promise<void> {
      close();
      if (exited) return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Terminal Core exit unconfirmed')), 5000);
        void exit.then(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
    closeSlot: (slot: number) => call({ kind: 'closeSlot', slot }),
    prepareRetire: () => call({ kind: 'prepareRetire' }),
    retire: (proof: unknown) => call({ kind: 'retire', proof }),
    prepareMcp: () => call({ kind: 'prepareMcp' }),
    authorizeMcp: (proof: unknown) => call({ kind: 'authorizeMcp', proof }),
  };
}
