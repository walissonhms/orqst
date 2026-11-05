// Deliberate Node Core + native PTY fixture. No Electron focus claim or real provider execution.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';
import { buildSharedTestHosts } from './helpers/shared-test-resources.js';
import { connectManagedTerminalCore } from '../apps/desktop/src/managed-terminal-core.js';
import {
  TerminalAuthority,
  terminalChallengeBytes,
  type TerminalChallenge,
} from '../packages/core/src/terminal/authority.js';
import { TerminalNativeBroker } from '../packages/core/src/terminal/native-broker.js';
import { readLifecycleReceipt } from '../packages/core/src/managed-codex/lifecycle-receipt.js';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-pty']);
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
process.umask(0o077);
const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-reuse-')));
const run = promisify(execFile);
let core: Awaited<ReturnType<typeof connectManagedTerminalCore>> | undefined;
try {
  const resources = join(root, 'resources');
  await buildSharedTestHosts(resources, 'terminal');
  const fake = join(root, 'SYNTHETIC-NOT-CODEX');
  const home = join(root, 'synthetic-native-home');
  const project = join(root, 'synthetic-project');
  await mkdir(home);
  await mkdir(project);
  await run('/usr/bin/cc', [resolve('tests/helpers/managed-terminal-fixture.c'), '-o', fake]);
  await chmod(fake, 0o700);
  const sentinel = 'SYNTHETIC-NATIVE-STATE-MUST-STAY-UNCHANGED';
  for (const name of ['auth.json', 'config.toml', 'existing-session.jsonl'])
    await writeFile(join(home, name), sentinel, { mode: 0o000 });
  const files: string[] = [];
  for (const slot of ['a', 'b']) {
    const state = join(root, slot);
    await run(process.execPath, [
      '--import',
      'tsx',
      resolve('scripts/setup-managed-terminal.ts'),
      '--authentication',
      'reuse-existing',
      '--acknowledge-shared-native-config',
      '--interactive',
      '--acknowledge-shared-native-sessions',
      '--user-home',
      home,
      '--codex-home',
      home,
      '--executable',
      fake,
      '--executable-version',
      'SYNTHETIC-NOT-CODEX',
      '--project',
      project,
      '--state',
      state,
    ]);
    files.push(join(state, 'terminal.json'));
  }
  const keys = generateKeyPairSync('ed25519');
  core = await connectManagedTerminalCore(
    files,
    join(resources, 'managed-terminal-core.cjs'),
    keys.publicKey,
    join(root, 'admission'),
  );
  const ids: string[] = [];
  const active: Array<{
    broker: TerminalNativeBroker<object>;
    document: object;
    instanceId: string;
  }> = [];
  for (const supervisor of core.supervisors) {
    await assert.rejects(async () => supervisor.prepare('desktop-managed', 'codex-login-v1'));
    const document = {};
    const authority = new TerminalAuthority(new Map([['desktop-managed', keys.publicKey]]));
    const broker = new TerminalNativeBroker(
      authority,
      supervisor,
      'desktop-managed',
      keys.privateKey,
      document,
      {
        current: () => true, // Synthetic signer only. This is not native-focus or human consent evidence.
        confirm: async (_document, details) => {
          assert.ok(
            JSON.stringify(details, null, 2).length <= 4096,
            'Native review must fit its unchanged budget',
          );
          return true;
        },
      },
    );
    const start = await broker.dispatch(document, {
      version: 1,
      action: 'start',
      profileId: 'codex-terminal-v1',
    });
    assert.equal(start.status, 'ok');
    if (start.status !== 'ok') throw new Error('Synthetic start denied');
    const instanceId = start.instanceId;
    ids.push(instanceId);
    await expect.poll(async () => (await supervisor.snapshot(instanceId)).state).toBe('running');
    for (const action of ['attach', 'input'])
      assert.equal(
        (await broker.dispatch(document, { version: 1, action, instanceId })).status,
        'ok',
      );
    assert.equal(
      (
        await broker.dispatch(document, {
          version: 1,
          action: 'write',
          instanceId,
          sequence: 0,
          text: 'ping\r',
        })
      ).status,
      'ok',
    );
    await expect
      .poll(async () => {
        const output = await broker.dispatch(document, {
          version: 1,
          action: 'read',
          instanceId,
          cursor: 0,
        });
        return output.status === 'ok'
          ? Buffer.from(output.output?.bytes ?? []).toString('utf8')
          : '';
      })
      .toContain('SYNTHETIC:PONG');
    active.push({ broker, document, instanceId });
  }
  for (const [slot, instanceId] of ids.entries())
    assert.equal((await core.supervisors[slot]!.snapshot(instanceId)).state, 'running');
  for (const [slot, { broker, document, instanceId }] of active.entries()) {
    assert.equal(
      (
        await broker.dispatch(document, {
          version: 1,
          action: 'stop',
          instanceId,
          signal: 'SIGTERM',
        })
      ).status,
      'ok',
    );
    await expect
      .poll(async () => (await core!.supervisors[slot]!.snapshot(instanceId)).state)
      .toBe('exited');
    broker.close();
  }
  assert.notEqual(ids[0], ids[1]);
  const retirement = (await core.prepareRetire()) as { challenge: TerminalChallenge };
  await core.retire({
    challengeId: retirement.challenge.challengeId,
    signature: sign(null, terminalChallengeBytes(retirement.challenge), keys.privateKey).toString(
      'base64url',
    ),
  });
  for (const name of ['auth.json', 'config.toml', 'existing-session.jsonl']) {
    await chmod(join(home, name), 0o600);
    assert.equal(await readFile(join(home, name), 'utf8'), sentinel);
  }
  for (const [index, slot] of ['a', 'b'].entries()) {
    const state = join(root, slot);
    assert.deepEqual(await readdir(join(state, 'codex')), ['config.toml']);
    const receipts = (await readdir(state)).filter((name) => name.startsWith('lifecycle-'));
    assert.equal(receipts.length, 1);
    const header = JSON.parse((await readFile(join(state, receipts[0]!), 'utf8')).split('\n')[0]!);
    assert.equal(header.binding.instanceId, ids[index]);
    assert.equal(readLifecycleReceipt(state, header.binding).status, 'recorded_exit');
  }
  console.log(
    JSON.stringify({
      result: 'passed',
      scope: 'two-synthetic-native-reuse-PTY-slots',
      checks: [
        'explicit-opt-in',
        'no-login-profile',
        'signed-start-input-stop-retirement',
        'two-owned-exits',
        'unreadable-native-sentinels-preserved',
        'no-copied-credentials',
      ],
      nativeRollouts:
        'NOT VALIDATED: a real TUI may write new rollouts under shared CODEX_HOME/sessions; history.persistence=none does not prevent this.',
      limits: 'No Electron focus/modal, real Codex, native login, inference or CLI MCP acceptance.',
    }),
  );
} finally {
  core?.close();
  await rm(root, { recursive: true, force: true });
}
