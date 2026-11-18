import { inspectPendingOwnedExits } from '../../../packages/core/src/terminal/exit-pending.js';
import {
  DEFAULT_FEATURE_NAME,
  terminalPreparationFailureSchema,
  type TerminalPreparationFailure,
  terminalCatalogRequestSchema,
  terminalCliReviewRequestSchema,
  terminalSelectedRequestSchema,
  terminalMcpPairRequestSchema,
  terminalMcpPairMembers,
  terminalMcpPairModelId,
  terminalBatchRequestSchema,
  type TerminalPreparationCatalog,
  type TerminalLayoutRecord,
} from '@orqst/protocol';
import { stableId } from '@orqst/shared';
import { inspectManagedTerminalFiles } from '../../../packages/core/src/terminal/managed-files.js';
import { featureConfigurationDatabase } from '../../../packages/core/src/terminal/feature-configuration.js';
import {
  resolveTerminalPreparationContext,
  terminalPreparationBindingSchema,
  type TerminalPreparationContext,
} from '../../../packages/core/src/terminal/preparation-context.js';
import {
  cliReviewId,
  inspectTerminalPreparationCatalog,
  resolveCatalogSelection,
  terminalPreparationCatalog,
} from './terminal-catalog.js';
import { z } from 'zod';
import {
  prepareTerminalCreation,
  type TerminalCreationInput,
  type TerminalCreationOverview,
} from './terminal-creation.js';
import { acceptCliCandidate } from './terminal-discovery.js';
import { TerminalSelection } from './terminal-selection.js';
import { prepareTauriBatch } from './tauri-terminal-batch.js';
import { join } from 'node:path';
import {
  inspectDesktopAdmission,
  DesktopAdmissionRefused,
  type DesktopAdmissionContext,
} from '../../../packages/core/src/managed-codex/desktop-admission-inspection.js';

export const tauriPreparationSchema = z.discriminatedUnion('action', [
  terminalCatalogRequestSchema,
  terminalCliReviewRequestSchema,
  terminalSelectedRequestSchema,
  terminalMcpPairRequestSchema,
  terminalBatchRequestSchema,
  z.strictObject({
    action: z.literal('create'),
    provider: z.enum(['codex', 'claude']),
    count: z.number().int().min(1).max(8),
  }),
  z.strictObject({
    action: z.literal('review'),
    files: z.array(z.string().min(1).max(2048)).min(1).max(8),
  }),
]);

export interface TauriPreparationPorts {
  current(): boolean;
  choose(directory: boolean): Promise<string | undefined>;
  confirm(
    key: 'create' | 'acknowledge' | 'open' | 'selected' | 'mcpPair' | 'cliUpdate',
    detail: string,
    overview?: TerminalCreationOverview,
  ): Promise<boolean>;
  /** Native latch precedes the first possible write, including an uncertain partial write. */
  commit(): Promise<boolean>;
  check?(): Promise<boolean>;
}

export class TauriPreparationError extends Error {
  constructor(readonly failure: TerminalPreparationFailure) {
    super(`Terminal preparation ${failure.stage}: ${failure.code}`);
  }
}

/** Unknown host/transport errors cannot establish that an attempt had no effects. */
export function tauriPreparationFailure(error: unknown): TerminalPreparationFailure {
  if (error instanceof TauriPreparationError) {
    const parsed = terminalPreparationFailureSchema.safeParse(error.failure);
    if (parsed.success) return parsed.data;
  }
  return { stage: 'bootstrap', code: 'failed', effects: 'possible' };
}

/** Reuse the existing passive provisioning and full selection review; never start a CLI. */
export async function prepareTauriTerminals(
  raw: unknown,
  context: Pick<TerminalCreationInput, 'parent' | 'home' | 'node' | 'environment'>,
  ports: TauriPreparationPorts,
  now: () => number = Date.now,
  trusted?: TerminalPreparationContext,
  currentCore?: DesktopAdmissionContext,
  availableSlots = 8,
  unsupportedOpenCode = false,
): Promise<
  | {
      status: 'cancelled' | 'prepared' | 'open';
      files: string[];
      previousLayout?: TerminalLayoutRecord;
    }
  | { status: 'catalog'; catalog: TerminalPreparationCatalog }
  | Awaited<ReturnType<typeof prepareTauriBatch>>
