// Synthetic hook inputs and owned files only. The actual Claude CLI is never executed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  claudeOwnedHookFiles,
  claudeOwnedHooksPath,
  claudeOwnedHookChannelName,
  ownedClaudeHookEvidence,
  validateClaudeOwnedHooks,
} from '../packages/core/src/terminal/owned-claude-hooks.js';
import { ownedClaudeSession } from '../packages/core/src/terminal/owned-claude-session.js';
import type { ManagedClaudeConfig } from '../packages/core/src/terminal/interactive-profile.js';

function fixture() {
  // Shell metacharacters are intentional: the actual settings command must quote its path.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "orqst-synthetic-hooks-'$()-")));
  const state = join(root, 'owned');
  const project = join(root, 'project');
  const home = join(root, 'home');
  const native = join(home, '.claude');
  for (const directory of [state, project, native])
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  const config = {
    ownedHooks: true,
    executableVersion: '2.1.318',
    sessionId: randomUUID(),
    state,
    project,
    authentication: { home },
    node: { path: realpathSync(process.execPath) },
    interactive: {},
  } as ManagedClaudeConfig;
  const files = claudeOwnedHookFiles(config);
  for (const [name, bytes] of Object.entries(files))
    writeFileSync(join(state, name), bytes, { flag: 'wx', mode: 0o600 });
  const channel = join(state, claudeOwnedHookChannelName);
  writeFileSync(channel, '', { flag: 'wx', mode: 0o600 });
  const transcript = join(
    native,
    'projects',
    project.replace(/[^a-zA-Z0-9-]/g, '-'),
    `${config.sessionId}.jsonl`,
  );
  const settings = JSON.parse(readFileSync(claudeOwnedHooksPath(config), 'utf8')) as {
    hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  };
  const promptId = randomUUID();
  const input = (event: string, extra: object = {}) => ({
    hook_event_name: event,
    session_id: config.sessionId,
    prompt_id: promptId,
    cwd: project,
    transcript_path: transcript,
    prompt: 'SYNTHETIC_PRIVATE_PROMPT_MUST_NOT_BE_STORED',
    message: 'SYNTHETIC_NOTIFICATION_CONTENT_MUST_NOT_BE_STORED',
    last_assistant_message: 'SYNTHETIC_RESPONSE_MUST_NOT_BE_STORED',
    ...extra,
  });
  const send = (event: string, extra: object = {}) => {
    const command = settings.hooks[event]![0]!.hooks[0]!.command;
    const child = spawnSync('/bin/sh', ['-c', command], {
      input: JSON.stringify(input(event, extra)),
      encoding: 'utf8',
      timeout: 3000,
      env: { PATH: '/usr/bin:/bin', HOME: home },
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, '');
    assert.equal(child.stderr, '');
  };
  return {
    root,
    config,
    files,
    state,
    channel,
    transcript,
    promptId,
    input,
    send,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('owned settings add only hook metadata handlers; the actual quoted command writes no content', () => {
  const f = fixture();
  try {
    validateClaudeOwnedHooks(f.config);
    const settings = JSON.parse(readFileSync(claudeOwnedHooksPath(f.config), 'utf8')) as Record<
      string,
      unknown
    >;
    assert.deepEqual(Object.keys(settings), ['hooks']);
    assert.equal(statSync(claudeOwnedHooksPath(f.config)).mode & 0o777, 0o600);
    const read = ownedClaudeHookEvidence(f.config);
    assert.deepEqual(read(), { agentState: 'unknown' });
    f.send('UserPromptSubmit');
    assert.deepEqual(read(), { agentState: 'running', turnId: f.promptId });
    f.send('Notification', { notification_type: 'permission_prompt' });
    assert.deepEqual(read(), { agentState: 'waiting_for_user', turnId: f.promptId });
    f.send('PostToolUse', {
      tool_input: { private: 'SYNTHETIC_TOOL_INPUT' },
      tool_response: 'SYNTHETIC_TOOL_OUTPUT',
    });
    assert.deepEqual(read(), { agentState: 'running', turnId: f.promptId });
    f.send('Stop');
    assert.deepEqual(read(), { agentState: 'completed', turnId: f.promptId });
    const next = randomUUID();
    f.send('UserPromptSubmit', { prompt_id: next });
    f.send('StopFailure', { prompt_id: next, error_details: 'SYNTHETIC_API_ERROR_BODY' });
    assert.deepEqual(read(), { agentState: 'failed', turnId: next });
    const bytes = readFileSync(f.channel, 'utf8');
    assert.equal(bytes.includes('SYNTHETIC_'), false);
    assert.equal(bytes.includes('prompt_id'), false);
    assert.equal(bytes.includes(f.config.project), false);
    assert.equal(statSync(f.channel).mode & 0o777, 0o600);
  } finally {
    f.close();
  }
});

test('foreign sessions, subagents, missing prompt IDs and unrelated notifications are ignored', () => {
  const f = fixture();
  try {
    const read = ownedClaudeHookEvidence(f.config);
    for (const extra of [
      { session_id: randomUUID() },
      { agent_id: 'SYNTHETIC-subagent' },
      { prompt_id: undefined },
      { prompt_id: 'not-a-uuid' },
    ])
      f.send('UserPromptSubmit', extra);
    f.send('Notification', { notification_type: 'auth_success' });
    assert.equal(readFileSync(f.channel).length, 0);
    assert.deepEqual(read(), { agentState: 'unknown' });
    f.send('UserPromptSubmit');
    f.send('Notification', { notification_type: 'idle_prompt' });
    assert.deepEqual(read(), { agentState: 'waiting_for_user', turnId: f.promptId });
  } finally {
    f.close();
  }
});

for (const mutation of [
  'partial',
  'rewrite',
  'replace',
  'symlink',
  'mode',
  'settings',
  'script',
  'fifo',
  'hardlink',
  'oversized',
] as const) {
  test(`owned hook channel ${mutation} cannot establish or replay a state`, () => {
    const f = fixture();
    try {
      const read = ownedClaudeHookEvidence(f.config);
      f.send('UserPromptSubmit');
      assert.equal(read().agentState, 'running');
      if (mutation === 'partial') appendFileSync(f.channel, '{"version":');
      if (mutation === 'rewrite') writeFileSync(f.channel, '');
      if (mutation === 'replace' || mutation === 'symlink') {
        renameSync(f.channel, f.channel + '.original');
        if (mutation === 'symlink') symlinkSync(f.channel + '.original', f.channel);
        else writeFileSync(f.channel, readFileSync(f.channel + '.original'), { mode: 0o600 });
      }
      if (mutation === 'mode') chmodSync(f.channel, 0o644);
      if (mutation === 'settings') appendFileSync(claudeOwnedHooksPath(f.config), ' ');
      if (mutation === 'script') appendFileSync(join(f.state, 'claude-hooks.cjs'), ' ');
      if (mutation === 'hardlink') linkSync(f.channel, f.channel + '.linked');
      if (mutation === 'fifo') {
        renameSync(f.channel, f.channel + '.original');
        assert.equal(spawnSync('/usr/bin/mkfifo', [f.channel]).status, 0);
        chmodSync(f.channel, 0o600);
      }
      if (mutation === 'oversized') appendFileSync(f.channel, 'X'.repeat(128 * 1024));
      assert.deepEqual(read(), { agentState: 'unknown' });
      if (mutation === 'rewrite' || mutation === 'replace') {
        f.send('UserPromptSubmit');
        assert.deepEqual(read(), { agentState: 'unknown' });
      }
    } finally {
      f.close();
    }
  });
}

test('a hook cannot adopt an existing channel or attach a different/closed prompt to the current turn', () => {
  const f = fixture();
  try {
    const read = ownedClaudeHookEvidence(f.config);
    f.send('UserPromptSubmit');
    assert.throws(() => ownedClaudeHookEvidence(f.config), /cannot be adopted/);
    f.send('Notification', { notification_type: 'permission_prompt', prompt_id: randomUUID() });
    assert.deepEqual(read(), { agentState: 'unknown' });
  } finally {
    f.close();
  }
});

test('hook state stays absent until the exact owned transcript establishes canonical session binding', () => {
  const f = fixture();
  try {
    const binding = {
      instanceId: randomUUID(),
      epoch: randomUUID(),
      manifestDigest: 'a'.repeat(64),
      configDigest: 'b'.repeat(64),
    };
    const read = ownedClaudeSession(f.config, binding)!;
    assert.equal(typeof read, 'function');
    f.send('UserPromptSubmit');
    f.send('Notification', { notification_type: 'permission_prompt' });
    assert.equal(read(), undefined);
    mkdirSync(join(f.transcript, '..'), { recursive: true, mode: 0o700 });
    writeFileSync(
      f.transcript,
      JSON.stringify({
        sessionId: f.config.sessionId,
        cwd: f.config.project,
        timestamp: '2026-11-05T00:00:00Z',
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Bash', input: { secret: 'SYNTHETIC_NEVER_READ_BY_HOOK' } },
          ],
        },
      }) + '\n',
      { mode: 0o600 },
    );
    const evidence = read()!;
    assert.equal(evidence.session.sessionId, f.config.sessionId);
    assert.equal(evidence.session.bindingEvidence, 'claude-argv-receipt-transcript');
    assert.equal(evidence.agentState, 'waiting_for_user');
    assert.equal(evidence.turnId, f.promptId);
    assert.equal(JSON.stringify(evidence).includes('SYNTHETIC_'), false);
  } finally {
    f.close();
  }
});

test('oversized input is discarded and an exhausted channel cannot retain a misleading state', () => {
  const f = fixture();
  try {
    const read = ownedClaudeHookEvidence(f.config);
    f.send('UserPromptSubmit', { prompt: 'SYNTHETIC_' + 'x'.repeat(70 * 1024) });
    assert.equal(readFileSync(f.channel).length, 0);
    f.send('UserPromptSubmit');
    f.send('PostToolUse');
    assert.equal(read().agentState, 'running');
    const row = readFileSync(f.channel, 'utf8').trimEnd().split('\n').at(-1)!;
    const line = row + '\n';
    let remaining = 128 * 1024 - 10 - statSync(f.channel).size;
    while (remaining > 512 + line.length) {
      appendFileSync(f.channel, line);
      remaining -= line.length;
    }
    if (remaining > 512) {
      appendFileSync(f.channel, line);
      remaining -= line.length;
    }
    assert.ok(remaining >= line.length);
    appendFileSync(f.channel, row + ' '.repeat(remaining - line.length) + '\n');
    assert.equal(read().agentState, 'running');
    f.send('Stop');
    assert.ok(statSync(f.channel).size <= 128 * 1024);
    assert.deepEqual(read(), { agentState: 'unknown' });
  } finally {
    f.close();
  }
});

test('mismatched cwd/transcript leaves a metadata-only unmatched marker and recovers at a new prompt', () => {
  for (const extra of [
    { cwd: '/SYNTHETIC/changed' },
    { transcript_path: '/SYNTHETIC/other.jsonl' },
  ]) {
    const f = fixture();
    try {
      const read = ownedClaudeHookEvidence(f.config);
      f.send('UserPromptSubmit');
      assert.equal(read().agentState, 'running');
      f.send('Stop', extra);
      assert.deepEqual(read(), { agentState: 'unknown' });
      assert.equal(
        JSON.parse(readFileSync(f.channel, 'utf8').trim().split('\n').at(-1)!).event,
        'unmatched',
      );
      assert.equal(readFileSync(f.channel, 'utf8').includes('SYNTHETIC'), false);
      f.send('PostToolUse');
      assert.deepEqual(read(), { agentState: 'unknown' });
      const next = randomUUID();
      f.send('UserPromptSubmit', { prompt_id: next });
      assert.deepEqual(read(), { agentState: 'running', turnId: next });
    } finally {
      f.close();
    }
  }
});

test('progress coalesces after prompt/progress but resumes waiting state, including tool failure', () => {
  const f = fixture();
  try {
    const read = ownedClaudeHookEvidence(f.config);
    f.send('UserPromptSubmit');
    const size = statSync(f.channel).size;
    for (let i = 0; i < 20; i++) f.send(i % 2 ? 'PostToolUseFailure' : 'PostToolUse');
    assert.equal(statSync(f.channel).size, size);
    assert.equal(read().agentState, 'running');
    f.send('Notification', { notification_type: 'permission_prompt' });
    assert.equal(read().agentState, 'waiting_for_user');
    f.send('PostToolUseFailure', { error: 'SYNTHETIC_PRIVATE_TOOL_ERROR' });
    assert.equal(read().agentState, 'running');
    const resumed = statSync(f.channel).size;
    f.send('PostToolUseFailure');
    f.send('PostToolUse');
    assert.equal(statSync(f.channel).size, resumed);
    f.send('Stop');
    assert.equal(read().agentState, 'completed');
    f.send('Notification', { notification_type: 'idle_prompt' });
    assert.equal(read().agentState, 'waiting_for_user');
    assert.equal(readFileSync(f.channel, 'utf8').includes('SYNTHETIC'), false);
  } finally {
    f.close();
  }
});

test('owned hook validation refuses MCP mode and unreviewed CLI versions', () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        validateClaudeOwnedHooks({
          ...f.config,
          interactive: { ...f.config.interactive, mcp: true },
        }),
      /reviewed Claude TUI/,
    );
    assert.throws(
      () => validateClaudeOwnedHooks({ ...f.config, executableVersion: '2.1.178' }),
      /reviewed Claude TUI/,
    );
  } finally {
    f.close();
  }
});
