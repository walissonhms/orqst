// Synthetic filesystem admission only. No provider, credentials or external sessions.
import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';
import {
  assertSeparateTerminalState,
  managedCodexEnvironment,
  managedCodexProfiles,
  managedCodexSettings,
  readManagedCodexConfig,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';
import { terminalRPCSchema, terminalRPCOutputSchema } from '../packages/core/src/terminal/rpc.js';
import { managedTerminalBackend } from '../packages/core/src/terminal/pty-backend.js';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-managed-profile-')));
  chmodSync(root, 0o700);
  const project = join(root, 'synthetic-project');
  const state = join(root, 'managed');
  mkdirSync(project, { mode: 0o700 });
  mkdirSync(state, { mode: 0o700 });
  for (const name of ['home', 'codex', 'tmp']) mkdirSync(join(state, name), { mode: 0o700 });
  const executable = join(root, 'synthetic-native-binary');
  copyFileSync(process.execPath, executable);
  chmodSync(executable, 0o700);
  const digest = terminalDigest(readFileSync(executable));
  const config: ManagedCodexConfig = {
    version: 1,
    trust: 'native-same-user',
    executable: { path: executable, sha256: digest },
    executableVersion: 'synthetic-not-codex',
    node: { path: executable, sha256: digest },
    project,
    state,
  };
  const settings = join(state, 'codex/config.toml');
  writeFileSync(settings, managedCodexSettings(config), { mode: 0o600 });
  const file = join(state, 'terminal.json');
  writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  return { root, project, state, executable, config, file, settings };
}

test('managed Codex admission pins profiles and rejects executable, config, permissions and path drift', () => {
  const f = fixture();
  try {
    assert.deepEqual(readManagedCodexConfig(f.file), f.config);
    const profiles = managedCodexProfiles(f.config);
    const backend = managedTerminalBackend(f.file, '/synthetic/never-started.cjs');
    assert.equal(backend.validate(profiles[0]!), true);
    assert.throws(() => backend.validate(profiles[1]!)); // No managed authentication file.
    const auth = join(f.state, 'codex/auth.json');
    writeFileSync(auth, '{"synthetic":true}', { mode: 0o600 });
    assert.equal(backend.validate(profiles[1]!), true);
    assert.equal(backend.validate({ ...profiles[1]!, argv: ['--yolo'] }), false);
    chmodSync(auth, 0o644);
    assert.equal(backend.validate(profiles[1]!), false);
    chmodSync(auth, 0o600);
    rmSync(auth);
    symlinkSync(f.file, auth);
    assert.equal(backend.validate(profiles[1]!), false);
    writeFileSync(f.settings, 'sandbox_mode = "danger-full-access"');
    assert.throws(() => readManagedCodexConfig(f.file), /settings changed/);
    writeFileSync(f.settings, managedCodexSettings(f.config));
    chmodSync(f.project, 0o777);
    assert.throws(() => readManagedCodexConfig(f.file), /directory/);
    chmodSync(f.project, 0o700);
    const alias = join(f.root, 'alias');
    symlinkSync(f.project, alias);
    writeFileSync(f.file, JSON.stringify({ ...f.config, project: alias }));
    assert.throws(() => readManagedCodexConfig(f.file), /Noncanonical/);
    writeFileSync(f.file, JSON.stringify(f.config));
    writeFileSync(f.executable, 'SYNTHETIC REPLACEMENT');
    assert.throws(() => readManagedCodexConfig(f.file), /executable changed|native Mach-O/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('managed environment excludes inherited authentication, loaders, session roots and user config', () => {
  const f = fixture();
  try {
    const environment = managedCodexEnvironment(f.config);
    assert.equal(environment.HOME, join(f.state, 'home'));
    assert.equal(environment.CODEX_HOME, join(f.state, 'codex'));
    assert.equal(environment.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
    for (const name of [
      'OPENAI_API_KEY',
      'CODEX_API_KEY',
      'NODE_OPTIONS',
      'SSH_AUTH_SOCK',
      'DYLD_INSERT_LIBRARIES',
    ])
      assert.equal(environment[name], undefined);
    assert.throws(() => assertSeparateTerminalState(f.project, f.project));
    assert.throws(() => assertSeparateTerminalState(f.project, join(f.project, '..nested')));
    assertSeparateTerminalState(f.project, f.state);
    chmodSync(f.file, 0o644);
    assert.throws(() => readManagedCodexConfig(f.file), /not private/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('private Terminal RPC denies arbitrary execution, argument expansion and unbounded output', () => {
  const id = '78fe5c16-7455-4e31-a2c4-7caec882a2d0';
  assert.equal(
    terminalRPCSchema.safeParse({
      id,
      operation: 'prepare',
      args: ['desktop-managed', 'codex-terminal-v1'],
    }).success,
    true,
  );
  for (const request of [
    { id, operation: 'execute', args: ['/bin/sh'] },
    { id, operation: 'prepare', args: ['observer-cookie', 'codex-terminal-v1'] },
    { id, operation: 'prepare', args: ['desktop-managed', 'codex-terminal-v1'], cwd: '/external' },
    { id, operation: 'write', args: [id, id, id, 0, 'x'.repeat(4097)] },
    { id, operation: 'resize', args: [id, id, 301, 24] },
    { id, operation: 'read', args: [id, id, -1] },
  ])
    assert.equal(terminalRPCSchema.safeParse(request).success, false);
  assert.equal(
    terminalRPCOutputSchema.safeParse({ bytes: [27, 91, 72], nextCursor: 3, gap: false }).success,
    true,
  );
  assert.equal(
    terminalRPCOutputSchema.safeParse({
      bytes: Array(65537).fill(0),
      nextCursor: 65537,
      gap: false,
    }).success,
    false,
  );
});
