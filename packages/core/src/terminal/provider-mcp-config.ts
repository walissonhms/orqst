// Configuration review only. No filesystem/process/credential access and no executable factory.
import { z } from 'zod';
import { terminalMcpLaunchSchema } from './mcp-launch.js';

/** Passive local binary metadata, not a provider run or proof of login/protocol compatibility. */
export const reviewedProviderMcpBinaries = Object.freeze({
  claude: Object.freeze({
    version: '2.1.178',
    sha256: '473495d0c15d6616cd0870480db5eb8aa0402fe4f8ead3277a1b521e94110309',
  }),
  opencode: Object.freeze({
    version: '2.2.5',
    sha256: 'abe4d88594bffb12b364375b8a6732d2d1f7a977195ed1a35c5c76f8e89c9e0e',
  }),
});

const inputSchema = z.strictObject({
  executableVersion: z.string().min(1).max(64),
  executableSha256: z.string().regex(/^[a-f0-9]{64}$/),
  nodePath: z
    .string()
    .min(1)
    .max(2048)
    .startsWith('/')
    .refine((value) => !value.includes('\0')),
  mcp: terminalMcpLaunchSchema,
});
const claudeInputSchema = inputSchema.extend({ sessionId: z.uuid() });

const commonBlockers = [
  'native_launch_grant_required',
  'installed_mcp_protocol_unverified',
  'native_login_identity_unvalidated',
  'shared_native_session_writes_require_acknowledgment',
  'native_focus_and_provider_acceptance_pending',
] as const;

function assertReviewed(
  provider: keyof typeof reviewedProviderMcpBinaries,
  input: z.infer<typeof inputSchema>,
) {
  const reviewed = reviewedProviderMcpBinaries[provider];
  if (input.executableVersion !== reviewed.version || input.executableSha256 !== reviewed.sha256)
    throw new Error('No reviewed MCP configuration for this exact provider binary');
}

/** Offline argv candidate only; HOME/CLAUDE_CONFIG_DIR and native Keychain identity stay untouched. */
export function claudeInteractiveMcpConfiguration(raw: unknown) {
  const input = claudeInputSchema.parse(raw);
  assertReviewed('claude', input);
  const { mcp } = input;
  return {
    provider: 'claude' as const,
    executableVersion: input.executableVersion,
    evidence: 'passive_binary_metadata_and_official_documentation' as const,
    execution: 'blocked' as const,
    providerAcceptance: 'not_run' as const,
    argv: [
      '--strict-mcp-config',
      '--mcp-config',
      JSON.stringify({
        mcpServers: {
          [mcp.serverName]: {
            type: 'stdio',
            command: input.nodePath,
            args: [mcp.relay.path],
            env: { ORQST_SOCKET_PATH: mcp.socketPath, ORQST_CAP_FILE: mcp.capabilityFile },
          },
        },
      }),
      '--session-id',
      input.sessionId,
    ],
    environmentOverrides: { MCP_TIMEOUT: '10000', MCP_TOOL_TIMEOUT: '125000' },
    nativeIdentityEnvironment: ['HOME', 'CLAUDE_CONFIG_DIR'],
    mcpConfiguration: 'strict_per_invocation' as const,
    blockers: [
      ...commonBlockers,
      'strict_mcp_exclusion_requires_acknowledgment',
      'strict_project_mcp_approval_can_still_block_2_1_178',
    ],
  };
}

/** Offline inline-config candidate only; no invented --mcp-config/--config CLI flags. */
export function opencodeInteractiveMcpConfiguration(raw: unknown) {
  const input = inputSchema.parse(raw);
  assertReviewed('opencode', input);
  const { mcp } = input;
  return {
    provider: 'opencode' as const,
    executableVersion: input.executableVersion,
    evidence: 'passive_binary_metadata_and_official_documentation' as const,
    execution: 'blocked' as const,
    providerAcceptance: 'not_run' as const,
    // Default 2.2.5 startup discovers/starts the user's background service. Never use it.
    argv: ['--standalone'],
    environmentOverrides: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        mcp: {
          servers: {
            [mcp.serverName]: {
              type: 'local',
              command: [input.nodePath, mcp.relay.path],
              environment: {
                ORQST_SOCKET_PATH: mcp.socketPath,
                ORQST_CAP_FILE: mcp.capabilityFile,
              },
              disabled: false,
              codemode: false,
              protocol: 'legacy',
              timeout: { startup: 10000, catalog: 10000, execution: 125000 },
            },
          },
        },
      }),
    },
    nativeIdentityEnvironment: [
      'HOME',
      'XDG_CONFIG_HOME',
      'XDG_DATA_HOME',
      'XDG_STATE_HOME',
      'XDG_CACHE_HOME',
      'OPENCODE_CONFIG_DIR',
      'OPENCODE_DB',
    ],
    mcpConfiguration: 'merged_inline_configuration' as const,
    installedTimeoutConfiguration: 'separate_startup_catalog_execution' as const,
    blockers: [
      ...commonBlockers,
      'managed_factory_unimplemented',
      'native_auth_and_session_data_roots_coupled',
      'merged_plugins_hooks_and_managed_settings_unvalidated',
      'installed_tool_exposure_and_timeout_behavior_unvalidated',
      'native_database_startup_migrations_not_authorized',
      'native_standalone_descendant_lifecycle_unvalidated',
    ],
  };
}
