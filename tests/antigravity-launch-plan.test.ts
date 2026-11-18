// Synthetic inputs only. No installed CLI, database, configuration or credentials are opened.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  antigravityInteractiveLaunchPlan,
  reviewedAntigravityBinary,
} from '../packages/core/src/terminal/antigravity-launch-plan.js';
import {
  interactiveCliAdapter,
  interactiveCliStatus,
} from '../packages/core/src/terminal/interactive-adapters.js';
import { terminalRPCSchema } from '../packages/core/src/terminal/rpc.js';
import { terminalMcpPairRequestSchema } from '@orqst/protocol';

function fixture() {
  return {
    executable: '/synthetic/agy',
    executableVersion: reviewedAntigravityBinary.version,
    executableSha256: reviewedAntigravityBinary.sha256,
    project: '/synthetic/project',
    home: '/synthetic/home',
  };
}

test('Antigravity candidate preserves minimal environment allowlist and marks per-session MCP unavailable', () => {
  const input = fixture();
  const plan = antigravityInteractiveLaunchPlan(input);
  assert.equal(plan.provider, 'antigravity');
  assert.equal(plan.execution, 'blocked');
  assert.equal(plan.launchGrantAvailable, false);
  assert.equal(plan.authentication, 'unknown');
  assert.equal(plan.providerAcceptance, 'not_run');
  assert.deepEqual(plan.argv, []);
  assert.deepEqual(plan.environment, {
    HOME: '/synthetic/home',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    TERM: 'xterm-256color',
  });
  assert.equal(plan.mcpConfiguration, 'unavailable_global_or_workspace_only');
  assert.ok(plan.blockers.includes('per_session_mcp_configuration_unavailable'));
  assert.ok(plan.blockers.includes('shared_native_gemini_state_requires_acknowledgment'));

  const withModel = antigravityInteractiveLaunchPlan({ ...input, model: 'gemini-2.5-pro' });
  assert.deepEqual(withModel.argv, ['--model', 'gemini-2.5-pro']);

  const status = interactiveCliStatus('antigravity');
  assert.equal(status.perInstanceMcp, 'unavailable');
  assert.equal(status.mcpConfiguration, 'unavailable_global_or_workspace_only');

  assert.ok(interactiveCliAdapter('antigravity', 'reuse-existing', true));
  assert.throws(() => interactiveCliAdapter('antigravity', 'separate-login', true));
  assert.throws(() => interactiveCliAdapter('antigravity', 'reuse-existing', false));

  assert.equal(
    terminalRPCSchema.safeParse({
      id: randomUUID(),
      operation: 'prepare',
      args: ['desktop-managed', 'antigravity-terminal-v1'],
    }).success,
    true,
  );
  assert.doesNotMatch(
    JSON.stringify(withModel.argv),
    /--prompt|--resume|--continue|--auto|--yolo|--mcp/,
  );
});

test('Antigravity plan rejects binary/version drift, MCP injection, credentials and relative selectors', () => {
  const input = fixture();
  for (const extra of [
    { executableSha256: '0'.repeat(64) },
    { executableVersion: '1.5.11' },
    { executable: 'relative/agy' },
    { project: 'relative/project' },
    { home: '/synthetic/\0invalid' },
    { model: '--prompt=bad' },
    { argv: ['--prompt', 'SYNTHETIC'] },
    { token: 'SYNTHETIC' },
    {
      mcp: {
        serverName: 'orqst_' + 'a'.repeat(32),
        socketPath: '/synthetic/socket',
        capabilityFile: '/synthetic/cap',
        relay: { path: '/synthetic/relay.cjs', sha256: 'b'.repeat(64) },
      },
    },
  ])
    assert.throws(() => antigravityInteractiveLaunchPlan({ ...input, ...extra }));

  assert.equal(
    terminalMcpPairRequestSchema.safeParse({
      action: 'create-mcp-pair',
      generation: 1,
      workspaceId: 'synthetic-workspace',
      featureId: null,
      catalogId: 'a'.repeat(64),
      sourceProvider: 'antigravity',
      workerProvider: 'codex',
      codexModelId: 'b'.repeat(64),
    }).success,
    false,
  );
});
