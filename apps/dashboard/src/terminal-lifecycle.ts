import type { TerminalBatchItem, TerminalPreparationCatalog } from '@orqst/protocol';

type TerminalProvider = TerminalPreparationCatalog['providers'][number]['provider'];

export type PaneLifecycleState =
  | 'starting'
  | 'ready'
  | 'running'
  | 'waiting_for_user'
  | 'unknown'
  | 'failed'
  | 'disconnected'
  | 'ended';

export type PaneFailureReason =
  | 'cli_not_installed'
  | 'cli_review_required'
  | 'not_authenticated'
  | 'model_missing'
  | 'catalog_changed'
  | 'native_authority_refused'
  | 'process_crashed'
  | 'capacity_reserved'
  | 'open_refused'
  | 'opening_uncertain';

export interface PaneLifecycleFailure {
  reason: PaneFailureReason;
  evidence: string;
  retryable: boolean;
  exitCode?: number;
}

export interface OwnedPaneEvidence {
  transport: 'connected' | 'lost';
  process:
    'prepared' | 'starting' | 'live' | 'exited' | 'uncertain' | 'open_refused' | 'open_unconfirmed';
  firstFrame?: boolean;
  prompt?: boolean;
  turn?: 'running' | 'waiting_for_user' | 'failed' | 'unknown';
  exitCode?: number;
}

export interface PaneLifecycle {
  state: PaneLifecycleState;
  failure?: PaneLifecycleFailure;
}

/** Core admission and first-frame evidence are distinct from provider prompt/turn evidence. */
export function projectPaneLifecycle(evidence: OwnedPaneEvidence): PaneLifecycle {
  if (evidence.process === 'open_refused' || evidence.process === 'open_unconfirmed')
    return {
      state: 'failed',
      failure: {
        reason:
          evidence.process === 'open_refused' ? 'native_authority_refused' : 'opening_uncertain',
        evidence: evidence.process,
        retryable: evidence.process === 'open_refused',
      },
    };
  if (evidence.process === 'exited') {
    if (evidence.exitCode !== undefined && evidence.exitCode !== 0)
      return {
        state: 'failed',
        failure: {
          reason: 'process_crashed',
          evidence: 'exit',
          retryable: true,
          exitCode: evidence.exitCode,
        },
      };
    return { state: 'ended' };
  }
  if (evidence.transport === 'lost' || evidence.process === 'uncertain')
    return { state: 'disconnected' };
  if (evidence.process !== 'live' || !evidence.firstFrame) return { state: 'starting' };
  if (evidence.turn && evidence.turn !== 'unknown') return { state: evidence.turn };
  return { state: evidence.prompt ? 'ready' : 'unknown' };
}

export interface TerminalOpenCard extends PaneLifecycle {
  /** Renderer correlation key, stable from submit through the native ACK. */
  id: string;
  workspaceId: string;
  featureId: string | null;
  targetFeatureId: string;
  name: string;
  provider: TerminalProvider;
  terminalId?: string;
  verifiedUpdate?: string;
}

export function projectBatchOutcome(
  card: TerminalOpenCard,
  outcome: TerminalBatchItem | undefined,
): TerminalOpenCard {
  if (outcome?.status === 'accepted')
    return {
      ...card,
      terminalId: outcome.terminalId,
      ...(outcome.verifiedUpdate ? { verifiedUpdate: outcome.verifiedUpdate } : {}),
    };
  const evidence = outcome?.reason ?? 'opening_uncertain';
  if (!outcome || outcome.effects !== 'not_started')
    return {
      ...card,
      ...(outcome?.terminalId ? { terminalId: outcome.terminalId } : {}),
      state: 'failed',
      failure: { reason: 'opening_uncertain', evidence, retryable: false },
    };
  if (evidence === 'capacity_reserved')
    return { ...card, state: 'failed', failure: { reason: evidence, evidence, retryable: false } };
  const reason =
    evidence === 'cli_review_required'
      ? 'cli_review_required'
      : evidence === 'catalog_changed' || evidence === 'context_changed'
        ? 'catalog_changed'
        : evidence === 'focus_required' || evidence === 'admission_invalid'
          ? 'native_authority_refused'
          : 'open_refused';
  return { ...card, state: 'failed', failure: { reason, evidence, retryable: true } };
}

export interface EndedTerminal {
  terminalId: string;
  displayId?: string;
  name?: string;
  provider?: TerminalProvider;
  activeReservation?: boolean;
  exitedAt?: number;
  disposition: 'exit_confirmed' | 'released' | 'uncertain';
  released?: boolean;
}

/** Durable release enables reopening. It supplies neither signal nor exit time. */
export function savedTerminalDisposition(
  exitConfirmed: boolean,
  released: boolean,
): EndedTerminal['disposition'] {
  if (exitConfirmed) return 'exit_confirmed';
  return released ? 'released' : 'uncertain';
}

/** A closed UI, absent slot or persisted member ID has no process-authority implications. */
export function reconcileEndedTerminals(
  saved: readonly EndedTerminal[],
  connectedTerminalIds: ReadonlySet<string>,
): EndedTerminal[] {
  return saved.filter(({ terminalId }) => !connectedTerminalIds.has(terminalId));
}
