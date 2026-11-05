// Review only. No filesystem, credential, database, socket or process access.
import { z } from 'zod';
import { terminalMcpLaunchSchema } from './mcp-launch.js';
import {
  opencodeInteractiveMcpConfiguration,
  reviewedProviderMcpBinaries,
} from './provider-mcp-config.js';

const path = z
  .string()
  .min(1)
  .max(2048)
  .startsWith('/')
  .refine((v) => !v.includes('\0'));
export const opencodeNativeIdentitySchema = z.strictObject({
  HOME: path,
  XDG_CONFIG_HOME: path.optional(),
  XDG_DATA_HOME: path.optional(),
  XDG_STATE_HOME: path.optional(),
  XDG_CACHE_HOME: path.optional(),
  OPENCODE_CONFIG_DIR: path.optional(),
  OPENCODE_DB: path.optional(),
});
const inputSchema = z.strictObject({
  executable: path,
  executableVersion: z.literal(reviewedProviderMcpBinaries.opencode.version),
  executableSha256: z.string().regex(/^[a-f0-9]{64}$/),
  project: path,
  nativeIdentity: opencodeNativeIdentitySchema,
  nodePath: path,
  mcp: terminalMcpLaunchSchema.optional(),
});

/** An inspectable candidate, deliberately not a TerminalProfile or a native execution grant. */
export function opencodeInteractiveLaunchPlan(raw: unknown) {
  const input = inputSchema.parse(raw);
  const mcp = input.mcp
    ? opencodeInteractiveMcpConfiguration({
        executableVersion: input.executableVersion,
        executableSha256: input.executableSha256,
        nodePath: input.nodePath,
        mcp: input.mcp,
      })
    : undefined;
  return {
    version: 1 as const,
    provider: 'opencode' as const,
    execution: 'blocked' as const,
    launchGrantAvailable: false as const,
    providerAcceptance: 'not_run' as const,
    authentication: 'unknown' as const,
    executable: input.executable,
    executableVersion: input.executableVersion,
    executableSha256: input.executableSha256,
    cwd: input.project,
    argv: ['--standalone'],
    environment: {
      ...input.nativeIdentity,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      ...mcp?.environmentOverrides,
    },
    server: {
      selection: 'private_child' as const,
      hostname: '127.0.0.1',
      port: 0,
      authentication: 'generated_and_retained_by_native_cli' as const,
      sharedServiceDiscovery: false,
      descendantExit: 'unvalidated' as const,
    },
    session: { selection: 'no_resume_or_session_argument' as const, nativeUiAcceptance: 'not_run' },
    nativeDatabase: {
      credentialsAndSessions: 'shared' as const,
      startupMigrations: 'possible_not_authorized' as const,
      inspected: false,
    },
    mcpConfiguration: mcp?.mcpConfiguration ?? ('native_configuration' as const),
    blockers: [
      'native_database_startup_migrations_not_authorized',
      'native_standalone_descendant_lifecycle_unvalidated',
      'native_new_session_routing_unvalidated',
      'native_login_focus_and_provider_acceptance_pending',
      ...(mcp ? ['installed_mcp_protocol_and_timeout_behavior_unverified'] : []),
    ],
  };
}
