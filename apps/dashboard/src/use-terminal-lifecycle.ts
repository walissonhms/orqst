import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { TauriStudio, TerminalBatchItem } from '@orqst/protocol';
import {
  projectBatchOutcome,
  projectPaneLifecycle,
  type OwnedPaneEvidence,
  type TerminalOpenCard,
} from './terminal-lifecycle.js';
import { loadTerminalCatalog } from './terminal-catalog-cache.js';

const listeners = new Set<() => void>();
let cards: readonly TerminalOpenCard[] = [];
const empty: readonly TerminalOpenCard[] = [];
let consumers = 0;
const openingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const emptyEvidence: ReadonlyMap<string, OwnedPaneEvidence> = new Map();
let ownedEvidence = emptyEvidence;
let retry: TerminalOpenCard | undefined;

function publish(next: readonly TerminalOpenCard[]) {
  cards = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasTerminalLifecycleConsumer() {
  return consumers > 0;
}

/** A retry requests a fresh picker. It does not automatically replay a native operation. */
export function requestTerminalRetry(card: TerminalOpenCard) {
  if (card.failure?.retryable) retry = card;
}

export function consumeTerminalRetry(workspaceId: string, featureId: string | null) {
  if (
    !retry ||
    retry.workspaceId !== workspaceId ||
    (retry.featureId !== featureId && retry.targetFeatureId !== featureId)
  )
    return;
  const next = retry;
  retry = undefined;
  return next;
}

export function registerTerminalOpens(requests: readonly TerminalOpenCard[]) {
  const ids = new Set(requests.map(({ id }) => id));
  publish([...cards.filter(({ id }) => !ids.has(id)), ...requests]);
}

export function finishTerminalOpens(
  ids: ReadonlySet<string>,
  outcomes: readonly TerminalBatchItem[],
) {
  const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  for (const outcome of outcomes) {
    const terminalId = outcome.terminalId;
    if (outcome.status !== 'accepted' || !terminalId || ownedEvidence.has(terminalId)) continue;
    clearTimeout(openingTimers.get(terminalId));
    openingTimers.set(
      terminalId,
      setTimeout(() => {
        if (!ownedEvidence.has(terminalId))
          updateTerminalOpenEvidence(terminalId, {
            transport: 'connected',
            process: 'open_unconfirmed',
          });
      }, 40_000),
    );
  }
  publish(
    cards.map((card) => {
      if (!ids.has(card.id)) return card;
      const next = projectBatchOutcome(card, byId.get(card.id));
      const owned = next.terminalId && ownedEvidence.get(next.terminalId);
      return owned && next.state === 'starting'
        ? { ...next, ...projectPaneLifecycle(owned) }
        : next;
    }),
  );
}

/** Called with the matching Core/PTY observation, never simply on receipt of enrollment ACK. */
export function updateTerminalOpenEvidence(terminalId: string, evidence: OwnedPaneEvidence) {
  clearTimeout(openingTimers.get(terminalId));
  openingTimers.delete(terminalId);
  const lifecycle = projectPaneLifecycle(evidence);
  ownedEvidence = new Map(ownedEvidence).set(terminalId, evidence);
  publish(
    cards.map((card) =>
      card.terminalId === terminalId ? { ...card, ...lifecycle, failure: lifecycle.failure } : card,
    ),
  );
}

export function useOwnedPaneEvidence() {
  return useSyncExternalStore(
    subscribe,
    () => ownedEvidence,
    () => emptyEvidence,
  );
}

function receiveOwnedPtyEvidence(event: Event) {
  const { terminalId, evidence } =
    (
      event as CustomEvent<{
        terminalId?: unknown;
        evidence?: OwnedPaneEvidence;
      }>
    ).detail ?? {};
  if (
    typeof terminalId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(terminalId) ||
    evidence?.transport !== 'connected' ||
    !['live', 'exited', 'uncertain', 'open_refused', 'open_unconfirmed'].includes(
      evidence.process,
    ) ||
    typeof evidence.firstFrame !== 'boolean' ||
    (evidence.exitCode !== undefined && !Number.isSafeInteger(evidence.exitCode))
  )
    return;
  updateTerminalOpenEvidence(terminalId, {
    transport: 'connected',
    process: evidence.process,
    firstFrame: evidence.firstFrame,
    exitCode: evidence.exitCode,
  });
}

export function dismissTerminalOpen(id: string) {
  publish(cards.filter((card) => card.id !== id));
}

/** Native confirmed pool retirement invalidates its renderer-only opening state. */
export function clearRetiredTerminalEvidence(terminalIds: readonly string[]) {
  const retired = new Set(terminalIds);
  const evidence = new Map(ownedEvidence);
  for (const id of retired) {
    clearTimeout(openingTimers.get(id));
    openingTimers.delete(id);
    evidence.delete(id);
  }
  ownedEvidence = evidence;
  publish(cards.filter(({ terminalId }) => terminalId === undefined || !retired.has(terminalId)));
}

/** Mount once in the Studio shell. This also prewarms the current native scope. */
export function useTerminalLifecycle(
  workspaceId: string,
  featureId: string | null,
  native?: TauriStudio,
  catalogFeatureId = featureId,
) {
  const current = useSyncExternalStore(
    subscribe,
    () => cards,
    () => empty,
  );
  useEffect(() => {
    if (++consumers === 1)
      window.addEventListener('orqst-owned-pty-lifecycle', receiveOwnedPtyEvidence);
    return () => {
      if (--consumers === 0)
        window.removeEventListener('orqst-owned-pty-lifecycle', receiveOwnedPtyEvidence);
    };
  }, []);
  useEffect(() => {
    if (!native || !workspaceId) return;
    const refresh = () => {
      void loadTerminalCatalog(native, { workspaceId, featureId: catalogFeatureId }).catch(
        () => undefined,
      );
    };
    refresh();
    const ttl = window.setInterval(refresh, 10 * 60_000);
    return () => window.clearInterval(ttl);
  }, [native, workspaceId, catalogFeatureId]);
  return useMemo(
    () =>
      current.filter(
        (card) =>
          card.workspaceId === workspaceId &&
          (card.featureId === featureId || card.targetFeatureId === featureId),
      ),
    [current, workspaceId, featureId],
  );
}
