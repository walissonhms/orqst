// Explicit native-process integration with fixed synthetic executables; never a real provider.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';
import { DesktopManagedAgents } from '../packages/core/src/managed-codex/desktop.js';
import { desktopAgentsAdmission } from '../packages/core/src/managed-codex/desktop-admission.js';
import { nativeCodexBackend } from '../packages/core/src/managed-codex/runtime.js';
import {
  terminalChallengeBytes,
  type TerminalChallenge,
} from '../packages/core/src/terminal/authority.js';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-agents']);
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
process.umask(0o077);
const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-agents-acceptance-')));
const run = promisify(execFile);
let service: DesktopManagedAgents | undefined;
try {
  const fake = join(root, 'SYNTHETIC-not-codex');
  const project = join(root, 'synthetic-project');
  const home = join(root, 'synthetic-home');
  await mkdir(project);
  await mkdir(home);
  await run('/usr/bin/cc', [resolve('tests/helpers/managed-agents-fixture.c'), '-o', fake]);
  await chmod(fake, 0o700);
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
  const proof = (challenge: TerminalChallenge) => ({
    challengeId: challenge.challengeId,
    signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString('base64url'),
  });
  const directory = join(root, 'admission');
  const agents = (service = new DesktopManagedAgents(
    [files[0]!, files[1]!],
    keys.publicKey,
    nativeCodexBackend(resolve('apps/desktop/dist/codex-structured-host.cjs')),
    desktopAgentsAdmission(directory, files),
  ));
  for (const slot of [0, 1]) {
    const preparation = agents.prepareStart(slot, 'SYNTHETIC-model');
    await agents.launch(slot, proof(preparation.challenge));
    assert.equal(agents.snapshot().slots[slot]?.pane?.state, 'ready');
  }
  const ready = agents.snapshot();
  assert.notEqual(ready.slots[0]?.instanceId, ready.slots[1]?.instanceId);
  assert.notEqual(ready.slots[0]?.nativeThreadId, ready.slots[1]?.nativeThreadId);
  const task = agents.prepareTask('SYNTHETIC root instruction', 'SYNTHETIC worker task');
  agents.runTask(task.plan.taskId, task.plan.correlationId, proof(task.challenge));
  await expect.poll(() => agents.snapshot().root?.state).toBe('completed');
  const result = agents.snapshot();
  assert.equal(result.root?.resultText, 'SYNTHETIC root received worker result');
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0]?.resultText, 'SYNTHETIC worker result');
  assert.equal(result.messages[0]?.correlationId, result.root?.correlationId);
  assert.equal(agents.snapshot().canRetire, false);
  for (const slot of [0, 1]) {
    agents.stop(slot, proof(agents.prepareStop(slot)));
    await expect.poll(() => agents.snapshot().slots[slot]?.state).toBe('exited');
  }
  assert.equal(agents.snapshot().canRetire, true);
  const retirement = agents.prepareRetire();
  agents.retire(proof(retirement.challenge));
  assert.equal(agents.snapshot().admission, 'retired');
  await assert.rejects(access(join(directory, 'active-pair.json')));
  console.log(
    JSON.stringify({
      result: 'passed',
      scope: 'desktop-composition-real-native-hosts-synthetic-structured-executables',
      checks: [
        'two-owned-processes-and-threads',
        'signed-A-to-B-to-A',
        'correlated-results',
        'stop-confirmed-native-exits',
        'signed-retirement',
      ],
      limits:
        'No Electron active interaction, native modal/focus acceptance, real provider, credentials, external sessions, crash recovery or descendant containment validated.',
    }),
  );
} finally {
  service?.close();
  // The fixed fixture has a 90-second independent watchdog; shutdown never adopts/signals PIDs.
  await rm(root, { recursive: true, force: true });
}
