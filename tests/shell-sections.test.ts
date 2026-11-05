import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionView } from '../packages/protocol/src/index.js';
import {
  isTemporaryWorkspace,
  shellSections,
  shortAge,
  STALE_MS,
} from '../apps/dashboard/src/shell-sections.js';

const now = Date.parse('2026-11-05T12:00:00Z');
const at = (ms: number) => new Date(now - ms).toISOString();
const session = (id: string, status: SessionView['status'], ago: number): SessionView => ({
  id,
  workspaceId: 'w',
  cwd: '/synthetic',
  agentName: `synthetic-${id}`,
  adapter: 'codex',
  status,
  startedAt: at(ago + 1000),
  lastActivity: at(ago),
  task: null,
  result: null,
  model: null,
  parentSessionId: null,
  usage: { input: 0, output: 0, cached: 0, total: 0 },
  manualWorkspace: false,
});

test('only recent running sessions count as running; old ones are stale', () => {
  const sections = shellSections(
    [
      session('a', 'running', 60_000),
      session('b', 'running', STALE_MS + 1),
      session('c', 'waiting_for_user', 1000),
      session('d', 'completed', 5000),
    ],
    now,
  );
  assert.deepEqual(
    sections.running.map((s) => s.id),
    ['a'],
  );
  assert.equal(sections.stale, 1);
  assert.deepEqual(
    sections.needsYou.map((s) => s.id),
    ['c'],
  );
  assert.deepEqual(
    sections.recent.map((s) => s.id),
    ['d', 'b'],
    'recent excludes what is already shown, newest first',
  );
});

test('temporary workspaces and relative ages', () => {
  assert.ok(isTemporaryWorkspace({ path: '/var/folders/kx/abc/T/run' }));
  assert.ok(isTemporaryWorkspace({ path: '/private/tmp/orqst-x' }));
  assert.ok(!isTemporaryWorkspace({ path: '/Users/me/developer/app' }));
  assert.equal(shortAge(at(30_000), now), '30s');
  assert.equal(shortAge(at(5 * 60_000), now), '5m');
  assert.equal(shortAge(at(3 * 3600_000), now), '3h');
  assert.equal(shortAge('not a date', now), '—');
});
