import type { FeatureNativeSnapshot } from '@orqst/protocol';

/** The request reply that raised the notice and the target state it was raised against. */
export interface FeatureNoticeContext {
  featureId: string | null;
  viewRevision: number;
  featureRevision: number | null;
}

function featureRevision(snapshot: FeatureNativeSnapshot, featureId: string | null) {
  if (featureId === null) return null;
  return snapshot.features.find((feature) => feature.featureId === featureId)?.revision ?? null;
}

export function featureNoticeContext(
  snapshot: FeatureNativeSnapshot | undefined,
  featureId: string | null,
): FeatureNoticeContext {
  return {
    featureId,
    viewRevision: snapshot?.view.revision ?? 0,
    featureRevision: snapshot ? featureRevision(snapshot, featureId) : null,
  };
}

/**
 * A refusal stays visible with its reason until the user acts again or the exact target
 * it was raised against changes. Layout, focus, resize and unrelated generation bumps
 * never clear it; only the active Feature or that Feature's own revision does.
 */
export function featureNoticeAfterSnapshot(
  notice: string,
  context: FeatureNoticeContext,
  incoming: FeatureNativeSnapshot,
) {
  if (incoming.activeFeatureId !== context.featureId) return '';
  if (featureRevision(incoming, context.featureId) !== context.featureRevision) return '';
  return notice;
}
