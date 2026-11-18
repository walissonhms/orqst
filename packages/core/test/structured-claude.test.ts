import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { structuredAgentsUnavailableReasonSchema, structuredProviderSchema } from '@orqst/protocol';
import {
  inspectStructuredClaudeExecutable,
  reviewedStructuredClaudeBinary,
  spawnClaudeStreamJson,
  verifyClaudeManagedConfigAbsent,
  type OwnedClaudeProcess,
} from '../src/structured-agents/claude-process.js';
import { processTransport } from '../src/structured-agents/codex-process.js';
import { OwnedOpenCode } from '../src/structured-agents/opencode-process.js';
import { StructuredAgents } from '../src/structured-agents/service.js';
import { terminalExecutableSha256 } from '../src/terminal/codex-profile.js';

const scope = { workspaceId: 'a'.repeat(64), featureId: randomUUID() };
const other = { ...scope, featureId: randomUUID() };
const fixture = fileURLToPath(new URL('./fixtures/structured-claude.mjs', import.meta.url));
const codexFixture = fileURLToPath(new URL('./fixtures/structured-codex.mjs', import.meta.url));
const openCodeFixture = fileURLToPath(
  new URL('./fixtures/structured-opencode.mjs', import.meta.url),
);

const env = {
  PATH: '/usr/bin:/bin',
  ANTHROPIC_API_KEY: 'synthetic-not-forwarded',
  ANTHROPIC_AUTH_TOKEN: 'synthetic-not-forwarded',
  CLAUDE_CODE_OAUTH_TOKEN: 'synthetic-not-forwarded',
  ANTHROPIC_BASE_URL: 'https://example.invalid',
  ANTHROPIC_PROFILE: 'synthetic-profile',
  CLAUDECODE: '1',
  CLAUDE_CODE_SESSION_ID: randomUUID(),
  CLAUDE_CODE_HOST_SESSION_ID: randomUUID(),
  CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/synthetic.sock',
  ELECTRON_RUN_AS_NODE: '1',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'https://example.invalid',
  OTEL_EXPORTER_OTLP_HEADERS: 'synthetic-not-forwarded',
};

async function until(check: () => boolean) {
  const deadline = Date.now() + 4500;
  while (!check()) {
    if (Date.now() >= deadline) assert.fail('Timed out waiting for Claude stream-json evidence');
    await sleep(10);
  }
}

