import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { studioRequestSchema } from '@orqst/protocol';
import { terminalExecutableSha256 } from '../packages/core/src/terminal/codex-profile.js';
import { discoverTerminalNode } from '../apps/desktop/src/terminal-discovery.js';

// Only a disposable bundle accepts the host Node as a synthetic CLI. It is never launched.
const bundle = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-studio-')));
after(() => rmSync(bundle, { recursive: true, force: true }));
const node = realpathSync(process.execPath);
const hash = terminalExecutableSha256(node);
await build({
  entryPoints: ['apps/desktop/src/terminal-creation.ts'],
  outfile: join(bundle, 'creation.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  logLevel: 'silent',
});
const { prepareTerminalCreation } = (await import(
  pathToFileURL(join(bundle, 'creation.mjs')).href
)) as typeof import('../apps/desktop/src/terminal-creation.js');
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-mixed-')));
  const project = join(root, 'project');
  const home = join(root, 'home');
  const parent = join(root, 'profile');
  for (const path of [project, home, parent, join(home, '.codex')])
    mkdirSync(path, { mode: 0o700 });
  const codex = join(root, 'synthetic-codex');
  const opencode = join(root, 'synthetic-opencode');
  writeFileSync(codex, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4]), { mode: 0o700 });
  writeFileSync(opencode, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 5, 6, 7, 8]), { mode: 0o700 });
  return {
    root,
    project,
    home,
    parent,
    node,
    executable: codex,
    provider: 'codex' as const,
    companion: { provider: 'opencode' as const, executable: opencode },
    environment: {},
    cliEvidence: [
      {
        executable: codex,
        version: '0.162.1',
        sha256: terminalExecutableSha256(codex),
        binding: {
          version: 2 as const,
          provider: 'codex' as const,
          mode: 'tui' as const,
          teamId: '2DC432GLL2',
          identifier: 'codex',
          contractRevision: 'codex-tui-0.162.1',
          authorizationEpoch: '1c24dd25-839b-401b-9726-cee7fa38f356',
          policyRevision: 1,
        },
      },
      {
        executable: opencode,
        version: '2.2.5',
        sha256: terminalExecutableSha256(opencode),
        binding: {
          version: 2 as const,
          provider: 'opencode' as const,
          mode: 'tui' as const,
          teamId: '5NZ4Q7NXJ4',
          identifier: 'opencode',
          contractRevision: 'opencode-tui-2.2.5',
          authorizationEpoch: '1c24dd25-839b-401b-9726-cee7fa38f356',
          policyRevision: 1,
        },
      },
    ],
    mcp: false,
  };
}

test('mixed provisioning reviews both identities and keeps OpenCode consent provider-specific', () => {
  for (const authorized of [false, true]) {
    const f = fixture();
    try {
      const plan = prepareTerminalCreation({ ...f, openCodeStartupAuthorized: authorized });
      assert.deepEqual(readdirSync(f.parent), []);
      const reviewed = plan.pages.flatMap((page) => JSON.parse(page).terminals);
      assert.deepEqual(
        reviewed.map((entry) => entry.version),
        [1, 3],
      );
      assert.equal(reviewed[0].interactive.nativeStartupAuthorized, undefined);
      assert.equal(reviewed[1].interactive.nativeStartupAuthorized, authorized);
      assert.notEqual(reviewed[0].identity.terminalId, reviewed[1].identity.terminalId);
      assert.ok(plan.pages.every((page) => page.length <= 4096));
      const files = plan.provision(() => true);
      const saved = files.map((file) => JSON.parse(readFileSync(file, 'utf8')));
      assert.deepEqual(
        saved.map((entry) => Object.keys(entry.executable)),
        [['path'], ['path']],
      );
      assert.deepEqual(
        saved.map((entry) => entry.cliAuthorization.provider),
        ['codex', 'opencode'],
      );
      assert.deepEqual(readdirSync(f.project), []);
      assert.deepEqual(readdirSync(f.home), ['.codex']);
      assert.equal(
        saved.some((entry) => readdirSync(entry.state).includes('terminal.sqlite')),
        false,
      );
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});

test('mixed creation rejects other combinations, wrong count and changed companion binary before writes', () => {
  const f = fixture();
  try {
    assert.throws(() => prepareTerminalCreation({ ...f, count: 3, limit: 8 }), /Only the reviewed/);
    assert.throws(
      () => prepareTerminalCreation({ ...f, companion: { ...f.companion, provider: 'claude' } }),
      /Only the reviewed/,
    );
    const companion = join(f.root, 'synthetic-native-copy');
    writeFileSync(companion, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 5, 6, 7, 8]), { mode: 0o700 });
    const plan = prepareTerminalCreation({
      ...f,
      companion: { provider: 'opencode', executable: companion },
      cliEvidence: f.cliEvidence.map((item) =>
        item.binding.provider === 'opencode'
          ? { ...item, executable: companion, sha256: terminalExecutableSha256(companion) }
          : item,
      ),
    });
    writeFileSync(companion, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4]));
    assert.throws(() => plan.provision(() => true), /executable changed/);
    assert.deepEqual(readdirSync(f.parent), []);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('installed Node receipt must match native bytes and Node 24 before it can be suggested', () => {
  const f = fixture();
  try {
    const runtime = join(f.home, '.local/share/orqst/toolchain');
    mkdirSync(join(runtime, 'bin'), { recursive: true, mode: 0o700 });
    const binary = join(runtime, 'bin/node');
    copyFileSync(node, binary);
    chmodSync(binary, 0o700);
    const receipt = join(runtime, 'runtime.json');
    writeFileSync(receipt, JSON.stringify({ nodeVersion: 'v24.0.0', nodeSha256: hash }), {
      mode: 0o600,
    });
    assert.deepEqual(discoverTerminalNode('', f.home), [binary]);
    writeFileSync(receipt, JSON.stringify({ nodeVersion: 'v20.0.0', nodeSha256: hash }));
    assert.equal(discoverTerminalNode('', f.home).includes(binary), false);
    writeFileSync(receipt, JSON.stringify({ nodeVersion: 'v24.0.0', nodeSha256: '0'.repeat(64) }));
    assert.equal(discoverTerminalNode('', f.home).includes(binary), false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('Studio rejects arbitrary paths, execution operations, consent and unknown actions', () => {
  for (const request of [
    { action: 'start' },
    { action: 'createMixed', path: '/SYNTHETIC' },
    { action: 'createMixed', openCodeStartupAuthorized: true },
    { action: 'snapshot', grant: 'SYNTHETIC' },
    { action: 'open', slot: 7 },
  ])
    assert.equal(studioRequestSchema.safeParse(request).success, false);
  for (const action of ['snapshot', 'createMixed', 'create', 'select', 'resumeReview', 'open'])
    assert.equal(studioRequestSchema.safeParse({ action }).success, true);
});
