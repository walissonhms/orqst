import type { LocalCliProvider } from './local-cli.js';
import {
  managedCodexEnvironment,
  managedCodexProfiles,
  readManagedCodexConfig,
} from './codex-profile.js';
import { managedTerminalBackend } from './pty-backend.js';

/** Integration evidence, not discovery, native login, model entitlement or an execution grant. */
export function interactiveCliStatus(provider: LocalCliProvider) {
  return {
    provider,
    terminal:
      provider === 'codex'
        ? ('legacy_separate_login_fixture_validated' as const)
        : ('unimplemented' as const),
    existingLoginPty:
      provider === 'codex' ? ('explicit_opt_in_unvalidated' as const) : ('blocked' as const),
    perInstanceMcp: 'synthetic_transport_only' as const,
    mcpConfiguration:
      provider === 'codex'
        ? ('desktop_opt_in_synthetic_only' as const)
        : ('version_scoped_builder_only' as const),
    installedVersionCompatibility: 'unvalidated' as const,
    automaticTaskDelivery: 'unvalidated' as const,
    providerAcceptance: 'not_run' as const,
  };
}

/** Common PTY backend/profile boundary; unsupported providers/auth modes have no factory. */
export function interactiveCliAdapter(
  provider: LocalCliProvider,
  authentication: 'reuse-existing' | 'separate-login',
  nativeSessionWritesAcknowledged = false,
) {
  if (
    provider !== 'codex' ||
    (authentication === 'reuse-existing' && !nativeSessionWritesAcknowledged)
  )
    throw new Error('Interactive CLI adapter has no reviewed launch contract for this mode');
  return {
    readManifest: readManagedCodexConfig,
    profiles: managedCodexProfiles,
    environment: managedCodexEnvironment,
    backend: managedTerminalBackend,
  };
}
