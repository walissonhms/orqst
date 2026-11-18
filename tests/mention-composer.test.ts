import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMentions } from '../apps/dashboard/src/MentionComposer.js';
import type { StudioTerminal } from '../apps/dashboard/src/TerminalStudio.js';

const terminal = (n: number): StudioTerminal => ({
  id: `id-${n}`,
  label: `T-${String(n).padStart(3, '0')}`,
  name: `Terminal ${n}`,
  provider: 'codex',
  status: 'unknown',
  workspace: { id: 'ws', name: 'Workspace' },
});

test('mentions resolve only exact stable labels, once each', () => {
  const list = [terminal(1), terminal(2), terminal(3)];
  assert.deepEqual(
    resolveMentions('@T-002 please review, then @t-003 and @T-002 again', list).map((t) => t.id),
    ['id-2', 'id-3'],
  );
  assert.deepEqual(resolveMentions('@T-009 and email@T-001x and @Terminal', list), []);
  assert.deepEqual(
    resolveMentions('name@T-001.example `@T-002` @T-003/worker @T-003-suffix', list),
    [],
  );
  assert.deepEqual(
    resolveMentions('@T-001', [terminal(1), { ...terminal(1), id: 'duplicate' }]),
    [],
  );
});
