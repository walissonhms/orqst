import { fork } from 'node:child_process';
import { randomUUID, type KeyObject } from 'node:crypto';
import type { TerminalNativeSupervisor } from '../../../packages/core/src/terminal/native-broker.js';
import {
  managedCodexEnvironment,
  readManagedCodexConfig,
} from '../../../packages/core/src/terminal/codex-profile.js';
import {
  terminalRPCReplySchema,
  terminalRPCOutputSchema,
  terminalRPCSchema,
} from '../../../packages/core/src/terminal/rpc.js';

/** Electron is a client: Node owns SQLite, lifecycle, grants and PTYs across view hide/detach. */
export async function connectManagedTerminalCore(
  file: string,
  host: string,
  publicKey: KeyObject,
): Promise<{ supervisor: TerminalNativeSupervisor; close(): void }> {
  const config = readManagedCodexConfig(file);
  const child = fork(
    host,
    [file, publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')],
    {
      execPath: config.node.path,
      execArgv: [],
      cwd: config.state,
      env: managedCodexEnvironment(config),
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'json',
    },
  );
  let closed = false;
  let initialized = false;
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
    if (
      !initialized &&
      typeof raw === 'object' &&
      raw !== null &&
      Reflect.get(raw, 'type') === 'ready'
    ) {
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
  const call = (operation: string, args: unknown[]) =>
    new Promise<unknown>((resolve, reject) => {
      if (closed || !initialized || pending.size >= 16)
        return reject(new Error('Managed Terminal unavailable'));
      const id = randomUUID();
      const request = terminalRPCSchema.parse({ id, operation, args });
      pending.set(id, { resolve, reject, timer: setTimeout(close, 12000) });
      if (
        !child.send(request, (error) => {
          if (error) close();
        })
      )
        close();
    });
  await startup;
  const supervisor = Object.fromEntries(
    terminalRPCSchema.options.map((schema) => {
      const operation = schema.shape.operation.value;
      return [
        operation,
        async (...args: unknown[]) => {
          const result = await call(operation, args);
          if (operation !== 'read') return result;
          const output = terminalRPCOutputSchema.parse(result);
          return { ...output, bytes: Uint8Array.from(output.bytes) };
        },
      ];
    }),
  ) as TerminalNativeSupervisor;
  return { supervisor, close };
}
