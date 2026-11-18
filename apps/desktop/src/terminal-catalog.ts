import { terminalPreparationCatalogSchema, terminalCatalogRequestSchema } from '@orqst/protocol';
import { z } from 'zod';
import { terminalFile } from '../../../packages/core/src/terminal/codex-profile.js';
import { cachedTerminalExecutableSha256 } from '../../../packages/core/src/terminal/codex-profile.js';
import { isAutomaticCliReview } from '../../../packages/core/src/terminal/cli-executable-review.js';
import { terminalDigest } from '../../../packages/core/src/terminal/authority.js';
import {
  resolveTerminalPreparationContext,
  type TerminalPreparationContext,
} from '../../../packages/core/src/terminal/preparation-context.js';
import {
  discoverTerminalModels,
  type TerminalModelSelection,
} from '../../../packages/core/src/terminal/model-selection.js';
import {
  localCliProviders,
  type LocalCliProvider,
} from '../../../packages/core/src/terminal/local-cli.js';
import { inspectCatalogExecutables } from './terminal-discovery.js';
import type { TerminalCreationInput } from './terminal-creation.js';

/** Resolve the scope and re-read only providers participating in the request. */
export function inspectTerminalPreparationCatalog(
  raw: unknown,
  trusted: TerminalPreparationContext,
  context: Pick<TerminalCreationInput, 'home' | 'environment'>,
  requestedProviders: readonly LocalCliProvider[],
  restoreSavedFeature = false,
) {
  const request = terminalCatalogRequestSchema.parse(raw);
  const workspace = resolveTerminalPreparationContext(
    trusted,
    request.workspaceId,
    request.featureId,
    restoreSavedFeature,
  );
  const providers = inspectCatalogExecutables(
    requestedProviders,
    context.environment.PATH ?? '',
    context.home,
    trusted.preferencesDirectory,
  ).map(({ provider, executables, refusal, candidate }) => {
    if (executables.length !== 1)
      return { provider, executables, models: null, refusal, candidate };
    let models;
    try {
      models = discoverTerminalModels(
        provider,
        workspace.project,
        context.home,
        context.environment,
      );
    } catch {
      // Unsafe/unreadable source files cannot be treated as an empty native configuration.
      return { provider, executables, models: null, refusal, candidate };
    }
    const executable = executables.length === 1 ? executables[0]! : null;
    const identity = JSON.stringify([
      provider,
      executable,
      candidate?.launcher ?? null,
      executable ? cachedTerminalExecutableSha256(executable) : null,
      context.home,
      context.environment.PATH ?? '',
      // Only native selectors consumed by this provider, never credential variables.
      ...(provider === 'codex'
        ? [context.environment.CODEX_HOME ?? null]
        : provider === 'claude'
          ? [context.environment.CLAUDE_CONFIG_DIR ?? null]
          : provider === 'antigravity'
            ? []
            : [
                'XDG_CONFIG_HOME',
                'XDG_DATA_HOME',
                'XDG_STATE_HOME',
                'XDG_CACHE_HOME',
                'OPENCODE_CONFIG_DIR',
                'OPENCODE_DB',
              ].map((key) => context.environment[key] ?? null)),
    ]);
    models = {
      ...models,
      options: models.options.map((option) => ({
        ...option,
        id: selectionId(identity, option.label, option.selection),
      })),
    };
    return { provider, executables, models, identity, refusal, candidate };
  });
  return { request, catalogId: terminalCatalogId(trusted, workspace), providers, workspace };
}

export function terminalCatalogId(
  trusted: TerminalPreparationContext,
  workspace: Pick<ReturnType<typeof resolveTerminalPreparationContext>, 'fence' | 'target'>,
) {
  return terminalDigest(
    JSON.stringify([
      trusted.observerDatabase,
      trusted.preferencesDirectory,
      workspace.fence,
      workspace.target?.revision ?? null,
    ]),
  );
}

/** Fields from the already released immutable member. Every new launch has fresh review. */
export function inspectReleasedTerminal(
  workspace: ReturnType<typeof resolveTerminalPreparationContext>,
  terminalId: string,
) {
  if (!workspace.feature) return;
  const member = workspace.feature.terminalDisplays?.find(
    (entry) => entry.terminalId === terminalId,
  );
  if (!member?.released) return;
  const receipt = workspace.features.releasedTerminal(workspace.feature.featureId, terminalId);
  if (!receipt) return;
  const saved = z
    .object({
      version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      identity: z.object({ terminalId: z.uuid() }),
      project: z.string(),
      model: z.object({ value: z.string().nullable() }).optional(),
    })
    .parse(JSON.parse(terminalFile(receipt.file, true).toString('utf8')));
  if (saved.identity.terminalId !== terminalId || saved.project !== workspace.project) return;
  return {
    provider: localCliProviders[saved.version - 1]!,
    value: saved.model?.value ?? null,
    name:
      workspace.features
        .readLayout(workspace.feature.featureId)
        ?.names.find(({ id }) => id === terminalId)?.name ?? member.displayId,
  };
}

