// Explicit metadata-only inspection. Never opens a journal owner or controls a process.
import { parseArgs } from 'node:util';
import { readLifecycleReceipt } from '../packages/core/src/managed-codex/lifecycle-receipt.js';

try {
  const { values } = parseArgs({
    options: {
      state: { type: 'string' },
      instance: { type: 'string' },
      epoch: { type: 'string' },
      'manifest-sha256': { type: 'string' },
      'config-sha256': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (Object.values(values).length !== 5 || !values.state) throw new Error('Missing identity');
  const result = readLifecycleReceipt(values.state, {
    instanceId: values.instance!,
    epoch: values.epoch!,
    manifestDigest: values['manifest-sha256']!,
    configDigest: values['config-sha256']!,
  });
  console.log(JSON.stringify(result));
  if (result.status !== 'recorded_exit') process.exitCode = 1;
} catch {
  console.error(
    'Lifecycle inspection unavailable; provide state, instance, epoch, manifest-sha256 and config-sha256.',
  );
  process.exitCode = 1;
}