> {
  let stage: TerminalPreparationFailure['stage'] = 'request';
  let effects: TerminalPreparationFailure['effects'] = 'not_started';
  const fail = (code: TerminalPreparationFailure['code']): never => {
    throw new TauriPreparationError({ stage, code, effects });
  };
  try {
    const request = tauriPreparationSchema.parse(raw);
    const expires = now() + 300_000;
    const current = () => now() < expires && ports.current();
    let admissionFence: string | undefined;
    const preflight = () => {
      stage = 'admission_preflight';
      try {
        const fence = inspectDesktopAdmission(
          trusted?.preferencesDirectory ?? join(context.parent, 'managed-agents'),
          currentCore,
        );
        if (admissionFence !== undefined && fence !== admissionFence) fail('admission_invalid');
        admissionFence = fence;
      } catch (error) {
        if (error instanceof DesktopAdmissionRefused) fail(error.code);
        throw error;
      }
    };
    let files: string[];
    if (!current()) return { status: 'cancelled', files: [] };
    if (request.action !== 'catalog') preflight();
    if (request.action === 'review-cli') {
      if (!trusted) return fail('failed');
      const inspect = () =>
        inspectTerminalPreparationCatalog(
          {
            action: 'catalog',
            workspaceId: request.workspaceId,
            featureId: request.featureId,
          },
          trusted,
          context,
          [request.provider],
        );
      const first = inspect();
      const candidate = first.providers[0]?.candidate;
      if (
        first.catalogId !== request.catalogId ||
        candidate?.decision !== 'review' ||
        request.reviewId !== cliReviewId(candidate)
      )
        return fail('catalog_changed');
      const detail = JSON.stringify({
        provider: candidate.provider,
        executable: candidate.path,
        sha256: candidate.sha256,
        previous: candidate.previous && {
          path: candidate.previous.path,
          sha256: candidate.previous.sha256,
        },
      }).replace(/\p{Cf}/gu, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`);
      if (detail.length > 4096) return fail('review_too_large');
      const stillSelected = () => {
        const latest = inspect();
        const next = latest.providers[0]?.candidate;
        return (
          latest.catalogId === request.catalogId &&
          next?.decision === 'review' &&
          cliReviewId(next) === request.reviewId
        );
      };
      stage = 'review';
      const deadline = now() + 60_000;
      const live = () => current() && now() < deadline;
      if (!(await ports.confirm('cliUpdate', detail)) || !live())
        return { status: 'cancelled', files: [] };
      if (!stillSelected()) return fail('catalog_changed');
      preflight();
      stage = 'commit';
      if (!(await ports.commit()) || !live()) return { status: 'cancelled', files: [] };
      effects = 'possible';
      stage = 'revalidation';
      if (!stillSelected()) return fail('catalog_changed');
      await acceptCliCandidate(
        candidate,
        trusted.preferencesDirectory,
        live,
        async () => ((await ports.check?.()) ?? true) && stillSelected(),
      );
      if (inspect().catalogId !== request.catalogId || !live()) return fail('catalog_changed');
      return { status: 'prepared', files: [] };
    }
    if (request.action === 'create-batch') {
      if (!trusted || !Number.isInteger(availableSlots) || availableSlots < 0 || availableSlots > 8)
        return fail('failed');
      return prepareTauriBatch(
        request,
        context,
        ports,
        trusted,
        availableSlots,
        current,
        preflight,
        now,
        unsupportedOpenCode,
      );
    }
    if (
      request.action === 'catalog' ||
      request.action === 'create-selected' ||
      request.action === 'create-mcp-pair'
    ) {
      stage = 'catalog';
      if (!trusted) throw new Error('Native workspace catalogue required');
      const scope = {
        action: 'catalog',
        workspaceId: request.workspaceId,
        featureId: request.featureId,
      };
      if (request.action === 'catalog')
        return {
          status: 'catalog',
          catalog: {
            ...terminalPreparationCatalog(scope, trusted, context, !currentCore),
            pendingOwnedExits: inspectPendingOwnedExits(trusted.preferencesDirectory),
          },
        };
      const pair = request.action === 'create-mcp-pair';
      const count = pair ? 2 : request.count;
      const sourceProvider = pair ? request.sourceProvider : request.provider;
      const members = pair ? terminalMcpPairMembers(request) : null;
      const providers = members ?? [sourceProvider];
      const inspect = () => inspectTerminalPreparationCatalog(scope, trusted, context, providers);
      const discovered = inspect();
      if (request.catalogId !== discovered.catalogId) fail('catalog_changed');
      stage = 'selection';
      if (pair && !members) fail('selection_unavailable');
      const select = (name: typeof sourceProvider, modelId: string | undefined) => {
        const selected =
          modelId === undefined ? undefined : resolveCatalogSelection(discovered, name, modelId);
        if (!selected) return fail('selection_unavailable');
        return selected;
      };
      const source = select(
        sourceProvider,
        pair ? terminalMcpPairModelId(request, request.sourceProvider) : request.modelId,
      );
      const companion =
        pair && members
          ? select(members[1], terminalMcpPairModelId(request, members[1]))
          : undefined;
      const defaultFeatureTitle = context.environment.LANG?.toLowerCase().startsWith('pt')
        ? 'Geral'
        : DEFAULT_FEATURE_NAME;
      const targetExisting = discovered.workspace.target?.terminalIds.length ?? 0;
      if (targetExisting + count > 8) fail('capacity_exceeded');
      stage = 'plan';
      const preparation = terminalPreparationBindingSchema.parse({
        ...trusted,
        workspaceId: request.workspaceId,
        featureId: request.featureId,
        fence: discovered.workspace.fence,
      });
      const supportsHub = !pair && sourceProvider !== 'antigravity';
      const candidates = [source.candidate, companion?.candidate];
      let committed = false;
      if (candidates.some((candidate) => candidate?.decision === 'automatic')) {
        stage = 'commit';
        preflight();
        if (!(await ports.commit()) || !current()) return { status: 'cancelled', files: [] };
        committed = true;
        effects = 'possible';
        for (const candidate of candidates)
          if (candidate?.decision === 'automatic')
            await acceptCliCandidate(
              candidate,
              trusted.preferencesDirectory,
              current,
              async () =>
                ((await ports.check?.()) ?? true) && inspect().catalogId === request.catalogId,
            );
      }
      const plan = prepareTerminalCreation({
        ...context,
        ...source,
        ...(companion ? { companion } : {}),
        count,
        limit: 8,
        project: discovered.workspace.project,
        preparation,
        // MCP-capable terminals talk through the Feature-scoped hub; the pair keeps its own MCP.
        mcp: pair || supportsHub,
        ...(supportsHub ? { hub: true } : {}),
        ...(providers.includes('opencode') ? { openCodeStartupAuthorized: true } : {}),
      });
      // Studio's focused, generation-bound Open gesture authorizes the exact selection.
      // MCP pairs retain their separate bilateral consent; ordinary creation has no sheet.
      if (!pair && plan.pages.length !== 1) fail('review_too_large');
      stage = 'review';
      const expires = now() + 60_000;
      const reviewed = () => current() && now() < expires;
      // The summary and optional complete review come from the same immutable pre-write plan.
      if (
        !reviewed() ||
        (pair && !(await ports.confirm('mcpPair', plan.detail, plan.overview))) ||
        !reviewed()
      )
        return { status: 'cancelled', files: [] };
      stage = 'revalidation';
      const revalidate = () => {
        const rechecked = inspect();
        const still = (provider: typeof sourceProvider, modelId: string | undefined) =>
          modelId !== undefined && !!resolveCatalogSelection(rechecked, provider, modelId);
        if (
          rechecked.catalogId !== request.catalogId ||
          !still(
            sourceProvider,
            pair ? terminalMcpPairModelId(request, request.sourceProvider) : request.modelId,
          ) ||
          (pair && (!members || !still(members[1], terminalMcpPairModelId(request, members[1]))))
        )
          fail('catalog_changed');
      };
      revalidate();
      preflight();
      stage = 'commit';
      if ((!committed && !(await ports.commit())) || !reviewed())
        return { status: 'cancelled', files: [] };
      stage = 'revalidation';
      revalidate();
      preflight();
      stage = 'provision';
      effects = 'possible';
      for (const candidate of candidates)
        if (candidate?.decision === 'exact' && !candidate.previous)
          await acceptCliCandidate(
            candidate,
            trusted.preferencesDirectory,
            reviewed,
            async () =>
              ((await ports.check?.()) ?? true) && inspect().catalogId === request.catalogId,
          ); // Entering provision may leave partial files; never infer rollback.
      let previousLayout: TerminalLayoutRecord | null = null;
      files = plan.provision(reviewed, (terminalIds) => {
        if (!reviewed()) throw new Error('Feature enrollment expired');
        stage = 'feature_assignment';
        const assigned = discovered.workspace.features.assignToOpenOrDefault(
          request.featureId,
          terminalIds,
          defaultFeatureTitle,
          {
            viewRevision: discovered.workspace.view.revision,
            featureRevision: discovered.workspace.target?.revision ?? null,
          },
        );
        previousLayout = assigned.previousLayout;
        const resolved = resolveTerminalPreparationContext(
          trusted,
          request.workspaceId,
          assigned.feature.featureId,
        );
        if (
          resolved.project !== discovered.workspace.project ||
          resolved.view.revision !== assigned.view.revision ||
          resolved.target?.revision !== assigned.feature.revision
        )
          throw new Error('Feature context changed during assignment');
        stage = 'provision';
        return terminalPreparationBindingSchema.parse({
          ...trusted,
          workspaceId: request.workspaceId,
          featureId: assigned.feature.featureId,
          fence: resolved.fence,
        });
      });
      stage = 'inspection';
      const selection = inspectManagedTerminalFiles(files, 8);
      if (selection.some((entry) => entry.blocker)) fail('selection_blocked');
      return { status: 'open', files, ...(previousLayout ? { previousLayout } : {}) };
    }
    if (request.action === 'create') {
      stage = 'plan';
      const executable = await ports.choose(false);
      if (!current() || !executable) return { status: 'cancelled', files: [] };
      const project = await ports.choose(true);
      if (!current() || !project) return { status: 'cancelled', files: [] };
      const plan = prepareTerminalCreation({
        ...context,
        provider: request.provider,
        count: request.count,
        limit: 8,
        executable,
        project,
        mcp: false,
      });
      stage = 'review';
      const reviewExpires = now() + 60_000;
      const reviewed = () => current() && now() < reviewExpires;
      for (const page of plan.pages) {
        if (!reviewed() || !(await ports.confirm('create', page)) || !reviewed())
          return { status: 'cancelled', files: [] };
      }
      if (!(await ports.confirm('acknowledge', '')) || !reviewed())
        return { status: 'cancelled', files: [] };
      preflight();
      stage = 'commit';
      if (!(await ports.commit()) || !reviewed()) return { status: 'cancelled', files: [] };
      preflight();
      stage = 'provision';
      effects = 'possible'; // Entering provision may leave partial files; never infer rollback.
      files = plan.provision(reviewed);
      if (trusted) {
        stage = 'inspection';
        const selection = inspectManagedTerminalFiles(files, 8);
        if (selection.some((entry) => entry.blocker)) fail('selection_blocked');
        stage = 'feature_assignment';
        const workspaceId = stableId('workspace', project);
        const features = featureConfigurationDatabase(trusted.preferencesDirectory, workspaceId);
        const view = features.readView();
        const openFeature = view.featureId !== null ? features.read(view.featureId) : null;
        features.assignToOpenOrDefault(
          openFeature && openFeature.status !== 'archived' ? view.featureId : null,
          selection.map((entry) => entry.config.identity!.terminalId),
          context.environment.LANG?.toLowerCase().startsWith('pt') ? 'Geral' : DEFAULT_FEATURE_NAME,
        );
      }
    } else files = request.files;

    // Selection is a second transaction. Cancelling it preserves the completed manifests.
    stage = 'review';
    if (request.action === 'review') effects = 'possible'; // Existing files carry no fresh no-effect proof.
    const selection = new TerminalSelection(now, 8);
    const result = await selection.review({
      current,
      choose: async () => files,
      confirm: (page) => ports.confirm('open', page),
    });
    return result === 'reviewed'
      ? { status: 'open', files: selection.take() }
      : { status: 'prepared', files };
  } catch (error) {
    if (error instanceof TauriPreparationError) throw error;
    throw new TauriPreparationError({ stage, code: 'failed', effects });
  }
}
