// Synthetic profile claims only. No provider, native login, credentials or external sessions.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';
import {
  interactiveTerminalEnvironment,
  interactiveTerminalProfiles,
  managedClaudeConfigSchema,
  reviewedClaudeTuiBinary,
  validateManagedClaudeConfig,
} from '../packages/core/src/terminal/interactive-profile.js';
import { reviewedProviderMcpBinaries } from '../packages/core/src/terminal/provider-mcp-config.js';
import { terminalRPCSchema, terminalPairReadySchema } from '../packages/core/src/terminal/rpc.js';

function fixture() {
  return managedClaudeConfigSchema.parse({
    version: 2,
    provider: 'claude',
    trust: 'native-same-user',
    executable: { path: '/synthetic/claude', sha256: reviewedProviderMcpBinaries.claude.sha256 },
    executableVersion: '2.1.178',
    node: { path: '/synthetic/node', sha256: 'b'.repeat(64) },
    project: '/synthetic/project',
    state: '/synthetic/state',
    sessionId: randomUUID(),
    authentication: {
      mode: 'reuse-existing',
      home: '/synthetic/native-home',
      claudeConfigDirectory: '/synthetic/native-config',
      sharedNativeConfiguration: true,
    },
    interactive: { sharedNativeSessions: true },
  });
}

test('reviewed Claude TUI keeps legacy manifests and rejects mismatched pins', () => {
  const legacy = fixture();
  assert.equal(interactiveTerminalProfiles(legacy)[0]!.executableVersion, '2.1.178');
  const config = managedClaudeConfigSchema.parse({
    ...legacy,
    executableVersion: reviewedClaudeTuiBinary.version,
    executable: { ...legacy.executable, sha256: reviewedClaudeTuiBinary.sha256 },
  });
  for (const model of [null, 'sonnet', 'opus', 'haiku']) {
    config.model = {
      value: model,
      source: model ? 'official-alias' : 'cli-default',
      files: [{ path: '/synthetic/nonexistent-model-settings.json', sha256: null }],
    };
    const profile = interactiveTerminalProfiles(config)[0]!;
    assert.deepEqual(profile.argv, [
      '--session-id',
      config.sessionId,
      ...(model ? ['--model', model] : []),
    ]);
    assert.equal(profile.environmentProfile, 'claude-native-identity-no-inherited-credentials-v1');
    assert.equal(profile.cliAuthorizationScope, 'claude-native-v1:native-mcp');
    assert.equal(profile.executableVersion, '2.1.318');
    assert.equal(interactiveTerminalEnvironment(config).DISABLE_AUTOUPDATER, '1');
    assert.equal(
      interactiveTerminalEnvironment(config).CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
      '1',
    );
  }
  for (const mismatched of [
    { ...config, executable: legacy.executable },
    { ...legacy, executable: config.executable },
  ])
    assert.throws(() => interactiveTerminalProfiles(mismatched), /version\/hash/);
  config.interactive = { sharedNativeSessions: true, mcp: true, strictMcpAcknowledged: true };
  for (const mismatched of [
    { ...config, executable: legacy.executable },
    { ...legacy, executable: config.executable, interactive: config.interactive },
  ])
    assert.throws(() => interactiveTerminalProfiles(mismatched), /MCP launch contract/);
  assert.equal(reviewedProviderMcpBinaries.claude.version, '2.1.178');
  assert.equal(
    reviewedProviderMcpBinaries.claude.sha256,
    '473495d0c15d6616cd0870480db5eb8aa0402fe4f8ead3277a1b521e94110309',
  );
});