async function harness(t: TestContext, binary?: string) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'orqst-test-claude-')));
  const executable = binary ?? join(cwd, 'fake-claude');
  const openCodeExecutable = join(cwd, 'fake-opencode');
  const directories = {
    HOME: join(cwd, 'home'),
    TMPDIR: join(cwd, 'temp'),
    CLAUDE_CONFIG_DIR: join(cwd, 'claude-config'),
  };
  for (const dir of Object.values(directories)) await mkdir(dir, { recursive: true });
  if (!binary) {
    await writeFile(
      executable,
      '#!/bin/sh\nexec ' +
        JSON.stringify(process.execPath) +
        ' ' +
        JSON.stringify(fixture) +
        ' "$@"\n',
      { mode: 0o700 },
    );
  }
  await writeFile(
    openCodeExecutable,
    '#!/bin/sh\nexec ' +
      JSON.stringify(process.execPath) +
      ' ' +
      JSON.stringify(openCodeFixture) +
      ' "$@"\n',
    { mode: 0o700 },
  );
  const launch = {
    executable,
    cwd,
    env: binary
      ? { HOME: directories.HOME, TMPDIR: directories.TMPDIR, PATH: '/usr/bin:/bin' }
      : { ...env, ...directories },
    provider: 'claude' as const,
    ...(binary ? { bare: true } : {}),
  };
  const processes: OwnedClaudeProcess[] = [];
  const service = new StructuredAgents(
    () =>
      processTransport(
        spawn(process.execPath, [codexFixture], {
          cwd,
          env: { PATH: '/usr/bin:/bin' },
          stdio: ['pipe', 'pipe', 'ignore'],
          detached: true,
        }),
      ),
    Date.now,
    (input) => new OwnedOpenCode(input),
    (input) => {
      const owned = spawnClaudeStreamJson(input);
      processes.push(owned);
      return owned;
    },
  );
  t.after(async () => {
    await service.close();
    await rm(cwd, { recursive: true, force: true });
  });
  async function start(label: string) {
    assert.deepEqual(
      await service.apply(scope, { action: 'start', label, provider: 'claude' }, launch),
      { status: 'ok' },
    );
    return service.snapshot(scope).sessions.at(-1)!.sessionId;
  }
  async function startCodex() {
    assert.deepEqual(
      await service.apply(
        scope,
        { action: 'start', label: 'Codex fixture' },
        { executable: process.execPath, cwd, env: { PATH: '/usr/bin:/bin' } },
      ),
      { status: 'ok' },
    );
    return service.snapshot(scope).sessions.at(-1)!.sessionId;
  }
  async function startOpenCode() {
    assert.deepEqual(
      await service.apply(
        scope,
        { action: 'start', label: 'OpenCode fixture', provider: 'opencode' },
        {
          executable: openCodeExecutable,
          cwd,
          env: { HOME: directories.HOME, TMPDIR: directories.TMPDIR, PATH: '/usr/bin:/bin' },
          provider: 'opencode',
        },
      ),
      { status: 'ok' },
    );
    return service.snapshot(scope).sessions.at(-1)!.sessionId;
  }
  return {
    cwd,
    service,
    processes,
    launch,
    directories,
    start,
    startCodex,
    startOpenCode,
    session: (id: string) =>
      service.snapshot(scope).sessions.find((value) => value.sessionId === id)!,
  };
}

