import {
  terminalCatalogRequestSchema,
  terminalSelectedRequestSchema,
  type TerminalPreparationCatalog,
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

/** Reuse the existing passive provisioning and full selection review; never start a CLI. */
export async function prepareTauriTerminals(
  raw: unknown,
  context: Pick<TerminalCreationInput, 'parent' | 'home' | 'node' | 'environment'>,
  ports: TauriPreparationPorts,
  now: () => number = Date.now,
  trusted?: TerminalPreparationContext,
): Promise<
  | { status: 'cancelled' | 'prepared' | 'open'; files: string[] }
  | { status: 'catalog'; catalog: TerminalPreparationCatalog }
> {
  const request = tauriPreparationSchema.parse(raw);
  const expires = now() + 300_000;
  const current = () => now() < expires && ports.current();
  let files: string[];
  if (!current()) return { status: 'cancelled', files: [] };
  if (request.action === 'catalog' || request.action === 'create-selected') {
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
    if (request.catalogId !== discovered.catalog.catalogId)
      throw new Error('Terminal catalogue changed; reload the picker');
    const provider = discovered.providers.find((entry) => entry.provider === request.provider);
    const selected = provider?.models?.options.find((entry) => entry.id === request.modelId);
    if (!provider || provider.executables.length !== 1 || !selected)
      throw new Error('Selected CLI or model unavailable; reload the picker');
    if ((discovered.workspace.feature?.terminalIds.length ?? 0) + request.count > 8)
      throw new Error('Feature terminal capacity exceeded');
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
    if (plan.pages.length !== 1)
      throw new Error('Selection exceeds one native review; reduce terminal count');
    const expires = now() + 60_000;
    const reviewed = () => current() && now() < expires;
    if (!(await ports.confirm('selected', plan.pages[0]!)) || !reviewed())
      return { status: 'cancelled', files: [] };
    const rechecked = terminalPreparationCatalog(
      { action: 'catalog', workspaceId: request.workspaceId, featureId: request.featureId },
      trusted,
      context,
    );
    if (rechecked.catalog.catalogId !== request.catalogId)
      throw new Error('Terminal selection changed during review');
    if (!(await ports.commit()) || !reviewed()) return { status: 'cancelled', files: [] };
    files = plan.provision(reviewed);
    const selection = inspectManagedTerminalFiles(files, 8);
    if (selection.some((entry) => entry.blocker)) throw new Error('Prepared selection blocked');
    if (request.featureId !== null) {
      let feature = discovered.workspace.features.read(request.featureId);
      for (const member of selection) {
        if (!reviewed()) throw new Error('Feature enrollment expired');
        feature = discovered.workspace.features.assignTerminal(
          request.featureId,
          member.config.identity!.terminalId,
          feature.revision,
        );
      }
    }
    return { status: 'open', files };
  }
  if (request.action === 'create') {
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
    const reviewExpires = now() + 60_000;
    const reviewed = () => current() && now() < reviewExpires;
    for (const page of plan.pages) {
      if (!reviewed() || !(await ports.confirm('create', page)) || !reviewed())
        return { status: 'cancelled', files: [] };
    }
    if (!(await ports.confirm('acknowledge', '')) || !reviewed())
      return { status: 'cancelled', files: [] };
    if (!(await ports.commit()) || !reviewed()) return { status: 'cancelled', files: [] };
    files = plan.provision(reviewed);
  } else files = request.files;

  // Selection is a second transaction. Cancelling it preserves the completed manifests.
  const selection = new TerminalSelection(now, 8);
  const result = await selection.review({
    current,
    choose: async () => files,
    confirm: (page) => ports.confirm('open', page),
  });
  return result === 'reviewed'
    ? { status: 'open', files: selection.take() }
    : { status: 'prepared', files };
}
