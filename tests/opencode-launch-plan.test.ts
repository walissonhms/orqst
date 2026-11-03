// Synthetic inputs only. No installed CLI, database, configuration or credentials are opened.
import assert from 'node:assert/strict';
import test from 'node:test';
import { opencodeInteractiveLaunchPlan } from '../packages/core/src/terminal/opencode-launch-plan.js';
import { reviewedProviderMcpBinaries } from '../packages/core/src/terminal/provider-mcp-config.js';
import { interactiveCliAdapter } from '../packages/core/src/terminal/interactive-adapters.js';
import { terminalRPCSchema } from '../packages/core/src/terminal/rpc.js';
import { randomUUID } from 'node:crypto';

function fixture() {
  return {
    executable: '/synthetic/opencode',
    executableVersion: reviewedProviderMcpBinaries.opencode.version,
    executableSha256: reviewedProviderMcpBinaries.opencode.sha256,
    project: '/synthetic/project',
    nodePath: '/synthetic/node',
    nativeIdentity: {
      HOME: '/synthetic/home',
      XDG_DATA_HOME: '/synthetic/data',
      XDG_CONFIG_HOME: '/synthetic/config',
      XDG_CACHE_HOME: '/synthetic/cache',
      XDG_STATE_HOME: '/synthetic/state',
      OPENCODE_CONFIG_DIR: '/synthetic/config/opencode',
      OPENCODE_DB: '/synthetic/data/opencode/existing.db',
    },
  };
}

test('OpenCode standalone candidate preserves native identity without granting launch or shared database migrations', () => {
  const input = fixture();
  const plan = opencodeInteractiveLaunchPlan(input);
  assert.equal(plan.execution, 'blocked');
  assert.equal(plan.launchGrantAvailable, false);
  assert.equal(plan.authentication, 'unknown');
  assert.equal(plan.providerAcceptance, 'not_run');
  assert.deepEqual(plan.argv, ['--standalone']);
  assert.equal(plan.server.sharedServiceDiscovery, false);
  assert.equal(plan.server.hostname, '127.0.0.1');
  assert.equal(plan.server.port, 0);
  assert.equal(plan.nativeDatabase.inspected, false);
  assert.ok(plan.blockers.includes('native_database_startup_migrations_not_authorized'));
  for (const [name, value] of Object.entries(input.nativeIdentity))
    assert.equal(plan.environment[name as keyof typeof plan.environment], value);
  assert.throws(() => interactiveCliAdapter('opencode', 'reuse-existing', true));
  assert.equal(
    terminalRPCSchema.safeParse({
      id: randomUUID(),
      operation: 'prepare',
      args: ['desktop-managed', 'opencode-terminal-v1'],
    }).success,
    false,
  );
  assert.doesNotMatch(
    JSON.stringify(plan.argv),
    /--server|--session|--continue|--prompt|--auto|--yolo/,
  );
});

test('OpenCode plan rejects binary/version drift, credentials, identity injection and relative selectors', () => {
  const input = fixture();
  for (const extra of [
    { executableSha256: '0'.repeat(64) },
    { executableVersion: 'future' },
    { argv: ['--server', 'http://external'] },
    { sessionId: randomUUID() },
    { token: 'SYNTHETIC' },
    { project: 'relative' },
    { nativeIdentity: { ...input.nativeIdentity, OPENCODE_PASSWORD: 'SYNTHETIC' } },
    { nativeIdentity: { ...input.nativeIdentity, OPENCODE_DB: ':memory:' } },
    { nativeIdentity: { ...input.nativeIdentity, HOME: '/synthetic\0invalid' } },
  ])
    assert.throws(() => opencodeInteractiveLaunchPlan({ ...input, ...extra }));
});

test('OpenCode per-instance MCP plan keeps installed timeout units and startup selection in the same candidate', () => {
  const plan = opencodeInteractiveLaunchPlan({
    ...fixture(),
    mcp: {
      serverName: 'orqst_' + 'a'.repeat(32),
      socketPath: '/synthetic/socket',
      capabilityFile: '/synthetic/cap',
      relay: { path: '/synthetic/relay.cjs', sha256: 'b'.repeat(64) },
    },
  });
  const document = JSON.parse(plan.environment.OPENCODE_CONFIG_CONTENT!);
  const server = document.mcp.servers['orqst_' + 'a'.repeat(32)];
  assert.deepEqual(server.command, ['/synthetic/node', '/synthetic/relay.cjs']);
  assert.deepEqual(server.environment, {
    ORQST_SOCKET_PATH: '/synthetic/socket',
    ORQST_CAP_FILE: '/synthetic/cap',
  });
  assert.deepEqual(server.timeout, { startup: 10000, catalog: 10000, execution: 125000 });
  assert.equal(server.protocol, 'legacy');
  assert.equal(plan.mcpConfiguration, 'merged_inline_configuration');
  assert.equal(plan.launchGrantAvailable, false);
});
