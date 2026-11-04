// Passive executable discovery only. Never execute a CLI or inspect provider state.
import { accessSync, constants, lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { localCliPathDirectories, localCliPathPolicy } from './local-cli-path.js';
import { interactiveCliStatus } from './interactive-adapters.js';

export const localCliProviders = ['codex', 'claude', 'opencode'] as const;
export type LocalCliProvider = (typeof localCliProviders)[number];
export const localCliDiscoveryPolicy = Object.freeze({
  ...localCliPathPolicy,
  maximumCandidates: 16,
});

export interface LocalCliDiscovery {
  provider: LocalCliProvider;
  lookup: 'candidate_found' | 'not_found' | 'incomplete';
  candidates: { launcher: string; canonical: string; origin: 'env' | 'fallback' }[];
  inspection: 'complete' | 'limited';
  rejectedDirectories: ReturnType<typeof localCliPathDirectories>['rejected'];
  pathPrecedence: ReturnType<typeof localCliPathDirectories>['precedence'];
  version: null;
  authentication: 'unknown';
  execution: 'not_authorized';
}

/** PATH order is evidence, not launch authority. Symlinked CLI launchers are common. */
export function discoverLocalClis(
  searchPath: string,
  home?: string,
  selectedDirectories: readonly string[] = [],
): LocalCliDiscovery[] {
  const search = localCliPathDirectories(searchPath, home, selectedDirectories);
  return localCliProviders.map((provider) => {
    const candidates: LocalCliDiscovery['candidates'] = [];
    const seen = new Set<string>();
    let incomplete = search.inspection === 'limited' || search.rejected.length > 0;
    for (const directory of search.directories) {
      if (candidates.length === localCliDiscoveryPolicy.maximumCandidates) {
        incomplete = true;
        break;
      }
      const launcher = join(directory.path, provider);
      try {
        const entry = lstatSync(launcher);
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        const canonical = realpathSync(launcher);
        const info = lstatSync(canonical);
        if (!info.isFile() || !(info.mode & 0o111) || seen.has(canonical)) continue;
        accessSync(canonical, constants.X_OK);
        seen.add(canonical);
        candidates.push({ launcher, canonical, origin: directory.origin });
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
      rejectedDirectories: search.rejected,
      pathPrecedence: search.precedence,
      version: null,
      authentication: 'unknown',
      execution: 'not_authorized',
    };
  });
}

const reuseBlockers = {
  codex: ['codex_auth_and_session_root_coupled', 'installed_protocol_unverified'],
  claude: [
    'claude_native_shared_state_acknowledgment_required',
    'native_provider_acceptance_pending',
  ],
  opencode: [
    'opencode_native_database_credentials_and_sessions_coupled',
    'native_database_startup_migrations_not_authorized',
    'native_standalone_descendant_lifecycle_unvalidated',
    'native_provider_acceptance_pending',
  ],
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
    interactive: interactiveCliStatus(discovery.provider),
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
