import { terminalPreparationCatalogSchema, terminalCatalogRequestSchema } from '@orqst/protocol';
import { terminalDigest } from '../../../packages/core/src/terminal/authority.js';
import {
  resolveTerminalPreparationContext,
  type TerminalPreparationContext,
} from '../../../packages/core/src/terminal/preparation-context.js';
import { discoverTerminalModels } from '../../../packages/core/src/terminal/model-selection.js';
import { localCliProviders } from '../../../packages/core/src/terminal/local-cli.js';
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
    return { provider, executables, models };
  });
  const catalogId = terminalDigest(
    JSON.stringify([workspace.fence, workspace.feature?.revision ?? null, providers]),
  );
  const catalog = terminalPreparationCatalogSchema.parse({
    contractVersion: 1,
    workspaceId: request.workspaceId,
    featureId: request.featureId,
    catalogId,
    providers: providers.map(({ provider, executables, models }) => ({
      provider,
      status: executables.length === 1 && models ? 'available' : 'unavailable',
      reason: !models
        ? 'catalog_limited'
        : !executables.length
          ? 'executable_not_found'
          : executables.length > 1
            ? 'ambiguous_executable'
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
