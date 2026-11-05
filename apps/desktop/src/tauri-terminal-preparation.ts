import { inspectPendingOwnedExits } from '../../../packages/core/src/terminal/exit-pending.js';
import {
  terminalPreparationFailureSchema,
  type TerminalPreparationFailure,
  terminalCatalogRequestSchema,
  terminalSelectedRequestSchema,
  terminalMcpPairRequestSchema,
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
import type { V2CliBinding } from '../../../packages/core/src/terminal/cli-binding.js';
import type { TerminalCliAuthorizationState } from '../../../packages/core/src/terminal/cli-authorization.js';
import type {
  CliContractMode,
  CliContractProvider,
} from '../../../packages/core/src/terminal/cli-contract.js';

export interface PreparationCliCandidate {
  provider: CliContractProvider;
  executable: string;
  mode: CliContractMode;
  project: string;
  alternatives?: readonly string[];
}
import {
  prepareTerminalCreation,
  type TerminalCreationInput,
  type TerminalCreationOverview,
} from './terminal-creation.js';
import { TerminalSelection } from './terminal-selection.js';
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
  authorizeCli(candidate: PreparationCliCandidate): Promise<{
    status: TerminalCliAuthorizationState | 'ineligible';
    version?: string;
    sha256?: string;
    binding?: V2CliBinding;
  }>;
  authorizeCliGroup?(candidates: readonly PreparationCliCandidate[]): Promise<
    readonly {
      status: TerminalCliAuthorizationState | 'ineligible';
      executable?: string;
      version?: string;
      sha256?: string;
      binding?: V2CliBinding;
    }[]
  >;
  current(): boolean;
  /** Recheck all signatures/bindings after native review and commit awaits. */
  revalidateCli(): Promise<boolean>;
  /** Synchronous binding continuity at each provisioning effect boundary. */
  cliBindingsCurrent(): boolean;
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
    const authorizeCandidates = async (candidates: PreparationCliCandidate[]) => {
      const evidence = new Map<
        string,
        { executable: string; version: string; sha256: string; binding?: V2CliBinding }
      >();
      if (ports.authorizeCliGroup) {
        const results = await ports.authorizeCliGroup(candidates);
        if (!current() || results.length !== candidates.length) return;
        for (let index = 0; index < candidates.length; index++) {
          const candidate = candidates[index]!;
          const result = results[index]!;
          if (result.status === 'blocked') return;
          if (result.status === 'stale') fail('cli_authorization_stale');
          if (
            result.status !== 'allowed' ||
            !result.executable ||
            !result.version ||
            !result.sha256 ||
            !(candidate.alternatives ?? [candidate.executable]).includes(result.executable)
          )
            return fail('selection_blocked');
          evidence.set(JSON.stringify([candidate.provider, candidate.executable, candidate.mode]), {
            executable: result.executable,
            version: result.version,
            sha256: result.sha256,
            ...(result.binding ? { binding: result.binding } : {}),
          });
        }
        return evidence;
      }
      if (candidates.length > 1) return fail('selection_blocked');
      for (const candidate of candidates) {
        const originalKey = JSON.stringify([
          candidate.provider,
          candidate.executable,
          candidate.mode,
        ]);
        if (evidence.has(originalKey)) continue;
        let accepted = false;
        for (const executable of candidate.alternatives ?? [candidate.executable]) {
          const authorized = await ports.authorizeCli({ ...candidate, executable });
          if (!current() || authorized.status === 'blocked') return;
          if (authorized.status === 'ineligible') continue;
          if (authorized.status === 'stale') fail('cli_authorization_stale');
          if (authorized.status !== 'allowed' || !authorized.version || !authorized.sha256)
            return fail('selection_blocked');
          evidence.set(originalKey, {
            executable,
            version: authorized.version,
            sha256: authorized.sha256,
            ...(authorized.binding ? { binding: authorized.binding } : {}),
          });
          accepted = true;
          break;
        }
        if (!accepted) return fail('selection_blocked');
      }
      return evidence;
    };
    const matchesPlan = (
      plan: ReturnType<typeof prepareTerminalCreation>,
      evidence: Map<string, { executable: string; version: string; sha256: string }>,
    ) => {
      for (const candidate of plan.cliCandidates) {
        const authorized = [...evidence.values()].find(
          (entry) => entry.executable === candidate.executable,
        );
        if (
          authorized?.version !== candidate.expectedVersion ||
          authorized.sha256 !== candidate.expectedSha256
        )
          fail('catalog_changed');
      }
    };
    let files: string[];
    if (!current()) return { status: 'cancelled', files: [] };
    if (request.action !== 'catalog') preflight();
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
      const select = (name: typeof sourceProvider, modelId: string) => {
        const selected = resolveCatalogSelection(discovered, name, modelId);
        if (!selected) return fail('selection_unavailable');
        return selected;
      };
      const source = select(
        sourceProvider,
        pair
          ? sourceProvider === 'codex'
            ? request.codexModelId
            : request.openCodeModelId
          : request.modelId,
      );
      const companion = pair
        ? sourceProvider === 'codex'
          ? select('opencode', request.openCodeModelId)
          : select('codex', request.codexModelId)
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
      const mode = pair ? ('mcp' as const) : ('tui' as const);
      const evidence = await authorizeCandidates(
        [source, ...(companion ? [companion] : [])].map(({ provider, executable }) => ({
          provider,
          executable,
          alternatives: (provider === source.provider ? source : companion)?.alternatives,
          mode,
          project: discovered.workspace.project,
        })),
      );
      if (!evidence) return { status: 'cancelled', files: [] };
      const plan = prepareTerminalCreation({
        ...context,
        cliEvidence: [...evidence.values()].flatMap((value) =>
          value.binding
            ? [
                {
                  executable: value.executable,
                  version: value.version,
                  sha256: value.sha256,
                  binding: value.binding,
                },
              ]
            : [],
        ),
        ...source,
        executable: evidence.get(JSON.stringify([source.provider, source.executable, mode]))!
          .executable,
        ...(companion
          ? {
              companion: {
                ...companion,
                executable: evidence.get(
                  JSON.stringify([companion.provider, companion.executable, mode]),
                )!.executable,
              },
            }
          : {}),
        count,
        limit: 8,
        project: discovered.workspace.project,
        preparation,
        mcp: pair,
        ...(pair || sourceProvider === 'opencode' ? { openCodeStartupAuthorized: true } : {}),
      });
      // One exact native selection review includes shared-state/provider startup acknowledgement.
      // Runtime execution remains a separate signed native Open operation.
      if (!pair && plan.pages.length !== 1) fail('review_too_large');
      stage = 'review';
      const expires = now() + 60_000;
      const reviewed = () => current() && now() < expires;
      // The summary and optional complete review come from the same immutable pre-write plan.
      if (
        !reviewed() ||
        !(await ports.confirm(pair ? 'mcpPair' : 'selected', plan.detail, plan.overview)) ||
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
        if (
          rechecked.catalog.catalogId !== request.catalogId ||
          !resolveCatalogSelection(
            rechecked,
            sourceProvider,
            pair
              ? sourceProvider === 'codex'
                ? request.codexModelId
                : request.openCodeModelId
              : request.modelId,
          ) ||
          (pair &&
            !resolveCatalogSelection(
              rechecked,
              sourceProvider === 'codex' ? 'opencode' : 'codex',
              sourceProvider === 'codex' ? request.openCodeModelId : request.codexModelId,
            ))
        )
          fail('catalog_changed');
      };
      revalidate();
      preflight();
      matchesPlan(plan, evidence);
      if (!reviewed()) return { status: 'cancelled', files: [] };
      stage = 'commit';
      if (!(await ports.commit()) || !reviewed()) return { status: 'cancelled', files: [] };
      stage = 'revalidation';
      if (!(await ports.revalidateCli())) fail('cli_authorization_stale');
      revalidate();
      preflight();
      if (!reviewed() || !ports.cliBindingsCurrent()) fail('cli_authorization_stale');
      stage = 'provision';
      effects = 'possible'; // Entering provision may leave partial files; never infer rollback.
      files = plan.provision(() => reviewed() && ports.cliBindingsCurrent());
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
      const evidence = await authorizeCandidates([
        { provider: request.provider, executable, mode: 'tui', project },
      ]);
      if (!evidence) return { status: 'cancelled', files: [] };
      const plan = prepareTerminalCreation({
        ...context,
        cliEvidence: [...evidence.values()].flatMap((value) =>
          value.binding
            ? [
                {
                  executable: value.executable,
                  version: value.version,
                  sha256: value.sha256,
                  binding: value.binding,
                },
              ]
            : [],
        ),
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
      matchesPlan(plan, evidence);
      if (!reviewed()) return { status: 'cancelled', files: [] };
      stage = 'commit';
      if (!(await ports.commit()) || !reviewed()) return { status: 'cancelled', files: [] };
      stage = 'revalidation';
      if (!(await ports.revalidateCli())) fail('cli_authorization_stale');
      preflight();
      if (!reviewed() || !ports.cliBindingsCurrent()) fail('cli_authorization_stale');
      stage = 'provision';
      effects = 'possible'; // Entering provision may leave partial files; never infer rollback.
      files = plan.provision(() => reviewed() && ports.cliBindingsCurrent());
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
    if (result === 'launch_unavailable') fail('selection_blocked');
    return result === 'reviewed'
      ? { status: 'open', files: selection.take() }
      : { status: 'prepared', files };
  } catch (error) {
    if (error instanceof TauriPreparationError) throw error;
    throw new TauriPreparationError({ stage, code: 'failed', effects });
  }
}
