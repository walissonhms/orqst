// Fixed synthetic metadata writer. Abrupt termination intentionally bypasses shutdown/close.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '@orqst/database';

assert.equal(process.argv.length, 3);
assert.ok(process.argv[2]);
process.umask(0o077);
const store = new Store(process.argv[2]);
const journal = store.terminalJournal(randomUUID(), { recover: false });
for (const [projectId, started] of [
  ['synthetic-prepared', false],
  ['synthetic-running', true],
] as const) {
  const instanceId = randomUUID();
  journal.prepare({
    instanceId,
    clientId: 'synthetic-native',
    projectId,
    manifestDigest: 'a'.repeat(64),
  });
  if (started) {
    journal.transition(instanceId, 'starting');
    journal.transition(instanceId, 'running');
  }
}
process.exit(73);
