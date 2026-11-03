// Passive executable discovery only. Never execute a CLI or inspect provider state.
import { accessSync, constants, lstatSync, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

export const localCliProviders = ['codex', 'claude', 'opencode'] as const;
export type LocalCliProvider = (typeof localCliProviders)[number];
export const localCliDiscoveryPolicy = Object.freeze({
  maximumPathBytes: 32768,
  maximumDirectories: 128,
  maximumCandidates: 16,
});

export interface LocalCliDiscovery {
  provider: LocalCliProvider;
  lookup: 'candidate_found' | 'not_found' | 'incomplete';
  candidates: { launcher: string; canonical: string }[];
  inspection: 'complete' | 'limited';
  version: null;
  authentication: 'unknown';
  execution: 'not_authorized';
}

/** PATH order is evidence, not launch authority. Symlinked CLI launchers are common. */
export function discoverLocalClis(searchPath: string): LocalCliDiscovery[] {
  if (Buffer.byteLength(searchPath) > localCliDiscoveryPolicy.maximumPathBytes)
    throw new Error('CLI discovery PATH exceeds the inspection budget');
  const entries = [...new Set(searchPath.split(delimiter))];
  // Empty/relative entries depend on cwd and must never select a project executable.
  const directories = entries.filter((entry) => isAbsolute(entry) && !entry.includes('\0'));
  const limited = directories.length > localCliDiscoveryPolicy.maximumDirectories;
  return localCliProviders.map((provider) => {
    const candidates: LocalCliDiscovery['candidates'] = [];
    const seen = new Set<string>();
    let incomplete = limited;
    for (const directory of directories.slice(0, localCliDiscoveryPolicy.maximumDirectories)) {
      if (candidates.length === localCliDiscoveryPolicy.maximumCandidates) {
        incomplete = true;
        break;
      }
      const launcher = join(directory, provider);
      try {
        const entry = lstatSync(launcher);
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        const canonical = realpathSync(launcher);
        const info = lstatSync(canonical);
        if (!info.isFile() || !(info.mode & 0o111) || seen.has(canonical)) continue;
        accessSync(canonical, constants.X_OK);
        seen.add(canonical);
        candidates.push({ launcher, canonical });
      } catch (error) {
        // Absence is ordinary. Other failures leave availability uncertain.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') incomplete = true;
      }
    }
    return {
      provider,
      lookup: candidates.length ? 'candidate_found' : incomplete ? 'incomplete' : 'not_found',
      candidates,
      inspection: incomplete ? 'limited' : 'complete',
      version: null,
      authentication: 'unknown',
      execution: 'not_authorized',
    };
  });
}

const reuseBlockers = {
  codex: ['codex_auth_and_session_root_coupled', 'installed_protocol_unverified'],
  claude: ['claude_auth_and_config_identity_coupled', 'managed_adapter_unimplemented'],
  opencode: ['opencode_auth_and_data_isolation_unverified', 'managed_adapter_unimplemented'],
} as const;

/** A reviewable integration preflight, deliberately incapable of launching or logging in. */
export function localCliIntegrationPlan(discovery: LocalCliDiscovery) {
  return {
    provider: discovery.provider,
    authenticationPolicy: 'reuse_existing' as const,
    authentication: 'unknown' as const,
    providerOwnsCredentials: true,
    automaticInstall: false,
    automaticLogin: false,
    execution: 'blocked' as const,
    blockers: [
      ...(discovery.lookup === 'not_found' ? ['executable_not_found'] : []),
      ...(discovery.inspection === 'limited' ? ['discovery_incomplete'] : []),
      ...(discovery.candidates.length > 1 ? ['explicit_executable_selection_required'] : []),
      'exact_binary_review_required',
      ...reuseBlockers[discovery.provider],
      'owner_execution_approval_required',
    ],
  };
}
