import { join } from 'node:path';
import { managedAgentsHostComposition } from './managed-agents-context.js';
import { nativeCodexBackend } from '../../../packages/core/src/managed-codex/runtime.js';
import { desktopAgentsAdmission } from '../../../packages/core/src/managed-codex/desktop-admission.js';
import { agentsHostRequestSchema } from './managed-agents-wire.js';
import { electronKernelQuery } from './electron-kernel-query.js';
import { acquireAdmissionMutation } from '../../../packages/core/src/terminal/admission-mutation.js';

process.umask(0o077);
if (!process.send || !/^v24\./.test(process.version) || ![6, 7].includes(process.argv.length))
  throw new Error('Private Desktop host requires Node 24 IPC');
const nativeMutation = process.platform === 'darwin';
const admission = desktopAgentsAdmission(
  process.argv[5]!,
  [process.argv[2]!, process.argv[3]!],
  undefined,
  nativeMutation,
);
const service = managedAgentsHostComposition(
  process.argv.slice(2),
  nativeCodexBackend(join(__dirname, 'codex-structured-host.cjs')),
  admission,
);
let mutation: Promise<void> | undefined;
function ensureMutation() {
  if (!nativeMutation) return Promise.resolve();
  admission.assertOwner();
  mutation ??= Promise.resolve().then(async () => {
    const kernel = electronKernelQuery(join(__dirname, 'orqst-kernel-query'));
    const identity = await kernel.identity(process.pid);
    admission.installMutation(
      await acquireAdmissionMutation(process.argv[5]!, identity, kernel.exists),
    );
  });
  return mutation;
}
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
        await ensureMutation();
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
        value = service.prepareTask(r.text, r.task, r.sourceSlot);
        break;
      case 'prepareRouting':
        value = service.prepareRouting(r.slot, r.update);
        break;
      case 'applyRouting':
        service.applyRouting(r.changeId, r.proof);
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
