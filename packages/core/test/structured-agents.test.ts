import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { StructuredAgentsRequest, StructuredApproval } from '@orqst/protocol';
import { StructuredAgents } from '../src/structured-agents/service.js';
import {
  processTransport,
  structuredCodexEnvironment,
} from '../src/structured-agents/codex-process.js';

const scope = { workspaceId: 'a'.repeat(64), featureId: randomUUID() };
const other = { ...scope, featureId: randomUUID() };
const fixture = fileURLToPath(new URL('./fixtures/structured-codex.mjs', import.meta.url));
const created = {
  executable: process.execPath,
  cwd: process.cwd(),
  env: { PATH: '/usr/bin:/bin' },
};
const ids = (service: StructuredAgents) =>
  service.snapshot(scope).sessions.map(({ sessionId }) => sessionId);
const session = (service: StructuredAgents, id: string) =>
  service.snapshot(scope).sessions.find(({ sessionId }) => sessionId === id)!;

function synthetic() {
  const children: ReturnType<typeof processTransport>[] = [];
  const service = new StructuredAgents(() => {
    const child = processTransport(
      spawn(process.execPath, [fixture], {
        detached: true,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: created.env,
        cwd: created.cwd,
      }),
    );
    children.push(child);
    return child;
  });
  return { service, children };
}

async function until(check: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() >= deadline) assert.fail('Timed out waiting for synthetic protocol evidence');
    await sleep(10);
  }
}

test(
  'synthetic app-server routes human approvals and distinguishes interrupt and process exit',
  { timeout: 12_000 },
  async (t) => {
    const { service, children } = synthetic();
    t.after(() => service.close());
    assert.deepEqual(await service.apply(scope, { action: 'start', label: 'synthetic' }, created), {
      status: 'ok',
    });
    const [sessionId] = ids(service);
    assert.ok(sessionId);
    assert.equal(session(service, sessionId).reportedModel, 'synthetic-model');
    assert.deepEqual(service.snapshot(other), { sessions: [], delegations: [] });
    assert.deepEqual(
      await service.apply(other, { action: 'turn', sessionId, text: 'cross-feature' }),
      { status: 'denied' },
    );

    for (const [text, kind, decision] of [
      ['approval:command', 'command', 'accept'],
      ['approval:file', 'file_change', 'decline'],
      ['approval:permissions', 'unsupported', 'decline'],
    ] as const) {
      await service.apply(scope, { action: 'turn', sessionId, text });
      await until(() =>
        session(service, sessionId).approvals.some((entry) => entry.state === 'pending'),
      );
      const approval: StructuredApproval = session(service, sessionId).approvals.find(
        (entry) => entry.state === 'pending',
      )!;
      assert.equal(approval.kind, kind);
      assert.equal(session(service, sessionId).turn?.state, 'running');
      await sleep(35);
      assert.equal(session(service, sessionId).approvals.at(-1)?.state, 'pending');
      const request: Extract<StructuredAgentsRequest, { action: 'approval' }> = {
        action: 'approval',
        sessionId,
        approvalId: approval.approvalId,
        decision,
      } as const;
      assert.deepEqual(await service.apply(other, request), { status: 'denied' });
      if (kind === 'unsupported')
        assert.deepEqual(await service.apply(scope, { ...request, decision: 'accept' }), {
          status: 'denied',
        });
      assert.deepEqual(await service.apply(scope, request), { status: 'ok' });
      assert.deepEqual(await service.apply(scope, request), { status: 'denied' });
      await until(() => session(service, sessionId).turn?.state === 'completed');
      assert.equal(session(service, sessionId).approvals.at(-1)?.state, 'resolved');
    }
    const projected = session(service, sessionId).items;
    assert.ok(projected.some(({ kind }) => kind === 'command'));
    assert.ok(projected.some(({ kind }) => kind === 'file_change'));
    assert.ok(projected.some(({ text }) => text === 'Synthetic approval accepted.'));
    assert.ok(
      projected.every(({ text }) => !text.includes('unrelated thread') && text !== 'Provisional'),
    );

    await service.apply(scope, { action: 'turn', sessionId, text: 'turn:wait' });
    await service.apply(scope, { action: 'interrupt', sessionId });
    assert.equal(session(service, sessionId).turn?.state, 'running');
    await until(() => session(service, sessionId).turn?.state === 'interrupted');
    assert.equal(session(service, sessionId).exit, null);

    await service.apply(scope, { action: 'turn', sessionId, text: 'turn:descendant' });
    await until(() => session(service, sessionId).turn?.state === 'completed');
    const pid = Number(session(service, sessionId).items.at(-1)!.text.split(':')[1]);
    assert.ok(pid > 0);
    assert.doesNotThrow(() => process.kill(pid, 0));
    await service.apply(scope, { action: 'turn', sessionId, text: 'turn:wait' });
    await service.apply(scope, { action: 'stop', sessionId });
    assert.equal(session(service, sessionId).turn?.state, 'interrupted');
    assert.deepEqual(await children[0]!.exited, { code: null, signal: 'SIGKILL' });
    assert.equal(session(service, sessionId).lifecycle, 'exited');
    await until(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch (error) {
        assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH');
        return true;
      }
    });
  },
);

