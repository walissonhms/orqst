import {
  terminalPreparationFailureSchema,
  type TerminalPreparationFailure,
  terminalCatalogRequestSchema,
  terminalSelectedRequestSchema,
  type TerminalPreparationCatalog,
  type TerminalLayoutRecord,
} from '@orqst/protocol';
import { inspectManagedTerminalFiles } from '../../../packages/core/src/terminal/managed-files.js';
import {
  terminalPreparationBindingSchema,
  type TerminalPreparationContext,
} from '../../../packages/core/src/terminal/preparation-context.js';
import { terminalPreparationCatalog } from './terminal-catalog.js';
import { z } from 'zod';
import { prepareTerminalCreation, type TerminalCreationInput } from './terminal-creation.js';
import { TerminalSelection } from './terminal-selection.js';

export const tauriPreparationSchema = z.discriminatedUnion('action', [
  terminalCatalogRequestSchema,
  terminalSelectedRequestSchema,
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
  confirm(key: 'create' | 'acknowledge' | 'open' | 'selected', detail: string): Promise<boolean>;
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
): Promise<
  | {
      status: 'cancelled' | 'prepared' | 'open';
      files: string[];
      previousLayout?: TerminalLayoutRecord;
    }
  | { status: 'catalog'; catalog: TerminalPreparationCatalog }
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
    let files: string[];
    if (!current()) return { status: 'cancelled', files: [] };
    if (request.action === 'catalog' || request.action === 'create-selected') {
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
      if (request.action === 'catalog') return { status: 'catalog', catalog: discovered.catalog };
      if (request.catalogId !== discovered.catalog.catalogId) fail('catalog_changed');
      stage = 'selection';
      const provider = discovered.providers.find((entry) => entry.provider === request.provider);
      const selected = provider?.models?.options.find((entry) => entry.id === request.modelId);
      if (!provider || provider.executables.length !== 1 || !selected)
        throw new TauriPreparationError({ stage, code: 'selection_unavailable', effects });
      if ((discovered.workspace.feature?.terminalIds.length ?? 0) + request.count > 8)
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
        provider: request.provider,
        count: request.count,
        limit: 8,
        executable: provider.executables[0]!,
        project: discovered.workspace.project,
        model: selected.selection,
        preparation,
        mcp: false,
        ...(request.provider === 'opencode' ? { openCodeStartupAuthorized: true } : {}),
      });
      // One exact native selection review includes shared-state/provider startup acknowledgement.
      // Runtime execution remains a separate signed native Open operation.
      if (plan.pages.length !== 1) fail('review_too_large');
      stage = 'review';
      const expires = now() + 60_000;
      const reviewed = () => current() && now() < expires;
      if (!(await ports.confirm('selected', plan.pages[0]!)) || !reviewed())
        return { status: 'cancelled', files: [] };
      stage = 'revalidation';
      const rechecked = terminalPreparationCatalog(
        { action: 'catalog', workspaceId: request.workspaceId, featureId: request.featureId },
        trusted,
        context,
      );
      if (rechecked.catalog.catalogId !== request.catalogId) fail('catalog_changed');
      stage = 'commit';
      if (!(await ports.commit()) || !reviewed()) return { status: 'cancelled', files: [] };
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
      stage = 'commit';
      if (!(await ports.commit()) || !reviewed()) return { status: 'cancelled', files: [] };
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
