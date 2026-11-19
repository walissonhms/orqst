import type { FeatureCanvasEvidence, FeatureNativeSnapshot } from '@orqst/protocol';
import type { OwnedPaneEvidence } from './terminal-lifecycle.js';

/** A saved member or an admitted slot alone does not prove an open process. */
export function openFeatureTerminalIds(
  snapshot: FeatureNativeSnapshot | undefined,
  canvas: FeatureCanvasEvidence | undefined,
  ownedEvidence: ReadonlyMap<string, OwnedPaneEvidence>,
): Set<string> {
  const entries = new Map(canvas?.entries.map((entry) => [entry.terminalId, entry]));
  return new Set(
    snapshot?.slots.flatMap(({ slot, terminalId, closed }) => {
      if (closed) return [];
      const entry = entries.get(terminalId);
      const state = entry?.slot === slot ? entry.state : undefined;
      const process = ownedEvidence.get(terminalId)?.process;
      if (process === 'exited' || state === 'exited') return [];
      return process === 'live' || state === 'running' ? [terminalId] : [];
    }),
  );
}

/** Real terminals not assigned to any Feature. Never derived from capacity arithmetic. */
export function unassignedTerminalCount(snapshot: FeatureNativeSnapshot) {
  const assigned = new Set(snapshot.features.flatMap((feature) => feature.terminalIds));
  return snapshot.slots.filter((slot) => !assigned.has(slot.terminalId)).length;
}
