// Synthetic inherited IPC peer. fork is replaced in this disposable bundle; no Core/PTY starts.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type {
  TerminalEnrollmentInput,
  TerminalEnrollmentMember,
  TerminalEnrollmentReceipt,
} from '@orqst/protocol';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';

const bundle = realpathSync(
  mkdtempSync(join(tmpdir(), 'orqst-synthetic-enrollment-client-bundle-')),
);
after(() => rmSync(bundle, { recursive: true, force: true }));
await build({
  entryPoints: [resolve('apps/desktop/src/managed-terminal-core.ts')],
  outfile: join(bundle, 'client.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  logLevel: 'silent',
  plugins: [
    {
      name: 'no-core-child',
      setup(builder) {
        builder.onResolve({ filter: /^node:child_process$/ }, () => ({
          path: 'synthetic-fork',
          namespace: 'synthetic',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, () => ({
          contents:
            "export const fork = (...args) => globalThis[Symbol.for('orqst.synthetic.enrollment.fork')](...args);",
          loader: 'js',
        }));
      },
    },
  ],
});
const client = (await import(
  pathToFileURL(join(bundle, 'client.mjs')).href
)) as typeof import('../apps/desktop/src/managed-terminal-core.js');

async function fixture(
  mode: 'ready' | 'refused' | 'wrong-id' | 'eof' | 'timeout' | 'reserved' = 'ready',
  probe?: { peer?: EventEmitter; forks?: number },
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-enrollment-client-')));
  const project = join(root, 'project');
  const state = join(root, 'state');
  for (const path of [project, state]) mkdirSync(path, { mode: 0o700 });
  for (const name of ['home', 'codex', 'tmp']) mkdirSync(join(state, name), { mode: 0o700 });
  const terminalId = randomUUID();
  const config: ManagedCodexConfig = {
    version: 1,
    trust: 'native-same-user',
    identity: { terminalId },
    executable: {
      path: realpathSync('/usr/bin/true'),
      sha256: terminalExecutableSha256(realpathSync('/usr/bin/true')),
    },
    node: {
      path: realpathSync(process.execPath),
      sha256: terminalExecutableSha256(realpathSync(process.execPath)),
    },
    executableVersion: 'SYNTHETIC-NEVER-EXECUTED',
    project,
    state,
  };
  const manifest = join(root, 'manifest.json');
  writeFileSync(manifest, JSON.stringify(config), { mode: 0o600 });
  writeFileSync(join(state, 'codex/config.toml'), managedCodexSettings(config), { mode: 0o600 });
  const epoch = randomUUID();
  const requests: Array<Record<string, unknown>> = [];
  let forks = 0;
  let disconnects = 0;
  let dropEnrollment = false;
  let mismatchEpoch = false;
  let revision = 0;
  const original: TerminalEnrollmentMember = {
    terminalId,
    slot: 0,
    alias: `P-${terminalId}`,
    provider: 'codex',
    workspaceId: terminalDigest('synthetic-workspace'),
    featureId: null,
    admissionRevision: 0,
    bindingDigest: terminalDigest('original'),
    status: 'ready',
  };
  const members = [original];
  const receipts = new Map<string, TerminalEnrollmentReceipt>();
  const peer = new EventEmitter() as EventEmitter & {
    connected: boolean;
    disconnect(): void;
    send(request: Record<string, unknown>, callback: (error?: Error) => void): boolean;
  };
  peer.connected = true;
  peer.disconnect = () => {
    disconnects++;
    peer.connected = false;
    peer.emit('disconnect');
  };
  const reply = (request: Record<string, unknown>, value: unknown) =>
    peer.emit('message', {
      id: request.id ?? (request.request as { id: string }).id,
      ok: true,
      value,
    });
  peer.send = (request, callback) => {
    requests.push(request);
    callback();
    queueMicrotask(() => {
      if (request.kind === 'enroll') {
        const input = request.input as TerminalEnrollmentInput;
        const member: TerminalEnrollmentMember = {
          ...original,
          terminalId: randomUUID(),
          slot: 1,
          provider: 'claude',
          requestedModel: 'synthetic-claude',
          admissionRevision: ++revision,
        };
        members.push(member);
        const receipt: TerminalEnrollmentReceipt = {
          ...input,
          epoch: mismatchEpoch ? randomUUID() : epoch,
          revision,
          status: 'ready',
          reason: 'admitted',
          member,
        };
        receipts.set(input.opId, receipt);
        if (!dropEnrollment) reply(request, receipt);
      } else if (request.kind === 'enrollmentInspect') {
        reply(request, {
          version: 1,
          epoch,
          revision,
          capacity: 3,
          reservedSlots: members.length,
          members,
          receipt: receipts.get(String(request.opId)) ?? null,
        });
      } else if (request.kind === 'terminal') {
        const operation = (request.request as { operation: string }).operation;
        reply(
          request,
          operation === 'read'
            ? { bytes: [65, 66], nextCursor: 2, gap: false }
            : { state: 'running', instanceId: 'synthetic-original-instance', epoch },
        );
      }
    });
    return true;
  };
  Reflect.set(
    globalThis,
    Symbol.for('orqst.synthetic.enrollment.fork'),
    (_host: string, args: string[]) => {
      forks++;
      if (probe) {
        probe.peer = peer;
        probe.forks = forks;
      }
      queueMicrotask(() => {
        if (mode === 'timeout') return;
        if (mode === 'eof') return void peer.emit('disconnect');
        if (mode === 'refused' || mode === 'wrong-id') {
          // Simulate the authoritative child finding a reservation after the parent preflight.
          mkdirSync(join(root, 'admission'), { mode: 0o700 });
          writeFileSync(
            join(root, 'admission/active-pair.json'),
            JSON.stringify({ version: 1, owner: randomUUID(), manifests: [manifest] }),
            { mode: 0o600 },
          );
          return void peer.emit('message', {
            type: 'startup-failure',
            id: mode === 'wrong-id' ? randomUUID() : args[4],
            failure: { stage: 'core_admission', code: 'capacity_reserved', effects: 'possible' },
          });
        }
        peer.emit('message', {
          type: 'ready',
          id: args[4],
          admissionOwner: randomUUID(),
          initialFiles: [manifest],
          epoch,
          identities: [{ slot: 0, terminalId, alias: `P-${terminalId}`, provider: 'codex' }],
        });
      });
      return peer;
    },
  );
  if (mode === 'reserved') {
    mkdirSync(join(root, 'admission'), { mode: 0o700 });
    writeFileSync(
      join(root, 'admission/active-pair.json'),
      JSON.stringify({ version: 1, owner: randomUUID(), manifests: [manifest] }),
      { mode: 0o600 },
    );
  }
  const keys = generateKeyPairSync('ed25519');
  const connection = client.connectManagedTerminalCore(
    [manifest],
    '/synthetic/never-forked',
    keys.publicKey,
    join(root, 'admission'),
    3,
  );
  let core: Awaited<typeof connection>;
  try {
    core = await connection;
  } catch (error) {
    assert.equal(forks, mode === 'reserved' ? 0 : 1);
    assert.ok(disconnects <= 1);
    Reflect.deleteProperty(globalThis, Symbol.for('orqst.synthetic.enrollment.fork'));
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  const input = (): TerminalEnrollmentInput => ({
    version: 1,
    epoch,
    opId: randomUUID(),
    expectedRevision: 0,
    workspaceId: original.workspaceId,
    featureId: null,
  });
  return {
    core,
    input,
    requests,
    receipts,
    peer,
    counts: () => ({ forks, disconnects }),
    drop: () => {
      dropEnrollment = true;
    },
    mismatch: () => {
      mismatchEpoch = true;
    },
    late: () => {
      const request = requests.find((request) => request.kind === 'enroll')!;
      reply(request, receipts.get((request.input as TerminalEnrollmentInput).opId));
    },
    close() {
      core.close();
      Reflect.deleteProperty(globalThis, Symbol.for('orqst.synthetic.enrollment.fork'));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('client appends only confirmed admitted metadata and supervisor, preserving original references', async () => {
  const f = await fixture();
  try {
    const identities = f.core.identities;
    const supervisors = f.core.supervisors;
    const original = supervisors[0]!;
    const request = f.input();
    assert.equal(f.core.epoch, request.epoch);
    const before = await f.core.enrollmentInspect(request.opId);
    assert.equal(before.revision, 0);
    assert.equal(before.receipt, null);
    const receipt = await f.core.enroll(request, '/synthetic/trusted-new.json');
    assert.equal(receipt.status, 'ready');
    assert.equal(identities, f.core.identities);
    assert.equal(supervisors, f.core.supervisors);
    assert.equal(supervisors[0], original);
    assert.equal(supervisors.length, 2);
    assert.equal(identities[1]?.provider, 'claude');
    assert.deepEqual(await f.core.enroll(request, '/synthetic/trusted-new.json'), receipt);
    assert.equal(f.requests.filter((request) => request.kind === 'enroll').length, 1);
    await assert.rejects(f.core.enroll(request, '/synthetic/rebound.json'), /rebound/);
    const snapshot = await original.snapshot(randomUUID());
    assert.equal(snapshot.state, 'running');
    const output = await original.read(randomUUID(), randomUUID(), 0);
    assert.deepEqual(output.bytes, Uint8Array.from([65, 66]));
    assert.equal((await f.core.enrollmentInspect(request.opId)).receipt?.opId, request.opId);
    assert.equal(
      f.requests.some(
        (request) =>
          request.kind === 'terminal' &&
          ['launch', 'attach', 'enableInput'].includes(
            (request.request as { operation: string }).operation,
          ),
      ),
      false,
    );
    assert.deepEqual(f.counts(), { forks: 1, disconnects: 0 });
  } finally {
    f.close();
  }
});

test('enrollment timeout and late ready ACK preserve Core, old supervisor and do not adopt the slot', async (t) => {
  const f = await fixture();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const old = f.core.supervisors[0]!;
    f.drop();
    const request = f.input();
    const enroll = f.core.enroll(request, '/synthetic/trusted-new.json');
    const rejected = assert.rejects(enroll, /unconfirmed/);
    await Promise.resolve();
    t.mock.timers.tick(12_000);
    await rejected;
    assert.equal(f.core.supervisors.length, 1);
    assert.equal(f.core.identities.length, 1);
    assert.deepEqual(f.counts(), { forks: 1, disconnects: 0 });
    const inspected = await f.core.enrollmentInspect(request.opId);
    assert.equal(inspected.receipt?.status, 'ready');
    assert.equal(f.core.supervisors.length, 1); // Observation never adopts/replays an uncertain call.
    f.late();
    assert.equal(f.core.supervisors.length, 1);
    assert.equal(f.core.supervisors[0], old);
    assert.equal((await old.snapshot(randomUUID())).state, 'running');
    await assert.rejects(
      f.core.enroll(request, '/synthetic/trusted-new.json'),
      /already attempted/,
    );
    assert.equal(f.requests.filter((request) => request.kind === 'enroll').length, 1);
    assert.deepEqual(f.counts(), { forks: 1, disconnects: 0 });
  } finally {
    f.close();
  }
});

test('wrong epoch is refused before IPC; mismatched ACK cannot replace old identities', async () => {
  const f = await fixture();
  try {
    const request = f.input();
    await assert.rejects(
      f.core.enroll({ ...request, epoch: randomUUID() }, '/synthetic/trusted.json'),
      /epoch/,
    );
    assert.equal(f.requests.length, 0);
    f.mismatch();
    await assert.rejects(f.core.enroll(request, '/synthetic/trusted.json'), /binding changed/);
    assert.equal(f.core.supervisors.length, 1);
    assert.equal(f.core.identities.length, 1);
    assert.equal((await f.core.supervisors[0]!.snapshot(randomUUID())).state, 'running');
    assert.deepEqual(f.counts(), { forks: 1, disconnects: 0 });
  } finally {
    f.close();
  }
});

for (const [mode, stage, code] of [
  ['reserved', 'core_admission', 'capacity_reserved'],
  ['refused', 'core_admission', 'capacity_reserved'],
  ['wrong-id', 'core_startup', 'startup_protocol'],
  ['eof', 'core_startup', 'startup_eof'],
] as const) {
  test(`startup ${mode} remains bounded and uncertain without another fork`, async () => {
    await assert.rejects(fixture(mode), (error: unknown) => {
      assert.deepEqual(Reflect.get(error as object, 'failure'), {
        stage,
        code,
        effects: 'possible',
      });
      return true;
    });
  });
}

test('startup timeout cannot be downgraded or revived by a late ready/refusal ACK', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const probe: { peer?: EventEmitter; forks?: number } = {};
  const startup = fixture('timeout', probe);
  const rejected = assert.rejects(startup, (error: unknown) => {
    assert.deepEqual(Reflect.get(error as object, 'failure'), {
      stage: 'core_startup',
      code: 'startup_timeout',
      effects: 'possible',
    });
    return true;
  });
  await Promise.resolve();
  t.mock.timers.tick(10_000);
  await rejected;
  probe.peer!.emit('message', { type: 'ready', id: randomUUID(), epoch: randomUUID() });
  probe.peer!.emit('message', {
    type: 'startup-failure',
    id: randomUUID(),
    failure: { stage: 'admission_preflight', code: 'capacity_reserved', effects: 'not_started' },
  });
  assert.equal(probe.forks, 1);
});
