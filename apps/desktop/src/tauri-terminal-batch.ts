import {
  DEFAULT_FEATURE_NAME,
  type TerminalBatchItem,
  type TerminalBatchRequest,
  type TerminalLayoutRecord,
} from '@orqst/protocol';
import {
  resolveTerminalPreparationContext,
  terminalPreparationBindingSchema,
  type TerminalPreparationContext,
} from '../../../packages/core/src/terminal/preparation-context.js';
import {
  validateTerminalModelSelection,
  type TerminalModelSelection,
} from '../../../packages/core/src/terminal/model-selection.js';
import { inspectManagedTerminalFiles } from '../../../packages/core/src/terminal/managed-files.js';
import { prepareTerminalCreation, type TerminalCreationInput } from './terminal-creation.js';
import {
  inspectTerminalPreparationCatalog,
  resolveCatalogSelection,
  terminalCatalogId,
} from './terminal-catalog.js';
import { acceptCliCandidate } from './terminal-discovery.js';
import type { TauriPreparationPorts } from './tauri-terminal-preparation.js';

type Prepared = Omit<TerminalBatchItem, 'status'> & {
  status: 'prepared' | 'refused' | 'unknown';
  file?: string;
  name?: string;
};

/** The bound Studio Open gesture authorizes one-shot provisioning. No runtime is started here. */
export async function prepareTauriBatch(
  request: TerminalBatchRequest,
  context: Pick<TerminalCreationInput, 'parent' | 'home' | 'node' | 'environment'>,
  ports: TauriPreparationPorts,
  trusted: TerminalPreparationContext,
  availableSlots: number,
  current: () => boolean,
  preflight: () => void,
  now: () => number,
  unsupportedOpenCode: boolean,
): Promise<{ status: 'batch'; items: Prepared[]; previousLayout: TerminalLayoutRecord | null }> {
  const items: Prepared[] = request.requests.map(({ id }) => ({
    id,
    status: 'refused',
    reason: 'not_attempted',
    effects: 'not_started',
  }));
  const result = (previousLayout: TerminalLayoutRecord | null = null) => ({
    status: 'batch' as const,
    items,
    previousLayout,
  });
  const scope = {
    action: 'catalog',
    workspaceId: request.workspaceId,
    featureId: request.featureId,
  };
  const discovered = inspectTerminalPreparationCatalog(
    scope,
    trusted,
    context,
    request.requests.map(({ provider }) => provider),
  );
  if (discovered.catalogId !== request.catalogId) {
    for (const item of items) item.reason = 'catalog_changed';
    return result();
  }
  const binding = terminalPreparationBindingSchema.parse({
    ...trusted,
    workspaceId: request.workspaceId,
    featureId: request.featureId,
    fence: discovered.workspace.fence,
  });
  const selectedModels = new Map<string, TerminalModelSelection>();
  const plans: Array<{
    index: number;
    provider: TerminalBatchRequest['requests'][number]['provider'];
    modelId: string;
    plan?: ReturnType<typeof prepareTerminalCreation>;
    input: TerminalCreationInput;
    candidate: NonNullable<ReturnType<typeof resolveCatalogSelection>>['candidate'];
  }> = [];
  const defaultFeatureTitle = context.environment.LANG?.toLowerCase().startsWith('pt')
    ? 'Geral'
    : DEFAULT_FEATURE_NAME;
  const existingCount = discovered.workspace.target?.terminalIds.length ?? 0;
  const capacity = Math.min(availableSlots, 8 - existingCount);
  for (const [index, input] of request.requests.entries()) {
    const item = items[index]!;
    if (unsupportedOpenCode && input.provider === 'opencode') {
      item.reason = 'selection_unavailable';
      continue;
    }
    if (input.workspaceId !== request.workspaceId) {
      item.reason = 'workspace_unsupported';
      continue;
    }
    if (input.accountId != null) {
      item.reason = 'account_unsupported';
      continue;
    }
    if (plans.length >= capacity) {
      item.reason = 'capacity_exceeded';
      continue;
    }
    const defaults =
      discovered.providers
        .find((entry) => entry.provider === input.provider)
        ?.models?.options.filter((entry) => entry.selection.value === null) ?? [];
    const modelId = input.modelId ?? (defaults.length === 1 ? defaults[0]!.id : undefined);
    const selected =
      modelId === undefined
        ? undefined
        : resolveCatalogSelection(discovered, input.provider, modelId);
    if (!selected) {
      item.reason =
        discovered.providers.find(({ provider }) => provider === input.provider)?.candidate
          ?.decision === 'review'
          ? 'cli_review_required'
          : 'selection_unavailable';
      continue;
    }
    try {
      const supportsHub = input.provider !== 'antigravity';
      const creationInput: TerminalCreationInput = {
        ...context,
        ...selected,
        count: 1,
        limit: 8,
        project: discovered.workspace.project,
        preparation: binding,
        // MCP-capable terminals talk through the Feature-scoped hub; Antigravity has no per-session MCP.
        mcp: supportsHub,
        ...(supportsHub ? { hub: true } : {}),
        ...(input.provider === 'opencode' ? { openCodeStartupAuthorized: true } : {}),
      };
      const plan =
        selected.candidate?.decision === 'automatic'
          ? undefined
          : prepareTerminalCreation(creationInput);
      plans.push({
        index,
        provider: input.provider,
        modelId: modelId!,
        plan,
        input: creationInput,
        candidate: selected.candidate,
      });
      selectedModels.set(modelId!, selected.model);
    } catch {
      item.reason = 'preparation_failed';
    }
  }
  const expires = now() + 60_000;
  const reviewed = () => current() && now() < expires;
  let activeFeatureId = request.featureId;
  let expectedCatalogId = request.catalogId;
  const revalidateScope = () => {
    if (!reviewed()) throw new Error('Batch context changed');
    const workspace = resolveTerminalPreparationContext(
      trusted,
      request.workspaceId,
      activeFeatureId,
    );
    if (terminalCatalogId(trusted, workspace) !== expectedCatalogId)
      throw new Error('Batch context changed');
    preflight();
    for (const model of selectedModels.values()) validateTerminalModelSelection(model);
    return workspace;
  };
  if (!plans.length) return result();
  try {
    revalidateScope();
    if (!(await ports.commit()) || !reviewed()) {
      for (const { index } of plans) items[index]!.reason = 'context_changed';
      return result();
    }
    const fresh = inspectTerminalPreparationCatalog(
      { action: 'catalog', workspaceId: request.workspaceId, featureId: activeFeatureId },
      trusted,
      context,
      plans.map(({ provider }) => provider),
    );
    if (
      fresh.catalogId !== expectedCatalogId ||
      plans.some(({ provider, modelId }) => !resolveCatalogSelection(fresh, provider, modelId))
    ) {
      for (const { index, provider } of plans)
        items[index]!.reason =
          fresh.providers.find((entry) => entry.provider === provider)?.candidate?.decision ===
          'review'
            ? 'cli_review_required'
            : 'catalog_changed';
      return result();
    }
  } catch {
    for (const { index } of plans) items[index]!.reason = 'context_changed';
    return result();
  }
  let previousLayout: TerminalLayoutRecord | null = null;
  let capturedLayout = false;
  const verifiedExecutables = new Set<string>();
  const reviewedCandidates = new Map<string, string | undefined>();
  for (const { index, plan, candidate, input } of plans) {
    const item = items[index]!;
    try {
      // Provision rechecks this plan's exact model, executable and directory
      // evidence. The only catalog-wide change here is our own assignment.
      revalidateScope();
      if (
        (candidate && !candidate.previous && candidate.decision === 'exact') ||
        candidate?.decision === 'automatic'
      ) {
        if (!reviewedCandidates.has(candidate.path)) {
          const accepted = await acceptCliCandidate(
            candidate,
            trusted.preferencesDirectory,
            reviewed,
            async () => {
              if (!((await ports.check?.()) ?? true)) return false;
              revalidateScope();
              return true;
            },
          );
          reviewedCandidates.set(
            candidate.path,
            accepted?.source === 'signature_continuity' ? accepted.version : undefined,
          );
        }
      }
      const workspace = revalidateScope();
      const preparedPlan = plan ?? prepareTerminalCreation(input);
      item.effects = 'possible';
      const files = preparedPlan.provision(
        reviewed,
        (terminalIds) => {
          if (!reviewed()) throw new Error('Batch context changed');
          const assigned = discovered.workspace.features.assignToOpenOrDefault(
            activeFeatureId,
            terminalIds,
            defaultFeatureTitle,
            {
              viewRevision: workspace.view.revision,
              featureRevision: workspace.target?.revision ?? null,
            },
          );
          if (!capturedLayout) {
            previousLayout = assigned.previousLayout;
            capturedLayout = true;
          }
          const resolved = resolveTerminalPreparationContext(
            trusted,
            request.workspaceId,
            assigned.feature.featureId,
          );
          if (
            resolved.project !== workspace.project ||
            resolved.view.revision !== assigned.view.revision ||
            resolved.target?.revision !== assigned.feature.revision
          )
            throw new Error('Batch context changed during assignment');
          activeFeatureId = assigned.feature.featureId;
          expectedCatalogId = terminalCatalogId(trusted, resolved);
          return terminalPreparationBindingSchema.parse({
            ...trusted,
            workspaceId: request.workspaceId,
            featureId: assigned.feature.featureId,
            fence: resolved.fence,
          });
        },
        verifiedExecutables,
      );
      const inspected = inspectManagedTerminalFiles(files, 8);
      const member = inspected[0];
      if (files.length !== 1 || !member || member.blocker || !member.config.identity)
        throw new Error('Batch member unavailable');
      item.terminalId = member.config.identity.terminalId;
      item.file = files[0]!;
      item.name = request.requests[index]!.name;
      const verifiedUpdate = candidate && reviewedCandidates.get(candidate.path);
      if (verifiedUpdate) item.verifiedUpdate = verifiedUpdate;
      item.status = 'prepared';
      item.reason = 'not_attempted'; // Core admission has not happened yet.
    } catch {
      item.status = item.effects === 'possible' ? 'unknown' : 'refused';
      item.reason = item.effects === 'possible' ? 'preparation_failed' : 'context_changed';
      break;
    }
  }
  return result(previousLayout);
}