test(
  'synthetic A → B → A uses the exact one-shot grant and native result evidence',
  { timeout: 12_000 },
  async (t) => {
    const { service } = synthetic();
    t.after(() => service.close());
    await service.apply(scope, { action: 'start', label: 'Source' }, created);
    await service.apply(scope, { action: 'start', label: 'Worker' }, created);
    const [sourceSessionId, targetSessionId] = ids(service);
    assert.ok(sourceSessionId && targetSessionId);
    const task = 'Report a synthetic result';
    const grant = { action: 'grant', sourceSessionId, targetSessionId, task } as const;
    const delegate = (value: string) =>
      service.apply(scope, {
        action: 'turn',
        sessionId: sourceSessionId,
        text: 'delegate:' + JSON.stringify({ targetPaneId: targetSessionId, task: value }),
      });

    await delegate(task);
    await until(() => session(service, sourceSessionId).turn?.state === 'completed');
    assert.equal(session(service, targetSessionId).turn, null);
    assert.deepEqual(await service.apply(other, grant), { status: 'denied' });
    await service.apply(scope, grant);
    await delegate(task + '.');
    await until(() => session(service, sourceSessionId).turn?.state === 'completed');
    assert.equal(session(service, targetSessionId).turn, null);

    await delegate(task);
    await until(() => service.snapshot(scope).delegations[0]?.state === 'running');
    const during = service.snapshot(scope).delegations[0]!;
    assert.equal(during.targetTurnId, session(service, targetSessionId).turn?.turnId);
    await until(() => service.snapshot(scope).delegations[0]?.state === 'returned');
    assert.equal(session(service, targetSessionId).turn?.state, 'completed');
    assert.equal(session(service, targetSessionId).turn?.origin, 'delegation');
    assert.equal(
      session(service, sourceSessionId).items.at(-1)?.text,
      `Synthetic source received: worker:${task}`,
    );
    const targetTurn = session(service, targetSessionId).turn?.turnId;
    await delegate(task);
    await until(() => session(service, sourceSessionId).turn?.state === 'completed');
    assert.equal(session(service, targetSessionId).turn?.turnId, targetTurn);
    assert.equal(service.snapshot(scope).delegations.length, 1);
  },
);

test(
  'synthetic unexpected transport loss leaves the accepted turn unknown',
  { timeout: 5000 },
  async (t) => {
    const { service } = synthetic();
    t.after(() => service.close());
    await service.apply(scope, { action: 'start', label: 'Exit' }, created);
    const [sessionId] = ids(service);
    assert.ok(sessionId);
    await service.apply(scope, { action: 'turn', sessionId, text: 'transport:lost' });
    await until(() => session(service, sessionId).lifecycle === 'failed');
    assert.equal(session(service, sessionId).turn?.state, 'unknown');
    assert.deepEqual(session(service, sessionId).exit, { code: 23, signal: null });
  },
);

const realCodex = process.env.ORQST_STRUCTURED_REAL_CODEX;
test(
  '[real Codex, disposable home] initializes a read-only thread and exits',
  { skip: !realCodex, timeout: 70_000 },
  async () => {
    assert.ok(realCodex && realCodex.startsWith('/'));
    const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-structured-real-')));
    const project = join(root, 'project');
    const codexHome = join(root, 'codex-home');
    const service = new StructuredAgents();
    try {
      await mkdir(project);
      await mkdir(codexHome);
      const reply = await service.apply(
        scope,
        { action: 'start', label: 'Disposable local protocol check' },
        {
          executable: realCodex,
          cwd: project,
          env: structuredCodexEnvironment({
            HOME: root,
            PATH: '/usr/bin:/bin',
            CODEX_HOME: codexHome,
          }),
        },
      );
      assert.equal(reply.status, 'ok');
      const [live] = service.snapshot(scope).sessions;
      assert.ok(live?.threadId);
      assert.equal(live.lifecycle, 'ready');
      await service.apply(scope, { action: 'stop', sessionId: live.sessionId });
      assert.equal(session(service, live.sessionId).lifecycle, 'exited');
      assert.ok(session(service, live.sessionId).exit);
    } finally {
      await service.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