/** Read-only catalog with verified installation metadata and opaque launch choices. */
export function terminalPreparationCatalog(
  raw: unknown,
  trusted: TerminalPreparationContext,
  context: Pick<TerminalCreationInput, 'home' | 'environment'>,
  restoreSavedFeature = false,
) {
  const { request, catalogId, providers, workspace } = inspectTerminalPreparationCatalog(
    raw,
    trusted,
    context,
    localCliProviders,
    restoreSavedFeature,
  );
  const feature = workspace.feature;
  const reopenable = feature?.terminalDisplays?.flatMap((member) => {
    if (!member.released) return [];
    try {
      const saved = inspectReleasedTerminal(workspace, member.terminalId);
      const id = providers
        .find((entry) => entry.provider === saved?.provider)
        ?.models?.options.find((option) => option.selection.value === saved?.value)?.id;
      if (!saved || !id) return [];
      return [
        {
          terminalId: member.terminalId,
          displayId: member.displayId,
          provider: saved.provider,
          modelId: id,
          name: saved.name,
        },
      ];
    } catch {
      return [];
    }
  });
  return terminalPreparationCatalogSchema.parse({
    contractVersion: 1,
    workspaceId: request.workspaceId,
    featureId: request.featureId,
    catalogId,
    ...(reopenable?.length ? { reopenable } : {}),
    ...(restoreSavedFeature && workspace.feature
      ? {
          restoredFeature: {
            featureId: workspace.feature.featureId,
            name: workspace.feature.name,
            terminalIds: workspace.feature.terminalIds,
            ...(workspace.feature.terminalDisplays?.some((member) => member.released)
              ? { terminalDisplays: workspace.feature.terminalDisplays }
              : {}),
          },
        }
      : {}),
    providers: providers.map(({ provider, executables, models, refusal, candidate }) => ({
      provider,
      ...(candidate && executables.length === 1 && candidate.path.length <= 4096
        ? { path: candidate.path, ...(candidate.version ? { version: candidate.version } : {}) }
        : {}),
      status: executables.length === 1 && models ? 'available' : 'unavailable',
      reason: !executables.length
        ? refusal
        : executables.length > 1
          ? 'ambiguous_executable'
          : !models || models.limited
            ? 'catalog_limited'
            : 'ready',
      ...(candidate?.decision === 'review' && refusal === 'executable_unreviewed'
        ? { reviewId: cliReviewId(candidate) }
        : models &&
            candidate?.decision === 'exact' &&
            candidate.previous &&
            isAutomaticCliReview(candidate.previous.source)
          ? { verifiedUpdate: candidate.previous.version }
          : {}),
      models:
        models?.options.map(({ id, label, selection }) => ({
          id,
          label,
          source: selection.source,
          isDefault: selection.value === null,
          availability: 'unverified',
        })) ?? [],
    })),
  });
}

/** An opaque 64-hex choice: original deadline + 208-bit evidence digest, no public paths. */
function selectionId(identity: string, label: string, selection: TerminalModelSelection) {
  const expiry = (selection.expiresAt ?? 0).toString(16).padStart(12, '0');
  return expiry + terminalDigest(JSON.stringify([identity, label, selection])).slice(0, 52);
}

/** Rebind only an unchanged choice; refreshing a cache cannot extend the selected deadline. */
export function resolveCatalogSelection(
  discovered: Pick<ReturnType<typeof inspectTerminalPreparationCatalog>, 'providers'>,
  name: LocalCliProvider,
  id: string,
) {
  const provider = discovered.providers.find((entry) => entry.provider === name);
  if (!provider?.identity || provider.executables.length !== 1) return undefined;
  const expiresAt = Number.parseInt(id.slice(0, 12), 16);
  for (const option of provider.models?.options ?? []) {
    const currentExpiry = option.selection.expiresAt;
    if (
      currentExpiry === undefined
        ? expiresAt !== 0
        : expiresAt <= Date.now() || expiresAt > currentExpiry
    )
      continue;
    const selection = { ...option.selection, ...(expiresAt ? { expiresAt } : {}) };
    if (selectionId(provider.identity, option.label, selection) === id)
      return {
        provider: name,
        executable: provider.executables[0]!,
        model: selection,
        candidate: provider.candidate,
      };
  }
  return undefined;
}

export function cliReviewId(
  candidate: NonNullable<ReturnType<typeof inspectCatalogExecutables>[number]['candidate']>,
) {
  return terminalDigest(JSON.stringify(candidate));
}
