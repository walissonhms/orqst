import {
  featurePermissionStateSchema,
  workspaceFeatureSchema,
  type CommunicationPane,
  type FeatureScope,
  type FeaturePermissionOperation,
  type FeaturePermissionState,
  type WorkspaceFeature,
} from '@orqst/protocol';

/** Trusted host snapshot, read atomically from the preferences Store, never from agent text. */
export type FeaturePermissionReader = (scope: FeatureScope) => {
  feature: WorkspaceFeature;
  permissions: FeaturePermissionState;
};

/** An absent policy row is neutral (V6 MASTER:286); all invalid/unavailable Feature scopes deny. */
export function featurePermissionRevision(
  source: CommunicationPane,
  target: CommunicationPane,
  operations: readonly FeaturePermissionOperation[],
  read?: FeaturePermissionReader,
): number | null {
  if (source.workspaceId !== target.workspaceId || source.featureId !== target.featureId)
    throw new Error('Feature permission scope denied');
  if (source.featureId === undefined) return null;
  if (
    !read ||
    !source.terminalId ||
    !target.terminalId ||
    source.paneId === target.paneId ||
    source.ownership !== 'managed' ||
    target.ownership !== 'managed'
  )
    throw new Error('Feature permission identity unavailable');
  const scope = { workspaceId: source.workspaceId, featureId: source.featureId };
  const snapshot = read(scope);
  const feature = workspaceFeatureSchema.parse(snapshot.feature);
  const state = featurePermissionStateSchema.parse(snapshot.permissions);
  if (
    feature.workspaceId !== scope.workspaceId ||
    feature.featureId !== scope.featureId ||
    state.workspaceId !== scope.workspaceId ||
    state.featureId !== scope.featureId ||
    feature.status === 'archived' ||
    !feature.terminalIds.includes(source.terminalId) ||
    !feature.terminalIds.includes(target.terminalId) ||
    state.configuration?.rules.some(
      (rule) =>
        !feature.terminalIds.includes(rule.sourceTerminalId) ||
        !feature.terminalIds.includes(rule.targetTerminalId),
    )
  )
    throw new Error('Feature permission membership denied');
  const rule = state.configuration?.rules.find(
    (r) => r.sourceTerminalId === source.terminalId && r.targetTerminalId === target.terminalId,
  );
  if (state.configuration && operations.some((op) => !rule?.operations.includes(op)))
    throw new Error('Feature permission denied');
  return state.revision;
}
