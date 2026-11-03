// Synthetic profile claims only. No provider, native login, credentials or external sessions.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  interactiveTerminalEnvironment,
  interactiveTerminalProfiles,
  managedClaudeConfigSchema,
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

test('native pair RPC admits reviewed Claude profile and identities without enabling OpenCode launch', () => {
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
    false,
  );
  assert.ok(
    terminalPairReadySchema.safeParse({
      type: 'ready',
      epoch: id,
      identities: [
        { slot: 0, terminalId: id, provider: 'codex' },
        { slot: 1, terminalId: randomUUID(), provider: 'claude' },
      ],
    }).success,
  );
});
