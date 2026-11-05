// Synthetic filesystem admission only. No provider, credentials or external sessions.
import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  closeSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';
import {
  assertSeparateTerminalState,
  managedCodexEnvironment,
  managedCodexProfiles,
  managedCodexSettings,
  readManagedCodexConfig,
  type ManagedCodexConfig,
  structuredCodexArguments,
  terminalExecutableMaximumBytes,
  terminalExecutableSha256,
} from '../packages/core/src/terminal/codex-profile.js';
import { terminalRPCSchema, terminalRPCOutputSchema } from '../packages/core/src/terminal/rpc.js';
import { managedTerminalBackend } from '../packages/core/src/terminal/pty-backend.js';
import type { TerminalMcpLaunch } from '../packages/core/src/terminal/mcp-launch.js';

test('native executable hashing streams a synthetic 320 MiB sparse file within the finite budget', (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-large-hash-')));
  const file = join(root, 'synthetic-never-executed');
  try {
    const header = Buffer.from([0xfe, 0xed, 0xfa, 0xcf, 0, 0, 0, 0]);
    writeFileSync(file, header, { mode: 0o700 });
    const length = 320 * 1024 * 1024;
    const fd = openSync(file, 'r+');
    try {
      ftruncateSync(fd, length);
    } finally {
      closeSync(fd);
    }
    const expected = createHash('sha256').update(header);
    const zeros = Buffer.alloc(64 * 1024);
    for (let remaining = length - header.length; remaining > 0; remaining -= zeros.length)
      expected.update(zeros.subarray(0, Math.min(remaining, zeros.length)));
    const allocate = Buffer.alloc;
    const allocations: number[] = [];
    const allocation = t.mock.method(Buffer, 'alloc', (size: number) => {
      allocations.push(size);
      assert.ok(size <= 64 * 1024, 'Executable hashing must use bounded streaming buffers');
      return allocate(size);
    });
    try {
      assert.equal(terminalExecutableSha256(file), expected.digest('hex'));
      assert.deepEqual(allocations, [64 * 1024]);
    } finally {
      allocation.mock.restore();
    }
    chmodSync(file, 0o777);
    assert.throws(() => terminalExecutableSha256(file), /Untrusted terminal file/);
    chmodSync(file, 0o600);
    assert.throws(() => terminalExecutableSha256(file), /not executable/);
    chmodSync(file, 0o700);
    const alias = join(root, 'synthetic-symlink');
    symlinkSync(file, alias);
    assert.throws(() => terminalExecutableSha256(alias), /Noncanonical/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native executable hashing refuses a synthetic sparse file above 512 MiB before reading', () => {
  assert.equal(terminalExecutableMaximumBytes, 512 * 1024 * 1024);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-oversize-hash-')));
  const file = join(root, 'synthetic-never-executed');
  try {
    writeFileSync(file, Buffer.from([0xfe, 0xed, 0xfa, 0xcf]), { mode: 0o700 });
    const fd = openSync(file, 'r+');
    try {
      ftruncateSync(fd, terminalExecutableMaximumBytes + 1);
    } finally {
      closeSync(fd);
    }
    assert.throws(() => terminalExecutableSha256(file), /Untrusted terminal file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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

test('opt-in MCP profiles pin the local relay and reviewed version without writing native config or changing login', () => {
  const f = fixture();
  try {
    const nativeHome = join(f.root, 'synthetic-native-home');
    mkdirSync(nativeHome, { mode: 0o700 });
    const nativeConfig = join(nativeHome, 'config.toml');
    writeFileSync(nativeConfig, '# SYNTHETIC native config must remain untouched\n', {
      mode: 0o600,
    });
    f.config.executableVersion = '0.162.1'; // Synthetic binary, reviewed configuration label only.
    f.config.authentication = {
      mode: 'reuse-existing',
      home: nativeHome,
      codexHome: nativeHome,
      sharedNativeConfiguration: true,
    };
    f.config.interactive = { sharedNativeSessions: true, mcp: true };
    const relayPath = join(f.root, 'synthetic-relay.cjs');
    writeFileSync(relayPath, '// SYNTHETIC never executed\n', { mode: 0o600 });
    const launch: TerminalMcpLaunch = {
      serverName: `orqst_${'a'.repeat(32)}`,
      socketPath: join(f.root, 'source.sock'),
      capabilityFile: join(f.root, 'source.cap'),
      relay: { path: relayPath, sha256: terminalDigest(readFileSync(relayPath)) },
    };
    writeFileSync(f.file, JSON.stringify(f.config));
    assert.throws(() => managedCodexProfiles(f.config), /composition required/);
    const profile = managedCodexProfiles(f.config, launch)[0]!;
    assert.match(profile.argv.join(' '), /mcp_servers\.orqst_a{32}=\{command=/);
    assert.match(profile.argv.join(' '), /tool_timeout_sec=125/);
    assert.match(profile.permissions, /Inherited MCPs remain enabled/);
    assert.equal(managedCodexEnvironment(f.config).HOME, nativeHome);
    assert.equal(managedCodexEnvironment(f.config).CODEX_HOME, nativeHome);
    const backend = managedTerminalBackend(f.file, '/synthetic/never-executed', launch);
    assert.equal(backend.validate(profile), true);
    assert.equal(backend.validate({ ...profile, argv: [...profile.argv, '--unreviewed'] }), false);
    assert.equal(
      readFileSync(nativeConfig, 'utf8'),
      '# SYNTHETIC native config must remain untouched\n',
    );
    assert.throws(
      () => managedCodexProfiles({ ...f.config, executableVersion: 'future' }, launch),
      /Unreviewed/,
    );
    assert.throws(
      () =>
        managedCodexProfiles({ ...f.config, interactive: { sharedNativeSessions: true } }, launch),
      /not opted/,
    );
    writeFileSync(relayPath, '// SYNTHETIC changed\n');
    assert.throws(() => backend.validate(profile), /relay changed/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

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

test('structured native reuse keeps the CLI credential identity and segregates owned state without a PTY escape', () => {
  const f = fixture();
  try {
    const nativeHome = join(f.root, 'synthetic-native-home');
    mkdirSync(nativeHome, { mode: 0o700 });
    // A credential file is deliberately unreadable: admission inspects directories only.
    writeFileSync(join(nativeHome, 'auth.json'), 'SYNTHETIC-SECRET', { mode: 0o000 });
    const config: ManagedCodexConfig = {
      ...f.config,
      authentication: {
        mode: 'reuse-existing',
        home: f.root,
        codexHome: nativeHome,
        sharedNativeConfiguration: true,
      },
    };
    writeFileSync(f.file, JSON.stringify(config));
    assert.deepEqual(readManagedCodexConfig(f.file), config);
    const environment = managedCodexEnvironment(config);
    assert.equal(environment.HOME, f.root);
    assert.equal(environment.CODEX_HOME, nativeHome);
    assert.equal(environment.CODEX_SQLITE_HOME, join(config.state, 'codex'));
    assert.equal(environment.TMPDIR, join(config.state, 'tmp'));
    assert.equal(environment.OPENAI_API_KEY, undefined);
    assert.equal(environment.NODE_OPTIONS, undefined);
    const argv = structuredCodexArguments(config);
    assert.ok(!argv.some((value) => value.includes('cli_auth_credentials_store')));
    assert.ok(!argv.includes('mcp_servers={}')); // Does not disable inherited servers.
    assert.ok(argv.includes('features.hooks=false'));
    assert.ok(argv.includes('features.remote_plugin=false'));
    assert.ok(!argv.includes('features.plugins=false'));
    assert.ok(argv.includes('history.persistence="none"'));
    assert.ok(argv.includes('otel.metrics_exporter="none"'));
    assert.throws(() => managedCodexProfiles(config), /structured runtime/);
    assert.throws(() => managedTerminalBackend(f.file, '/never-started.cjs'), /structured runtime/);
    writeFileSync(
      f.file,
      JSON.stringify({
        ...config,
        authentication: { ...config.authentication, codexHome: f.state },
      }),
    );
    assert.throws(() => readManagedCodexConfig(f.file), /inside managed state/);
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

test('interactive native reuse needs a separate opt-in, exposes no login profile and never probes credentials', () => {
  const f = fixture();
  try {
    const nativeHome = join(f.root, 'synthetic-native-home');
    mkdirSync(nativeHome, { mode: 0o700 });
    const secret = join(nativeHome, 'auth.json');
    writeFileSync(secret, 'SYNTHETIC-UNREADABLE-CREDENTIAL', { mode: 0o000 });
    const config: ManagedCodexConfig = {
      ...f.config,
      authentication: {
        mode: 'reuse-existing',
        home: f.root,
        codexHome: nativeHome,
        sharedNativeConfiguration: true,
      },
      interactive: { sharedNativeSessions: true },
    };
    writeFileSync(f.file, JSON.stringify(config));
    const profiles = managedCodexProfiles(readManagedCodexConfig(f.file));
    assert.equal(profiles.length, 1);
    const profile = profiles[0]!;
    assert.equal(profile.id, 'codex-terminal-v1');
    assert.ok(profile.argv.includes('--no-daemon'));
    assert.ok(profile.argv.includes('read-only'));
    assert.ok(profile.argv.includes('on-request'));
    assert.ok(profile.argv.includes('history.persistence="none"'));
    assert.ok(
      !profile.argv.some((value) => /cli_auth_credentials_store|resume|ephemeral/.test(value)),
    );
    assert.match(profile.permissions, /session root are SHARED/);
    assert.equal(managedTerminalBackend(f.file, '/never-started.cjs').validate(profile), true);
    chmodSync(secret, 0o600);
    assert.equal(readFileSync(secret, 'utf8'), 'SYNTHETIC-UNREADABLE-CREDENTIAL');
    assert.throws(() => readFileSync(join(f.state, 'codex/auth.json')), /ENOENT/);
    writeFileSync(f.file, JSON.stringify({ ...f.config, interactive: config.interactive }));
    assert.throws(() => readManagedCodexConfig(f.file), /requires existing authentication/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
