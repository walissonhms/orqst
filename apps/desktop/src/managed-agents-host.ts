import { createPublicKey } from 'node:crypto';
import { join } from 'node:path';
import { DesktopManagedAgents } from '../../../packages/core/src/managed-codex/desktop.js';
import { nativeCodexBackend } from '../../../packages/core/src/managed-codex/runtime.js';
import { desktopAgentsAdmission } from '../../../packages/core/src/managed-codex/desktop-admission.js';
import { agentsHostRequestSchema } from './managed-agents-wire.js';

process.umask(0o077);
if (!process.send || !/^v24\./.test(process.version) || process.argv.length !== 6)
  throw new Error('Private Desktop host requires Node 24 IPC');
const service = new DesktopManagedAgents(
  [process.argv[2]!, process.argv[3]!],
  createPublicKey({
    key: Buffer.from(process.argv[4]!, 'base64url'),
    format: 'der',
    type: 'spki',
  }),
  nativeCodexBackend(join(__dirname, 'codex-structured-host.cjs')),
  desktopAgentsAdmission(process.argv[5]!, [process.argv[2]!, process.argv[3]!]),
);
let busy = false;
process.on('message', async (raw: unknown) => {
  const parsed = agentsHostRequestSchema.safeParse(raw);
  if (!parsed.success) return;
  const r = parsed.data;
  const send = (ok: boolean, value: unknown = null) => {
    if (process.connected) process.send!({ id: r.id, ok, value }, () => {});
  };
  if (busy && r.operation !== 'snapshot') return send(false);
  const mutate = r.operation !== 'snapshot';
  if (mutate) busy = true;
  try {
    let value: unknown;
    switch (r.operation) {
      case 'snapshot':
        value = service.snapshot();
        break;
      case 'prepareRetire':
        value = service.prepareRetire();
        break;
      case 'retire':
        service.retire(r.proof);
        break;
      case 'prepareStart':
        value = service.prepareStart(r.slot, r.model);
        break;
      case 'launch':
        value = await service.launch(r.slot, r.proof);
        break;
      case 'prepareTask':
        value = service.prepareTask(r.text, r.task);
        break;
      case 'runTask':
        service.runTask(r.taskId, r.correlationId, r.proof);
        break;
      case 'prepareStop':
        value = service.prepareStop(r.slot);
        break;
      case 'stop':
        service.stop(r.slot, r.proof);
        break;
    }
    send(true, value ?? null);
  } catch {
    send(false);
  } finally {
    if (mutate) busy = false;
  }
});
process.once('disconnect', () => {
  service.close();
  process.exit(0);
});
process.send({ type: 'ready' });
