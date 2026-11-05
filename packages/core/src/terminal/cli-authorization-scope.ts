import type { CliContractMode, CliContractProvider } from './cli-contract.js';

/** Stable authorization labels for the existing provider launch profiles. */
export function cliAuthorizationScope(
  provider: CliContractProvider,
  mode: CliContractMode,
  native = true,
) {
  const mcp = mode === 'mcp' ? 'orqst-mcp-configured' : 'native-mcp';
  if (provider === 'codex')
    return {
      environmentProfile: native
        ? 'native-auth-config-sessions-no-inherited-credentials-v1'
        : 'managed-home-no-inherited-credentials-v1',
      cliAuthorizationScope: `codex-read-only-on-request-v1:${native ? 'native' : 'managed'}:${mcp}`,
    };
  if (provider === 'claude')
    return {
      environmentProfile: 'claude-native-identity-no-inherited-credentials-v1',
      cliAuthorizationScope: `claude-native-v1:${mcp}`,
    };
  return {
    environmentProfile: 'opencode-native-identity-no-inherited-credentials-v1',
    cliAuthorizationScope: `opencode-standalone-native-v1:${mcp}`,
  };
}
