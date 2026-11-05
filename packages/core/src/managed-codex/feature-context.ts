import { z } from 'zod';
import { stableId } from '@orqst/shared';
import { terminalDigest } from '../terminal/authority.js';
import { type ManagedCodexConfig } from '../terminal/codex-profile.js';
import { terminalIdentity } from '../terminal/identity.js';
import {
  resolveTerminalPreparationContext,
  terminalPreparationContextSchema,
  type TerminalPreparationContext,
} from '../terminal/preparation-context.js';

/** Private native bootstrap only. Never part of an agent/renderer request schema. */
export const managedAgentsFeatureContextSchema = terminalPreparationContextSchema.extend({
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/),
  featureId: z.uuid(),
});
export type ManagedAgentsFeatureContext = z.infer<typeof managedAgentsFeatureContextSchema>;

/** Resolve IDs from native-prepared manifests against the native-owned catalogue and preferences. */
export function resolveManagedAgentsFeatureContext(
  configs: ManagedCodexConfig[],
  native?: TerminalPreparationContext,
): ManagedAgentsFeatureContext | undefined {
  const scoped = configs.some((config) => config.preparation?.featureId != null);
  if (!scoped) return undefined; // Selection alone never promotes a legacy manifest.
  if (!native) throw new Error('Native Feature context unavailable');
  const trusted = terminalPreparationContextSchema.parse(native);
  const first = configs[0];
  const binding = first?.preparation;
  if (!first || !binding?.featureId) throw new Error('Mixed Feature preparation denied');
  const workspaceId = stableId('workspace', first.project);
  for (const config of configs) {
    const other = config.preparation;
    if (
      config.project !== first.project ||
      !other ||
      other.workspaceId !== workspaceId ||
      other.featureId !== binding.featureId ||
      other.fence !== binding.fence ||
      other.observerDatabase !== trusted.observerDatabase ||
      other.preferencesDirectory !== trusted.preferencesDirectory
    )
      throw new Error('Native Feature binding mismatch');
  }
  const current = resolveTerminalPreparationContext(trusted, workspaceId, binding.featureId);
  const ids = configs.map((config) => terminalIdentity(config).terminalId);
  if (
    current.project !== first.project ||
    current.fence !== binding.fence ||
    new Set(ids).size !== configs.length ||
    !current.feature ||
    ids.some((id) => !current.feature!.terminalIds.includes(id))
  )
    throw new Error('Native Feature membership unavailable');
  return managedAgentsFeatureContextSchema.parse({
    ...trusted,
    workspaceId,
    featureId: binding.featureId,
  });
}

/** Explicit mapping of distinct ID domains; existing project journals keep their digest. */
export function managedAgentsWorkspaceIds(project: string) {
  return Object.freeze({
    canonicalWorkspaceId: stableId('workspace', project),
    legacyProjectDigest: terminalDigest(project),
  });
}
