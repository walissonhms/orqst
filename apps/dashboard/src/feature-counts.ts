import type { FeatureNativeSnapshot } from '@orqst/protocol';

/** Real terminals not assigned to any Feature. Never derived from capacity arithmetic. */
export function unassignedTerminalCount(snapshot: FeatureNativeSnapshot) {
  const assigned = new Set(snapshot.features.flatMap((feature) => feature.terminalIds));
  return snapshot.slots.filter((slot) => !assigned.has(slot.terminalId)).length;
}
