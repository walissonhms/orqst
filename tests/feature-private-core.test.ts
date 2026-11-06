// SYNTHETIC private inherited IPC. /usr/bin/true is pinned but NEVER executed as an agent.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { build } from 'esbuild';
import {
  workspaceFeatureSchema,
  terminalTeamStateSchema,
  terminalLayoutRecordSchema,
} from '@orqst/protocol';
import { stableId } from '@orqst/shared';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';

test('owned Core private Feature RPC persists metadata for six terminals without agent launch/admission', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-feature-ipc-')));
  chmodSync(root, 0o700);
  const project = join(root, 'project');
  const admission = join(root, 'admission');
  mkdirSync(project, { mode: 0o700 });
  const helper = join(root, 'core.cjs');
  await build({
    entryPoints: [resolve('packages/core/src/terminal/host.ts')],
    outfile: helper,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    bundle: true,
    external: ['node-pty'],
    logLevel: 'silent',
  });
  const executable = realpathSync('/usr/bin/true');
  const binary = { path: executable, sha256: terminalExecutableSha256(executable) };
  const node = {
    path: realpathSync(process.execPath),
    sha256: terminalExecutableSha256(realpathSync(process.execPath)),
  };
  const ids = Array.from({ length: 6 }, () => randomUUID());
  const manifests = ids.map((terminalId, slot) => {
    const state = join(root, `state-${slot}`);
    mkdirSync(state, { mode: 0o700 });
    for (const dir of ['home', 'codex', 'tmp']) mkdirSync(join(state, dir), { mode: 0o700 });
    const config: ManagedCodexConfig = {
      version: 1,
      trust: 'native-same-user',
      identity: { terminalId },
      executable: binary,
      executableVersion: 'SYNTHETIC-NEVER-LAUNCHED',
      node,
      project,
      state,
    };
    const file = join(root, `manifest-${slot}.json`);
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    writeFileSync(join(state, 'codex/config.toml'), managedCodexSettings(config), { mode: 0o600 });
    return file;
  });
  const keys = generateKeyPairSync('ed25519');
  const child = fork(
    helper,
    [
      JSON.stringify(manifests),
      keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
      admission,
      '6',
      'startup-1',
    ],
    {
      execPath: process.execPath,
      execArgv: [],
      cwd: root,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { HOME: root, PATH: '/usr/bin:/bin' },
    },
  );
  const exit = once(child, 'exit');
  let diagnostics = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    diagnostics = (diagnostics + chunk.toString()).slice(-4096);
  });
  const pending = new Map<string, (value: { ok: boolean; value: unknown }) => void>();
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  child.on('message', (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    if (Reflect.get(raw, 'type') === 'ready') return ready();
    const id = String(Reflect.get(raw, 'id'));
    pending.get(id)?.({ ok: Reflect.get(raw, 'ok') === true, value: Reflect.get(raw, 'value') });
    pending.delete(id);
  });
  const call = (operation: object) =>
    new Promise<{ ok: boolean; value: unknown }>((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Synthetic Core RPC timed out'));
      }, 10000);
      pending.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      child.send({ ...operation, id });
    });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 20000);
  try {
    await Promise.race([
      started,
      exit.then(() => {
        throw new Error(`Synthetic startup failed: ${diagnostics}`);
      }),
    ]);
    assert.deepEqual((await call({ kind: 'featureList' })).value, []);
    assert.deepEqual(await call({ kind: 'communicationProjection', featureId: null }), {
      ok: true,
      value: null,
    });
    const created = await call({ kind: 'featureCreate', input: { name: 'SYNTHETIC Feature' } });
    assert.equal(created.ok, true);
    let feature = workspaceFeatureSchema.parse(created.value);
    assert.equal(feature.workspaceId, stableId('workspace', project));
    const view = (await call({ kind: 'featureViewRead' })).value as {
      revision: number;
      featureId: string | null;
    };
    assert.equal(view.revision, 0);
    assert.equal(
      (
        await call({
          kind: 'featureViewSave',
          input: { featureId: feature.featureId, expectedRevision: 0 },
        })
      ).ok,
      true,
    );
    assert.equal(
      (await call({ kind: 'featureViewSave', input: { featureId: null, expectedRevision: 0 } })).ok,
      false,
    );
    assert.equal(
      (
        await call({
          kind: 'featureViewSave',
          input: { featureId: randomUUID(), expectedRevision: 1 },
        })
      ).ok,
      false,
    );
    assert.equal(
      ((await call({ kind: 'featureViewRead' })).value as { featureId: string }).featureId,
      feature.featureId,
    );
    for (let slot = 0; slot < ids.length; slot++) {
      const assigned = await call({
        kind: 'featureAssign',
        featureId: feature.featureId,
        slot,
        expectedRevision: feature.revision,
      });
      assert.equal(assigned.ok, true);
      feature = workspaceFeatureSchema.parse(assigned.value);
    }
    assert.deepEqual(feature.terminalIds, ids);
    const configuration = {
      version: 1,
      name: 'SYNTHETIC team',
      members: ids.map((terminalId, index) => ({
        terminalId,
        name: `SYNTHETIC ${index}`,
        handle: index === 0 ? 'backend' : `worker-${index}`,
        role: 'worker',
        allowedTargetTerminalIds: index === 0 ? ids.slice(1) : [],
      })),
    };
    const saved = await call({
      kind: 'featureTeamSave',
      featureId: feature.featureId,
      input: { expectedRevision: 0, configuration },
    });
    assert.equal(saved.ok, true);
    assert.equal(terminalTeamStateSchema.parse(saved.value).revision, 1);
    assert.equal(
      (
        await call({
          kind: 'featureTeamSave',
          featureId: feature.featureId,
          input: { expectedRevision: 0, configuration },
        })
      ).ok,
      false,
    );
    const record = terminalLayoutRecordSchema.parse({
      version: 1,
      order: [...ids].reverse(),
      shown: ids,
      active: ids[0],
      maximized: null,
      axis: 'columns',
      columns: 3,
      percent: 50,
      names: [],
    });
    assert.equal(
      (await call({ kind: 'featureLayoutSave', featureId: feature.featureId, record })).ok,
      true,
    );
    assert.deepEqual(
      (await call({ kind: 'featureLayoutRead', featureId: feature.featureId })).value,
      record,
    );
    assert.equal((await call({ kind: 'featureRead', featureId: randomUUID() })).ok, false);
    const metadata = new DatabaseSync(join(admission, 'terminal-layouts/preferences.sqlite'), {
      readOnly: true,
    });
    try {
      assert.equal(
        metadata.prepare('SELECT COUNT(*) AS n FROM feature_terminal_assignments').get()?.n,
        6,
      );
    } finally {
      metadata.close();
    }
    for (let slot = 0; slot < ids.length; slot++) {
      const journal = new DatabaseSync(join(root, `state-${slot}`, 'terminal.sqlite'), {
        readOnly: true,
      });
      try {
        assert.equal(journal.prepare('SELECT COUNT(*) AS n FROM terminal_attempts').get()?.n, 0);
      } finally {
        journal.close();
      }
    }
    assert.throws(() => readFileSync(join(admission, 'active-pair.json')), /ENOENT/);
    child.disconnect();
    const [code, signal] = await exit;
    assert.equal(code, 0);
    assert.equal(signal, null);
  } finally {
    clearTimeout(deadline);
    if (child.connected) child.disconnect();
    await exit;
    rmSync(root, { recursive: true, force: true });
  }
});
