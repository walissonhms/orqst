import { terminalIdentity } from '../../../packages/core/src/terminal/identity.js';
import {
  terminalSlotLimit,
  terminalLayoutRecordSchema,
  type TerminalLayoutRecord,
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

/** Electron is a client: Node owns SQLite, lifecycle, grants and PTYs across view hide/detach. */
export async function connectManagedTerminalCore(
  files: string[],
  host: string,
  publicKey: KeyObject,
  admissionDirectory: string,
  limit?: number,
) {
  const config = readInteractiveTerminalConfig(files[0]!);
  const child = fork(
    host,
    [
      JSON.stringify(files),
      publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
      admissionDirectory,
      String(terminalSlotLimit(limit)),
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
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(startupTimer);
    const error = new Error('Managed Terminal Core unavailable; no retry');
    failed(error);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    if (child.connected) child.disconnect();
  };
  const startupTimer = setTimeout(close, 10000);
  child.on('error', close);
  child.on('exit', close);
  child.on('disconnect', close);
  child.on('message', (raw: unknown) => {
    if (closed) return;
    const started = terminalPairReadySchema.safeParse(raw);
    if (!initialized && started.success) {
      if (
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
        return close();
      identities = started.data.identities;
      initialized = true;
      clearTimeout(startupTimer);
      ready();
      return;
    }
    const parsed = terminalRPCReplySchema.safeParse(raw);
    if (!parsed.success) return close();
    const request = pending.get(parsed.data.id);
    if (!request) return close();
    pending.delete(parsed.data.id);
    clearTimeout(request.timer);
    if (parsed.data.ok) request.resolve(parsed.data.value);
    else request.reject(new Error('Managed Terminal operation denied'));
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
      pending.set(id, { resolve, reject, timer: setTimeout(close, 12000) });
      try {
        child.send(request, (error) => {
          if (error) close();
        });
      } catch {
        close();
      }
    });
  await startup;
  const supervisors = files.map(
    (_file, slot) =>
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
      ) as TerminalNativeSupervisor,
  );
  return {
    identities,
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