test('reviewed Claude pin inspection and managed-config guard enforce exact digests and policy', async (t) => {
  assert.ok(structuredProviderSchema.options.includes('claude'));
  assert.ok(structuredAgentsUnavailableReasonSchema.options.includes('provider_terms_unapproved'));
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'orqst-claude-pin-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const candidate = join(dir, 'claude');
  assert.deepEqual(inspectStructuredClaudeExecutable('relative/claude'), {
    ok: false,
    reason: 'executable_not_found',
  });
  assert.deepEqual(inspectStructuredClaudeExecutable(candidate), {
    ok: false,
    reason: 'executable_not_found',
  });
  await writeFile(candidate, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  assert.deepEqual(
    inspectStructuredClaudeExecutable(candidate, () => '0'.repeat(64)),
    { ok: false, reason: 'executable_unreviewed' },
  );
  assert.deepEqual(
    inspectStructuredClaudeExecutable(candidate, () => {
      throw new Error('hash error');
    }),
    { ok: false, reason: 'executable_inspection_failed' },
  );
  assert.deepEqual(
    inspectStructuredClaudeExecutable(candidate, () => reviewedStructuredClaudeBinary.sha256),
    {
      ok: true,
      executable: candidate,
      version: reviewedStructuredClaudeBinary.version,
      sha256: reviewedStructuredClaudeBinary.sha256,
    },
  );
  assert.throws(
    () => verifyClaudeManagedConfigAbsent(() => ({})),
    /managed configuration takes precedence/,
  );
});

test('synthetic Claude inherits supplied roots, strips secrets and preserves user files on stop', async (t) => {
  const { directories, service, session, start } = await harness(t);
  const sentinels = [directories.HOME, directories.CLAUDE_CONFIG_DIR].map((root) =>
    join(root, 'provider-sentinel'),
  );
  for (const path of sentinels) await writeFile(path, 'existing claude state');
  const sessionId = await start('Claude user roots');
  await service.apply(scope, { action: 'turn', sessionId, text: 'env:view' });
  await until(() => session(sessionId).turn?.state === 'completed');
  assert.deepEqual(JSON.parse(session(sessionId).items.at(-1)!.text), directories);
  await service.apply(scope, { action: 'stop', sessionId });
  assert.deepEqual(session(sessionId).exit, { code: 0, signal: null });
  for (const path of sentinels) assert.equal(await readFile(path, 'utf8'), 'existing claude state');
});

test('synthetic Claude omits unset or nonabsolute CLAUDE_CONFIG_DIR and TMPDIR overrides', async (t) => {
  const { launch, service, session, start, directories } = await harness(t);
  launch.env = {
    ...env,
    HOME: directories.HOME,
    CLAUDE_CONFIG_DIR: 'relative/claude',
    TMPDIR: '',
  };
  const sessionId = await start('Claude default directories');
  await service.apply(scope, { action: 'turn', sessionId, text: 'env:view' });
  await until(() => session(sessionId).turn?.state === 'completed');
  assert.deepEqual(JSON.parse(session(sessionId).items.at(-1)!.text), { HOME: directories.HOME });
});

test('Claude spawn failure leaves exit unproved and preserves user files', async (t) => {
  const { launch, service, directories } = await harness(t);
  const sentinel = join(directories.CLAUDE_CONFIG_DIR, 'provider-sentinel');
  await writeFile(sentinel, 'existing claude state');
  launch.executable = join(launch.cwd, 'missing-claude');
  await assert.rejects(
    service.apply(scope, { action: 'start', provider: 'claude', label: 'Spawn failure' }, launch),
    { reason: 'provider_connection_failed' },
  );
  const [failed] = service.snapshot(scope).sessions;
  assert.equal(failed?.lifecycle, 'failed');
  assert.equal(failed?.exit, null);
  assert.equal(await readFile(sentinel, 'utf8'), 'existing claude state');
});

test(
  'synthetic Claude routes one-shot approvals, sanitizes output, deduplicates usage, interrupts and reaps process groups',
  { timeout: 15_000 },
  async (t) => {
    const { service, session, processes, start } = await harness(t);
    const sessionId = await start('Claude fixture');
    assert.equal(session(sessionId).provider, 'claude');
    assert.deepEqual(service.snapshot(other).sessions, []);

    for (const [text, kind, decision, expected] of [
      ['approval:bash', 'command', 'accept', 'bash:allow'],
      ['approval:edit', 'file_change', 'decline', 'edit:deny'],
      ['approval:read', 'permission', 'accept', 'read:allow'],
      ['approval:unsupported', 'unsupported', 'decline', 'unsupported:deny'],
    ] as const) {
      await service.apply(scope, { action: 'turn', sessionId, text });
      await until(() =>
        session(sessionId).approvals.some((approval) => approval.state === 'pending'),
      );
      const approval = session(sessionId).approvals.find((entry) => entry.state === 'pending')!;
      assert.equal(approval.kind, kind);
      assert.ok(!approval.detail.includes(String.fromCharCode(0x1b)));
      const request = {
        action: 'approval',
        sessionId,
        approvalId: approval.approvalId,
        decision,
      } as const;
      assert.deepEqual(await service.apply(other, request), { status: 'denied' });
      if (kind === 'unsupported') {
        assert.deepEqual(await service.apply(scope, { ...request, decision: 'accept' }), {
          status: 'denied',
        });
      }
      assert.deepEqual(await service.apply(scope, request), { status: 'ok' });
      assert.deepEqual(await service.apply(scope, request), { status: 'denied' });
      await until(() => session(sessionId).turn?.state === 'completed');
      assert.equal(session(sessionId).items.at(-1)?.text, expected);
      assert.equal(session(sessionId).reportedModel, 'claude-synthetic-5');
    }

    await service.apply(scope, { action: 'turn', sessionId, text: 'approval:bash' });
    await until(() => session(sessionId).approvals.some((entry) => entry.state === 'pending'));
    const cancelTarget = session(sessionId).approvals.find((entry) => entry.state === 'pending')!;
    await service.apply(scope, {
      action: 'approval',
      sessionId,
      approvalId: cancelTarget.approvalId,
      decision: 'cancel',
    });
    await until(() => session(sessionId).turn?.state === 'interrupted');

    await service.apply(scope, { action: 'turn', sessionId, text: 'approval:withdraw' });
    await until(() => session(sessionId).turn?.state === 'completed');
    assert.ok(session(sessionId).approvals.some((entry) => entry.state === 'unavailable'));

    const beforeUsage = session(sessionId).usage!.usage;
    await service.apply(scope, { action: 'turn', sessionId, text: 'stream' });
    await until(() => session(sessionId).items.at(-1)?.status === 'in_progress');
    assert.equal(session(sessionId).items.at(-1)?.text, 'partial text');
    await until(() => session(sessionId).turn?.state === 'completed');
    assert.equal(session(sessionId).items.at(-1)?.text, 'final text');
    assert.ok(
      session(sessionId).items.every(
        ({ text }) =>
          !text.includes('subagent internal output') && !text.includes('foreign session output'),
      ),
    );
    // msg_stream was emitted twice (parallel chunks) with input=15+5+20=40, cached=20, output=18.
    const afterUsage = session(sessionId).usage!;
    assert.equal(afterUsage.usage.input - beforeUsage.input, 40);
    assert.equal(afterUsage.usage.cached - beforeUsage.cached, 20);
    assert.equal(afterUsage.usage.output - beforeUsage.output, 18);
    assert.deepEqual(afterUsage.cost, {
      amount: 0.0042,
      currency: 'USD',
      source: 'claude_estimate',
    });

    await service.apply(scope, { action: 'turn', sessionId, text: 'interrupt' });
    await until(() => session(sessionId).turn?.state === 'running');
    await service.apply(scope, { action: 'interrupt', sessionId });
    await until(() => session(sessionId).turn?.state === 'interrupted');
    assert.equal(session(sessionId).lifecycle, 'ready');
    assert.ok(
      session(sessionId).items.every(({ text }) => !text.startsWith('[Request interrupted')),
    );

    await service.apply(scope, { action: 'turn', sessionId, text: 'spawn child' });
    await until(() => session(sessionId).turn?.state === 'completed');
    const childPid = Number(session(sessionId).items.at(-1)!.text.split(':')[1]);
    assert.ok(childPid > 0);
    const leaderPid = processes[0]!.transport.pid!;
    await service.apply(scope, { action: 'stop', sessionId });
    assert.deepEqual(session(sessionId).exit, { code: 0, signal: null });
    assert.throws(() => process.kill(leaderPid, 0), { code: 'ESRCH' });
    await until(() => {
      try {
        process.kill(childPid, 0);
        return false;
      } catch (error) {
        assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH');
        return true;
      }
    });
  },
);

test('synthetic Claude crash mid-turn retains unknown outcome and denies subsequent turns', async (t) => {
  const { service, session, start } = await harness(t);
  const sessionId = await start('Crash session');
  await service.apply(scope, { action: 'turn', sessionId, text: 'crash' });
  await until(() => session(sessionId).lifecycle === 'failed');
  assert.equal(session(sessionId).turn?.state, 'unknown');
  assert.deepEqual(session(sessionId).exit, { code: 17, signal: null });
  assert.deepEqual(await service.apply(scope, { action: 'turn', sessionId, text: 'env:view' }), {
    status: 'denied',
  });
});

test(
  'synthetic Claude sees Feature-scoped peers and enforces one-use grant and receipt evidence',
  { timeout: 15_000 },
  async (t) => {
    const { service, session, launch, start } = await harness(t);
    const sourceSessionId = await start('Claude A');
    const targetSessionId = await start('Claude B');
    await service.apply(
      other,
      { action: 'start', label: 'Other Feature', provider: 'claude' },
      launch,
    );

    await service.apply(scope, { action: 'turn', sessionId: sourceSessionId, text: 'peers:view' });
    await until(() => session(sourceSessionId).turn?.state === 'completed');
    assert.deepEqual(JSON.parse(session(sourceSessionId).items.at(-1)!.text), [
      {
        sessionId: targetSessionId,
        label: 'Claude B',
        provider: 'claude',
        lifecycle: 'ready',
        busy: false,
        turnState: null,
        awaitingApproval: false,
      },
    ]);

    const task = 'Summarize synthetic module';
    const grant = { action: 'grant', sourceSessionId, targetSessionId, task } as const;
    assert.deepEqual(await service.apply(other, grant), { status: 'denied' });
    assert.deepEqual(await service.apply(scope, grant), { status: 'ok' });

    const call = (value: string, prefix = 'delegate:') =>
      service.apply(scope, {
        action: 'turn',
        sessionId: sourceSessionId,
        text: prefix + JSON.stringify({ targetPaneId: targetSessionId, task: value }),
      });

    await call(task + ' forged');
    await until(
      () => session(sourceSessionId).turn?.state === 'completed' && !session(sourceSessionId).busy,
    );
    assert.equal(session(targetSessionId).turn, null);

    await call(task);
    await until(() => service.snapshot(scope).delegations[0]?.state === 'returned');
    await until(
      () => session(sourceSessionId).turn?.state === 'completed' && !session(sourceSessionId).busy,
    );
    assert.equal(
      session(sourceSessionId).items.at(-1)?.text,
      `claude-source:claude-worker:${task}`,
    );

    const targetTurnId = session(targetSessionId).turn?.turnId;
    await call(task);
    await until(
      () => session(sourceSessionId).turn?.state === 'completed' && !session(sourceSessionId).busy,
    );
    assert.equal(session(targetSessionId).turn?.turnId, targetTurnId);

    // Crash before tool_result receipt leaves delegation state unknown rather than returned.
    assert.deepEqual(await service.apply(scope, grant), { status: 'ok' });
    await call(task, 'delegate-crash:');
    await until(() => session(sourceSessionId).lifecycle === 'failed');
    assert.equal(service.snapshot(scope).delegations.at(-1)?.state, 'unknown');
  },
);

test(
  'synthetic mixed routes delegate between Claude, Codex and OpenCode in both directions',
  { timeout: 20_000 },
  async (t) => {
    const { service, session, start, startCodex, startOpenCode } = await harness(t);
    const claude = await start('Claude');
    const codex = await startCodex();
    const openCode = await startOpenCode();
    const task = 'Exact cross-provider task';

    for (const [sourceSessionId, targetSessionId] of [
      [claude, codex],
      [codex, claude],
      [claude, openCode],
      [openCode, claude],
    ] as const) {
      assert.deepEqual(
        await service.apply(scope, { action: 'grant', sourceSessionId, targetSessionId, task }),
        { status: 'ok' },
      );
      const text =
        sourceSessionId === openCode
          ? 'request the authorized mixed delegation'
          : 'delegate:' + JSON.stringify({ targetPaneId: targetSessionId, task });
      await service.apply(scope, { action: 'turn', sessionId: sourceSessionId, text });
      await until(() => service.snapshot(scope).delegations.at(-1)?.state === 'returned');
      await until(
        () =>
          session(sourceSessionId).turn?.state === 'completed' && !session(sourceSessionId).busy,
      );
    }
    assert.equal(service.snapshot(scope).delegations.length, 4);
    assert.ok(service.snapshot(scope).delegations.every((entry) => entry.state === 'returned'));
  },
);

const real = process.env.ORQST_STRUCTURED_REAL_CLAUDE;
test(
  'pinned Claude bare handshake smoke in disposable cwd/HOME with no login or model prompt',
  { skip: !real, timeout: 60_000 },
  async (t) => {
    const executable = await realpath(real!);
    assert.equal(terminalExecutableSha256(executable), reviewedStructuredClaudeBinary.sha256);
    const { service, session, processes, start } = await harness(t, executable);
    const sessionId = await start('Claude bare handshake smoke');
    assert.equal(session(sessionId).lifecycle, 'ready');
    assert.equal(session(sessionId).turn, null);
    assert.match(session(sessionId).threadId ?? '', /^[0-9a-f-]{36}$/i);
    const pid = processes[0]!.transport.pid!;
    await service.close();
    assert.deepEqual(session(sessionId).exit, { code: 0, signal: null });
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  },
);
