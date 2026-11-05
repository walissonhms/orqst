import { terminalPreparationCatalogSchema, terminalCatalogRequestSchema } from '@orqst/protocol';
import { terminalExecutableSha256 } from '../../../packages/core/src/terminal/codex-profile.js';
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
import { discoverTerminalExecutable } from './terminal-discovery.js';
import type { TerminalCreationInput } from './terminal-creation.js';

/** Read-only discovery. The returned public projection contains no launch paths or arguments. */
export function terminalPreparationCatalog(
  raw: unknown,
  trusted: TerminalPreparationContext,
  context: Pick<TerminalCreationInput, 'home' | 'environment'>,
) {
  const request = terminalCatalogRequestSchema.parse(raw);
  const workspace = resolveTerminalPreparationContext(
    trusted,
    request.workspaceId,
    request.featureId,
  );
  const providers = localCliProviders.map((provider) => {
    const executables = discoverTerminalExecutable(
      provider,
      context.environment.PATH ?? '',
      context.home,
    );
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
      return { provider, executables: [], models: null };
    }
    // Discovery preserves launcher PATH order. Authorization verifies this candidate later.
    const executable = executables[0] ?? null;
    const identity = JSON.stringify([
      provider,
      executable,
      executable ? terminalExecutableSha256(executable) : null,
      context.home,
      context.environment.PATH ?? '',
      // Only native selectors consumed by this provider, never credential variables.
      ...(provider === 'codex'
        ? [context.environment.CODEX_HOME ?? null]
        : provider === 'claude'
          ? [context.environment.CLAUDE_CONFIG_DIR ?? null]
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
    return { provider, executables, models, identity };
  });
  const catalogId = terminalDigest(
    JSON.stringify([
      trusted.observerDatabase,
      trusted.preferencesDirectory,
      workspace.fence,
      workspace.feature?.revision ?? null,
    ]),
  );
  const catalog = terminalPreparationCatalogSchema.parse({
    contractVersion: 1,
    workspaceId: request.workspaceId,
    featureId: request.featureId,
    catalogId,
    providers: providers.map(({ provider, executables, models }) => ({
      provider,
      status: executables.length > 0 && models ? 'available' : 'unavailable',
      reason: !models
        ? 'catalog_limited'
        : !executables.length
          ? 'executable_not_found'
          : models.limited
            ? 'catalog_limited'
            : 'ready',
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
  return { catalog, providers, workspace };
}

/** An opaque 64-hex choice: original deadline + 208-bit evidence digest, no public paths. */
function selectionId(identity: string, label: string, selection: TerminalModelSelection) {
  const expiry = (selection.expiresAt ?? 0).toString(16).padStart(12, '0');
  return expiry + terminalDigest(JSON.stringify([identity, label, selection])).slice(0, 52);
}

/** Rebind only an unchanged choice; refreshing a cache cannot extend the selected deadline. */
export function resolveCatalogSelection(
  discovered: ReturnType<typeof terminalPreparationCatalog>,
  name: LocalCliProvider,
  id: string,
) {
  const provider = discovered.providers.find((entry) => entry.provider === name);
  if (!provider?.identity || !provider.executables.length) return undefined;
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
      return { provider: name, executable: provider.executables[0]!, model: selection };
  }
  return undefined;
}
