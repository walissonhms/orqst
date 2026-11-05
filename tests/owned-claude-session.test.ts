// Synthetic transcript only. No real session, credential or provider is opened.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ownedClaudeSession } from '../packages/core/src/terminal/owned-claude-session.js';
import type { ManagedClaudeConfig } from '../packages/core/src/terminal/interactive-profile.js';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-session-')));
  const project = join(root, 'project');
  const home = join(root, 'home');
  const configDir = join(home, '.claude');
  const state = join(root, 'owned');
  mkdirSync(project, { mode: 0o700 });
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  mkdirSync(state, { mode: 0o700 });
  const sessionId = randomUUID();
  const config = { sessionId, project, state, authentication: { home } } as ManagedClaudeConfig;
  const binding = {
    instanceId: randomUUID(),
    epoch: randomUUID(),
    manifestDigest: 'a'.repeat(64),
    configDigest: 'b'.repeat(64),
  };
  const folder = join(configDir, 'projects', project.replace(/[^a-zA-Z0-9-]/g, '-'));
  const file = join(folder, `${sessionId}.jsonl`);
  const row = (name: string, extra: object = {}) =>
    JSON.stringify({
      sessionId,
      cwd: project,
      timestamp: '2026-11-05T00:00:00.000Z',
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name, input: { secret: 'never exposed' } }] },
      ...extra,
    });
  return {
    root,
    folder,
    file,
    config,
    binding,
    row,
    sessionId,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('only a newly created exact-session transcript supplies bounded tool names', () => {
  const f = fixture();
  try {
    const read = ownedClaudeSession(f.config, f.binding);
    assert.ok(read);
    mkdirSync(f.folder, { recursive: true, mode: 0o700 });
    writeFileSync(
      f.file,
      [
        f.row('Read'),
        f.row('Write'),
        f.row('Search'),
        f.row('Bash'),
        f.row('ghp_abcdefghijklmnopqr'),
        f.row('Wrong', { sessionId: randomUUID() }),
        f.row('Other', { cwd: '/wrong' }),
        f.row('Partial'),
      ].join('\n'),
      { mode: 0o600 },
    );
    const evidence = read();
    assert.equal(evidence?.session.sessionId, f.sessionId);
    assert.deepEqual(
      evidence?.activities.map((item) => item.label),
      ['Write', 'Search', 'Bash'],
    );
    assert.ok(!JSON.stringify(evidence).includes('never exposed'));
    const receipt = join(f.config.state, `session-binding-${f.binding.instanceId}.json`);
    assert.equal(statSync(receipt).mode & 0o777, 0o600);
    const persisted = JSON.parse(readFileSync(receipt, 'utf8'));
    assert.deepEqual(persisted.binding, f.binding);
    assert.equal(persisted.sessionId, f.sessionId);
    assert.ok(!JSON.stringify(persisted).includes('never exposed'));
    assert.equal(ownedClaudeSession(f.config, f.binding), undefined);
  } finally {
    f.close();
  }
});

test('source replacement, links and unrelated session rows do not bind', () => {
  const f = fixture();
  try {
    const read = ownedClaudeSession(f.config, f.binding)!;
    mkdirSync(f.folder, { recursive: true, mode: 0o700 });
    writeFileSync(f.file, f.row('Read', { sessionId: randomUUID() }) + '\n', { mode: 0o600 });
    assert.equal(read(), undefined);
    rmSync(f.file);
    const other = join(f.root, 'other');
    writeFileSync(other, f.row('Read') + '\n', { mode: 0o600 });
    symlinkSync(other, f.file);
    assert.equal(read(), undefined);
    rmSync(f.file);
    writeFileSync(f.file, f.row('Read') + '\n', { mode: 0o600 });
    assert.equal(read(), undefined);
  } finally {
    f.close();
  }
});

test('existing binding evidence is never overwritten or silently adopted', () => {
  const f = fixture();
  try {
    const read = ownedClaudeSession(f.config, f.binding)!;
    mkdirSync(f.folder, { recursive: true, mode: 0o700 });
    writeFileSync(f.file, f.row('Read') + '\n', { mode: 0o600 });
    const path = join(f.config.state, `session-binding-${f.binding.instanceId}.json`);
    writeFileSync(path, 'SYNTHETIC PRESERVE', { mode: 0o600 });
    assert.equal(read(), undefined);
    assert.equal(read(), undefined);
    assert.equal(readFileSync(path, 'utf8'), 'SYNTHETIC PRESERVE');
  } finally {
    f.close();
  }
});

test('owned Claude turns use explicit records and never process liveness', () => {
  const f = fixture();
  try {
    const read = ownedClaudeSession(f.config, f.binding)!;
    mkdirSync(f.folder, { recursive: true, mode: 0o700 });
    const turnId = randomUUID();
    const user = JSON.stringify({
      sessionId: f.sessionId,
      cwd: f.config.project,
      type: 'user',
      uuid: turnId,
      message: { content: 'SYNTHETIC private prompt' },
    });
    const assistant = (stop_reason: string | null, extra = {}) =>
      f.row('Read', { message: { stop_reason, content: [] }, ...extra });
    const write = (lines: string[]) =>
      writeFileSync(f.file, lines.join('\n') + '\n', { mode: 0o600 });
    write([f.row('Read'), user]);
    assert.equal(read()?.agentState, 'running');
    assert.equal(read()?.turnId, turnId);
    write([f.row('Read'), user, assistant('end_turn')]);
    assert.equal(read()?.agentState, 'completed');
    const toolResult = JSON.stringify({
      sessionId: f.sessionId,
      cwd: f.config.project,
      type: 'user',
      uuid: randomUUID(),
      message: { content: [{ type: 'tool_result', tool_use_id: 'synthetic' }] },
    });
    write([f.row('Read'), user, assistant('end_turn'), toolResult]);
    assert.equal(read()?.turnId, turnId);
    assert.equal(read()?.agentState, 'unknown');
    write([
      f.row('Read'),
      user,
      f.row('Read', {
        message: {
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', name: 'AskUserQuestion' }],
        },
      }),
    ]);
    assert.equal(read()?.agentState, 'unknown');
    write([f.row('Read'), user, assistant(null, { isApiErrorMessage: true })]);
    assert.equal(read()?.agentState, 'failed');
    write([f.row('Read'), user, assistant('end_turn'), '{broken']);
    assert.equal(read()?.agentState, 'unknown');
    writeFileSync(f.file, [f.row('Read'), user, assistant('end_turn'), '{partial'].join('\n'));
    assert.equal(read()?.agentState, 'unknown');
    assert.ok(!JSON.stringify(read()).includes('SYNTHETIC private prompt'));
  } finally {
    f.close();
  }
});
