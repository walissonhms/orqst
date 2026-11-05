import { terminalDigest } from '../packages/core/src/terminal/authority.js';
// Synthetic configuration inputs only. No provider executable, login or native state is accessed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  claudeInteractiveMcpConfiguration,
  opencodeInteractiveMcpConfiguration,
  reviewedProviderMcpBinaries,
} from '../packages/core/src/terminal/provider-mcp-config.js';
import {
  interactiveCliAdapter,
  interactiveCliStatus,
} from '../packages/core/src/terminal/interactive-adapters.js';
import { claudeDescriptor } from '../packages/adapters/claude/src/index.js';
import { opencodeDescriptor } from '../packages/adapters/opencode/src/index.js';

function fixture(provider: 'claude' | 'opencode') {
  const reviewed = reviewedProviderMcpBinaries[provider];
  return {
    executableVersion: reviewed.version,
    executableSha256: terminalDigest('synthetic CLI bytes'), // Synthetic claim, never execution authority.
    nodePath: '/synthetic/private/node',
    mcp: {
      serverName: `orqst_${'a'.repeat(32)}`,
      socketPath: '/synthetic/private/source.sock',
      capabilityFile: '/synthetic/private/source.cap',
      relay: { path: '/synthetic/private/relay.cjs', sha256: 'b'.repeat(64) },
    },
  };
}

test('Claude 2.1.178 configuration uses evidenced strict inline MCP/session flags without overriding native identity selectors', () => {
  const sessionId = randomUUID();
  const plan = claudeInteractiveMcpConfiguration({ ...fixture('claude'), sessionId });
  assert.deepEqual(plan.argv.slice(0, 2), ['--strict-mcp-config', '--mcp-config']);
  assert.deepEqual(plan.argv.slice(-2), ['--session-id', sessionId]);
  const config = JSON.parse(plan.argv[2]!);
  assert.equal(config.mcpServers[fixture('claude').mcp.serverName].type, 'stdio');
  assert.equal(
    config.mcpServers[fixture('claude').mcp.serverName].command,
    '/synthetic/private/node',
  );
  assert.deepEqual(config.mcpServers[fixture('claude').mcp.serverName].args, [
    '/synthetic/private/relay.cjs',
  ]);
  assert.deepEqual(Object.keys(config.mcpServers[fixture('claude').mcp.serverName].env).sort(), [
    'ORQST_CAP_FILE',
    'ORQST_SOCKET_PATH',
  ]);
  assert.deepEqual(plan.environmentOverrides, { MCP_TIMEOUT: '10000', MCP_TOOL_TIMEOUT: '125000' });
  assert.ok(plan.blockers.includes('strict_project_mcp_approval_can_still_block_2_1_178'));
  assert.equal(plan.execution, 'blocked');
  assert.equal(plan.providerAcceptance, 'not_run');
  assert.throws(() => claudeInteractiveMcpConfiguration(fixture('claude')));
});

test('OpenCode 2.2.5 configuration uses a merged runtime environment document, no fictitious CLI flags or Codex roots', () => {
  const plan = opencodeInteractiveMcpConfiguration(fixture('opencode'));
  assert.deepEqual(plan.argv, ['--standalone']);
  const config = JSON.parse(plan.environmentOverrides.OPENCODE_CONFIG_CONTENT);
  // v2.2.5 Config.MCP decodes native fields only under servers; direct entries use v1 decoding.
  assert.deepEqual(Object.keys(config.mcp), ['servers']);
  assert.deepEqual(Object.keys(config.mcp.servers), [fixture('opencode').mcp.serverName]);
  const server = config.mcp.servers[fixture('opencode').mcp.serverName];
  assert.deepEqual(server.command, ['/synthetic/private/node', '/synthetic/private/relay.cjs']);
  assert.equal(server.type, 'local');
  assert.equal(server.disabled, false);
  assert.equal(server.codemode, false);
  assert.equal(server.protocol, 'legacy');
  assert.deepEqual(server.timeout, { startup: 10000, catalog: 10000, execution: 125000 });
  assert.equal('enabled' in server, false);
  assert.equal(plan.installedTimeoutConfiguration, 'separate_startup_catalog_execution');
  assert.equal(plan.mcpConfiguration, 'merged_inline_configuration');
  assert.deepEqual(Object.keys(plan.environmentOverrides), ['OPENCODE_CONFIG_CONTENT']);
  assert.equal(plan.execution, 'blocked');
  assert.equal(plan.providerAcceptance, 'not_run');
  assert.throws(() =>
    opencodeInteractiveMcpConfiguration({ ...fixture('opencode'), sessionId: randomUUID() }),
  );
});

test('provider configuration review rejects version/hash drift and injected credentials, commands or identity fields', () => {
  for (const provider of ['claude', 'opencode'] as const) {
    const input = {
      ...fixture(provider),
      ...(provider === 'claude' ? { sessionId: randomUUID() } : {}),
    };
    const build =
      provider === 'claude'
        ? claudeInteractiveMcpConfiguration
        : opencodeInteractiveMcpConfiguration;
    assert.throws(() => build({ ...input, executableVersion: 'future' }), /provider version/);
    assert.throws(() => build({ ...input, executableSha256: 'invalid' }));
    for (const extra of [
      { HOME: '/new-login' },
      { token: 'SYNTHETIC' },
      { targetInstanceId: randomUUID() },
      { argv: ['--dangerously-skip-permissions'] },
    ])
      assert.throws(() => build({ ...input, ...extra }));
    assert.throws(() => build({ ...input, mcp: { ...input.mcp, secret: 'SYNTHETIC' } }));
    assert.throws(() => build({ ...input, nodePath: 'relative/node' }));
    assert.throws(() => build({ ...input, mcp: { ...input.mcp, serverName: 'native-server' } }));
    assert.throws(
      () => interactiveCliAdapter(provider, 'reuse-existing'),
      /no reviewed launch contract/,
    );
    assert.throws(
      () => interactiveCliAdapter(provider, 'separate-login', true),
      /no reviewed launch contract/,
    );
    assert.ok(interactiveCliAdapter(provider, 'reuse-existing', true).backend);
    assert.equal(interactiveCliStatus(provider).mcpConfiguration, 'desktop_opt_in_synthetic_only');
    assert.equal(interactiveCliStatus(provider).installedVersionCompatibility, 'unvalidated');
    const plan = build(input);
    assert.ok(plan.nativeIdentityEnvironment.includes('HOME'));
    assert.equal('HOME' in plan.environmentOverrides, false);
    assert.equal('CLAUDE_CONFIG_DIR' in plan.environmentOverrides, false);
    assert.equal('XDG_DATA_HOME' in plan.environmentOverrides, false);
    assert.equal('CODEX_HOME' in plan.environmentOverrides, false);
    assert.doesNotMatch(
      JSON.stringify(plan),
      /--print|--continue|--resume|--session"|--channels|--allowedTools|--auto|--dangerously/,
    );
  }
  for (const descriptor of [claudeDescriptor, opencodeDescriptor]) {
    assert.equal(descriptor.implemented, false);
    assert.ok(Object.values(descriptor.capabilities).every((value) => value === false));
  }
});
