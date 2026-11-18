// Review only. No filesystem, credential, database, socket or process access.
import { z } from 'zod';

/** Passive local Mach-O metadata for /Users/walissonhmsouza/.local/bin/agy (1.5.10). */
export const reviewedAntigravityBinary = Object.freeze({
  version: '1.5.10',
  sha256: '780ee763a9938a37b45c7f9d6ae31747d7c574358fd10c64d3a1cdc36faf2798',
});

const path = z
  .string()
  .min(1)
  .max(2048)
  .startsWith('/')
  .refine((value) => !value.includes('\0'));
const modelSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/#@+-]*$/);
const inputSchema = z.strictObject({
  executable: path,
  executableVersion: z.literal(reviewedAntigravityBinary.version),
  executableSha256: z.literal(reviewedAntigravityBinary.sha256),
  project: path,
  home: path,
  model: modelSchema.nullable().optional(),
});

/** An inspectable candidate, deliberately not a TerminalProfile or a native execution grant. */
export function antigravityInteractiveLaunchPlan(raw: unknown) {
  const input = inputSchema.parse(raw);
  return {
    version: 1 as const,
    provider: 'antigravity' as const,
    execution: 'blocked' as const,
    launchGrantAvailable: false as const,
    providerAcceptance: 'not_run' as const,
    authentication: 'unknown' as const,
    executable: input.executable,
    executableVersion: input.executableVersion,
    executableSha256: input.executableSha256,
    cwd: input.project,
    argv: input.model ? ['--model', input.model] : [],
    environment: {
      HOME: input.home,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      TERM: 'xterm-256color',
    },
    session: {
      selection: 'no_resume_or_conversation_argument' as const,
      nativeUiAcceptance: 'not_run' as const,
    },
    mcpConfiguration: 'unavailable_global_or_workspace_only' as const,
    blockers: [
      'shared_native_gemini_state_requires_acknowledgment',
      'per_session_mcp_configuration_unavailable',
      'native_login_focus_and_provider_acceptance_pending',
    ],
  };
}
