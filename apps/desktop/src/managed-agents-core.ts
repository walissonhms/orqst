import { fork } from 'node:child_process';
import { randomUUID, type KeyObject } from 'node:crypto';
import { join } from 'node:path';
import { managedCodexEnvironment } from '../../../packages/core/src/terminal/codex-profile.js';
import {
  managedAgentsBootstrapSchema,
  readManagedAgentsPair,
  type ManagedAgentsBootstrap,
} from '../../../packages/core/src/managed-codex/feature-context.js';
import { agentsHostReplySchema, agentsHostRequestSchema } from './managed-agents-wire.js';

/** Only the selected, hash-validated Node helper runs here; it owns all private SQLite state. */
export async function connectManagedAgents(
  files: [string, string],
  publicKey: KeyObject,
  admissionDirectory: string,
  bootstrap?: ManagedAgentsBootstrap,
) {
  const pair = readManagedAgentsPair(
    files,
    bootstrap?.native,
    bootstrap?.feature,
    bootstrap !== undefined,
  );
  if (
    bootstrap &&
    (!pair.configs[0]?.preparation ||
      JSON.stringify(pair.context) !== JSON.stringify(bootstrap.feature))
  )
    throw new Error('Native Feature scope mismatch');
  const config = pair.configs[0]!;
  const child = fork(
    join(__dirname, 'managed-agents-host.cjs'),
    [
      ...files,
      publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
      admissionDirectory,
      ...(bootstrap ? [JSON.stringify(managedAgentsBootstrapSchema.parse(bootstrap))] : []),
    ],
    {
      execPath: config.node.path,
      execArgv: [],
      cwd: config.state,
      env: managedCodexEnvironment(config),
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  );
  let closed = false;
  const pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let ready: () => void;
  let failed: (error: Error) => void;
  const startup = new Promise<void>((resolve, reject) => {
    ready = resolve;
    failed = reject;
  });
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    const error = new Error('Desktop agents unavailable; no retry');
    failed(error);
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    pending.clear();
    if (child.connected) child.disconnect();
  };
  const timer = setTimeout(close, 10000);
  child.on('error', close);
  child.on('exit', close);
  child.on('disconnect', close);
  child.on('message', (raw: unknown) => {
    if (closed) return;
    if (raw && typeof raw === 'object' && Reflect.get(raw, 'type') === 'ready') {
      clearTimeout(timer);
      ready();
      return;
    }
    const parsed = agentsHostReplySchema.safeParse(raw);
    if (!parsed.success) return close();
    const p = pending.get(parsed.data.id);
    if (!p) return close();
    pending.delete(parsed.data.id);
    clearTimeout(p.timer);
    if (parsed.data.ok) p.resolve(parsed.data.value);
    else p.reject(new Error('Desktop operation unavailable'));
  });
  await startup;
  return {
    close,
    call(operation: Record<string, unknown>): Promise<unknown> {
      if (closed || pending.size >= 8) return Promise.reject(new Error('Desktop host unavailable'));
      const id = randomUUID();
      const request = agentsHostRequestSchema.parse({ ...operation, id });
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, timer: setTimeout(close, 65000) });
        // false means backpressure, never retry an already queued request.
        try {
          child.send(request, (error) => {
            if (error) close();
          });
        } catch {
          close();
        }
      });
    },
  };
}