test('both Claude pins compose the unchanged reviewed strict MCP launch', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-claude-mcp-')));
  try {
    const config = fixture();
    config.interactive = { sharedNativeSessions: true, mcp: true, strictMcpAcknowledged: true };
    const bytes = Buffer.from('// SYNTHETIC relay, never executed\n');
    const path = join(root, 'synthetic-relay.cjs');
    writeFileSync(path, bytes, { mode: 0o600 });
    const launch = {
      serverName: `orqst_${'a'.repeat(32)}`,
      socketPath: join(root, 'synthetic.sock'),
      capabilityFile: join(root, 'synthetic.cap'),
      relay: { path, sha256: terminalDigest(bytes) },
    };
    const profile = interactiveTerminalProfiles(config, launch)[0]!;
    assert.equal(profile.executableVersion, '2.1.178');
    assert.ok(profile.argv.includes('--strict-mcp-config'));
    assert.ok(profile.argv.includes('--mcp-config'));
    assert.equal(profile.cliAuthorizationScope, 'claude-native-v1:orqst-mcp-configured');
    assert.equal(interactiveTerminalEnvironment(config).MCP_TIMEOUT, '10000');
    const current = {
      ...config,
      executableVersion: reviewedClaudeTuiBinary.version,
      executable: { ...config.executable, sha256: reviewedClaudeTuiBinary.sha256 },
    };
    const currentProfile = interactiveTerminalProfiles(current, launch)[0]!;
    assert.equal(currentProfile.executableVersion, '2.1.318');
    assert.deepEqual(currentProfile.argv, profile.argv);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Claude profile preserves explicit native identity and rejects inherited secrets/unsupported launch inputs', () => {
  const config = fixture();
  const profile = interactiveTerminalProfiles(config)[0]!;
  assert.equal(profile.id, 'claude-terminal-v1');
  assert.deepEqual(profile.argv, ['--session-id', config.sessionId]);
  const env = interactiveTerminalEnvironment(config);
  assert.equal(env.HOME, config.authentication.home);
  assert.equal(env.CLAUDE_CONFIG_DIR, config.authentication.claudeConfigDirectory);
  assert.deepEqual(
    Object.keys(env).sort(),
    [
      'HOME',
      'CLAUDE_CONFIG_DIR',
      'TMPDIR',
      'PATH',
      'LANG',
      'LC_ALL',
      'TERM',
      'DISABLE_AUTOUPDATER',
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    ].sort(),
  );
  const defaults = fixture();
  delete defaults.authentication.claudeConfigDirectory;
  assert.equal('CLAUDE_CONFIG_DIR' in interactiveTerminalEnvironment(defaults), false);
  for (const extra of [
    { argv: ['--resume'] },
    { credentials: 'SYNTHETIC' },
    { provider: 'opencode' },
    { executableVersion: 'future' },
  ])
    assert.throws(() => managedClaudeConfigSchema.parse({ ...config, ...extra }));
  assert.throws(() =>
    managedClaudeConfigSchema.parse({
      ...config,
      authentication: { ...config.authentication, mode: 'separate-login' },
    }),
  );
  assert.throws(
    () =>
      validateManagedClaudeConfig({
        ...config,
        executable: { ...config.executable, sha256: '0'.repeat(64) },
      }),
    /exact Claude binary/,
  );
});

test('Claude strict MCP requires acknowledgment and composition; relay drift is rejected before dispatch', () => {
  const config = fixture();
  const mcp = {
    serverName: `orqst_${'a'.repeat(32)}`,
    socketPath: '/synthetic/source.sock',
    capabilityFile: '/synthetic/source.cap',
    relay: { path: '/synthetic/absent-relay', sha256: 'a'.repeat(64) },
  };
  assert.throws(() => interactiveTerminalProfiles(config, mcp), /mismatch/);
  config.interactive.mcp = true;
  assert.throws(() => interactiveTerminalProfiles(config, mcp), /mismatch/);
  config.interactive.strictMcpAcknowledged = true;
  assert.throws(() => interactiveTerminalProfiles(config), /mismatch/);
  assert.throws(() => interactiveTerminalProfiles(config, mcp));
});

test('native pair RPC admits reviewed Claude profile and identities and OpenCode identities (execution still requires authorized manifest)', () => {
  const id = randomUUID();
  assert.ok(
    terminalRPCSchema.safeParse({
      id,
      operation: 'prepare',
      args: ['desktop-managed', 'claude-terminal-v1'],
    }).success,
  );
  assert.equal(
    terminalRPCSchema.safeParse({
      id,
      operation: 'prepare',
      args: ['desktop-managed', 'opencode-terminal-v1'],
    }).success,
    true,
  );
  assert.ok(
    terminalPairReadySchema.safeParse({
      type: 'ready',
      id,
      admissionOwner: id,
      initialFiles: ['/synthetic/initial.json'],
      epoch: id,
      identities: [
        { slot: 0, terminalId: id, provider: 'codex' },
        { slot: 1, terminalId: randomUUID(), provider: 'claude' },
      ],
    }).success,
  );
});
