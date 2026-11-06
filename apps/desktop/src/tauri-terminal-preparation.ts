import { inspectPendingOwnedExits } from '../../../packages/core/src/terminal/exit-pending.js';
import {
  terminalPreparationFailureSchema,
  type TerminalPreparationFailure,
  terminalCatalogRequestSchema,
  terminalSelectedRequestSchema,
  terminalMcpPairRequestSchema,
  terminalMcpPairMembers,
  terminalMcpPairModelId,
  terminalBatchRequestSchema,
  type TerminalPreparationCatalog,
  type TerminalLayoutRecord,
} from '@orqst/protocol';
import { inspectManagedTerminalFiles } from '../../../packages/core/src/terminal/managed-files.js';
import {
  terminalPreparationBindingSchema,
  type TerminalPreparationContext,
} from '../../../packages/core/src/terminal/preparation-context.js';
import { terminalPreparationCatalog, resolveCatalogSelection } from './terminal-catalog.js';
import { z } from 'zod';
import {
  prepareTerminalCreation,
  type TerminalCreationInput,
  type TerminalCreationOverview,
} from './terminal-creation.js';
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
    key: 'create' | 'acknowledge' | 'open' | 'selected' | 'mcpPair',
    detail: string,
    overview?: TerminalCreationOverview,
  ): Promise<boolean>;
  /** Native latch precedes the first possible write, including an uncertain partial write. */
  commit(): Promise<boolean>;
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
      const discovered = terminalPreparationCatalog(
        {
          action: 'catalog',
          workspaceId: request.workspaceId,
          featureId: request.featureId,
        },
        trusted,
        context,
      );
      if (request.action === 'catalog')
        return {
          status: 'catalog',
          catalog: {
            ...discovered.catalog,
            pendingOwnedExits: inspectPendingOwnedExits(trusted.preferencesDirectory),
          },
        };
      if (request.catalogId !== discovered.catalog.catalogId) fail('catalog_changed');
      stage = 'selection';
      const pair = request.action === 'create-mcp-pair';
      const count = pair ? 2 : request.count;
      const sourceProvider = pair ? request.sourceProvider : request.provider;
      const select = (name: typeof sourceProvider, modelId: string | undefined) => {
        const selected =
          modelId === undefined ? undefined : resolveCatalogSelection(discovered, name, modelId);
        if (!selected) return fail('selection_unavailable');
        return selected;
      };
      const members = pair ? terminalMcpPairMembers(request) : null;
      if (pair && !members) fail('selection_unavailable');
      const source = select(
        sourceProvider,
        pair ? terminalMcpPairModelId(request, sourceProvider) : request.modelId,
      );
      const companion =
        pair && members
          ? select(members[1], terminalMcpPairModelId(request, members[1]))
          : undefined;
      if ((discovered.workspace.feature?.terminalIds.length ?? 0) + count > 8)
        fail('capacity_exceeded');
      stage = 'plan';
      const preparation = terminalPreparationBindingSchema.parse({
        ...trusted,
        workspaceId: request.workspaceId,
        featureId: request.featureId,
        fence: discovered.workspace.fence,
      });
      const plan = prepareTerminalCreation({
        ...context,
        ...source,
        ...(companion ? { companion } : {}),
        count,
        limit: 8,
        project: discovered.workspace.project,
        preparation,
        // Every terminal talks through the Feature-scoped hub; the pair keeps its own MCP.
        mcp: true,
        ...(pair ? {} : { hub: true }),
        ...((members ?? [sourceProvider]).includes('opencode')
          ? { openCodeStartupAuthorized: true }
          : {}),
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
        const rechecked = terminalPreparationCatalog(
          { action: 'catalog', workspaceId: request.workspaceId, featureId: request.featureId },
          trusted,
          context,
        );
        const still = (provider: typeof sourceProvider, modelId: string | undefined) =>
          modelId !== undefined && !!resolveCatalogSelection(rechecked, provider, modelId);
        if (
          rechecked.catalog.catalogId !== request.catalogId ||
          !still(
            sourceProvider,
            pair ? terminalMcpPairModelId(request, sourceProvider) : request.modelId,
          ) ||
          (pair && (!members || !still(members[1], terminalMcpPairModelId(request, members[1]))))
        )
          fail('catalog_changed');
      };
      revalidate();
      preflight();
      stage = 'commit';
      if (!(await ports.commit()) || !reviewed()) return { status: 'cancelled', files: [] };
      stage = 'revalidation';
      revalidate();
      preflight();
      stage = 'provision';
      effects = 'possible'; // Entering provision may leave partial files; never infer rollback.
      files = plan.provision(reviewed);
      stage = 'inspection';
      const selection = inspectManagedTerminalFiles(files, 8);
      if (selection.some((entry) => entry.blocker)) fail('selection_blocked');
      let previousLayout: TerminalLayoutRecord | null = null;
      if (request.featureId !== null) {
        stage = 'feature_assignment';
        let feature = discovered.workspace.features.read(request.featureId);
        previousLayout = discovered.workspace.features.readLayout(request.featureId);
        for (const member of selection) {
          if (!reviewed()) throw new Error('Feature enrollment expired');
          feature = discovered.workspace.features.assignTerminal(
            request.featureId,
            member.config.identity!.terminalId,
            feature.revision,
          );
        }
      }
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
