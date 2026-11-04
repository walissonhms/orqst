// Explicit native-process integration with fixed synthetic executables; never a real provider.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium, expect, type Browser } from '@playwright/test';
import { managedAgentsRequestSchema, type ManagedAgentsReply } from '@orqst/protocol';
import { managedAgentsDocument } from '../apps/desktop/src/managed-agents-document.js';
import en from '../apps/dashboard/src/locales/en-US.json';
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
let browser: Browser | undefined;
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
  assert.throws(
    () => agents.prepareTask('SYNTHETIC', '@terminal-b SYNTHETIC worker task'),
    /permission/,
  );
  // Real document/client and native hosts; this test signer substitutes for native dialogs only.
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.exposeFunction(
    'syntheticManagedRequest',
    async (raw: unknown): Promise<ManagedAgentsReply> => {
      const request = managedAgentsRequestSchema.parse(raw);
      if (request.action === 'routing') {
        const prepared = agents.prepareRouting(request.slot, request.update);
        agents.applyRouting(prepared.changeId, proof(prepared.challenge));
      } else if (request.action === 'delegate') {
        const prepared = agents.prepareTask(request.text, request.task, request.sourceSlot);
        assert.ok(JSON.stringify(prepared.plan, null, 2).length <= 4096, 'native review bound');
        agents.runTask(
          prepared.plan.taskId,
          prepared.plan.correlationId,
          proof(prepared.challenge),
        );
      } else assert.equal(request.action, 'snapshot');
      return { status: 'ok', snapshot: agents.snapshot() };
    },
  );
  await page.setContent(
    managedAgentsDocument(
      'en-US',
      (key) =>
        en.managedAgents[key.slice('managedAgents.'.length) as keyof typeof en.managedAgents],
    )
      .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
      .replace(/<link[^>]*>/g, ''),
  );
  await page.evaluate(`window.orqstManagedAgentsClient = {
    request: (raw) => window.syntheticManagedRequest(raw)
  }`);
  await page.addScriptTag({ path: resolve('apps/desktop/dist/managed-agents-client.js') });
  await expect(page.locator('#delegate')).toBeDisabled();
  await expect(page.locator('#name-0')).toHaveValue('A');
  await page.locator('#name-0').fill('Synthetic coordinator');
  await page.locator('#role-0').selectOption('orchestrator');
  await page.locator('#route-0').check();
  await page.locator('#routing-0').click();
  await expect.poll(() => agents.snapshot().slots[0]?.pane?.routing?.role).toBe('orchestrator');
  await expect(page.locator('#delegate')).toBeEnabled();
  await page.locator('#task').fill('SYNTHETIC preserved prefix @');
  await page.locator('#mention-options button').click();
  await expect(page.locator('#task')).toHaveValue('SYNTHETIC preserved prefix @terminal-b ');
  await page.locator('#instructions').fill('SYNTHETIC root instruction');
  await page.locator('#task').fill('@terminal-b SYNTHETIC worker task');
  await page.locator('#delegate').click();
  await expect.poll(() => agents.snapshot().root?.state).toBe('completed');
  await expect(page.locator('#output-0')).toHaveText('SYNTHETIC root received worker result');
  await expect(page.locator('#output-1')).toHaveText('SYNTHETIC worker result');
  assert.deepEqual(errors, []);
  await browser.close();
  browser = undefined;
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
        'deny-by-default-mention-routing',
        'signed-identity-and-directed-permission',
        'signed-mentioned-A-to-B-to-A',
        'chromium-permission-edit-autocomplete-and-correlated-output',
        'correlated-results',
        'stop-confirmed-native-exits',
        'signed-retirement',
      ],
      limits:
        'No Electron active interaction, native modal/focus acceptance, real provider, credentials, external sessions, crash recovery or descendant containment validated.',
    }),
  );
} finally {
  await browser?.close();
  service?.close();
  // The fixed fixture has a 90-second independent watchdog; shutdown never adopts/signals PIDs.
  await rm(root, { recursive: true, force: true });
}
