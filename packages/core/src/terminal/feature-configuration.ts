import {
  featureScopeSchema,
  type FeatureScope,
  type CommunicationPane,
  type TerminalLayoutRecord,
  type TerminalTeamSave,
  type FeaturePermissionSave,
} from '@orqst/protocol';
import {
  featurePermissionRevision,
  type FeaturePermissionReader,
} from '../communication/feature-permissions.js';
import { teamRoutingProposal } from '../communication/team-configuration.js';
import { withTerminalPreferences } from './layout-database.js';

/** Trusted Core configuration facade. No process, session, queue or native signer dependency. */
export function featureConfigurationDatabase(directory: string, workspaceId: string) {
  const scope = (featureId: string): FeatureScope =>
    featureScopeSchema.parse({ workspaceId, featureId });
  const withFeature = <T>(
    featureId: string,
    action: (store: import('@orqst/database').Store, ids: string[]) => T,
  ) =>
    withTerminalPreferences(directory, (store) =>
      store.transaction(() => {
        const feature = store.features().read(scope(featureId));
        return action(store, feature.terminalIds);
      }),
    );
  const permissionReader: FeaturePermissionReader = (permissionScope) => {
    if (permissionScope.workspaceId !== workspaceId)
      throw new Error('Feature permission workspace denied');
    return withFeature(permissionScope.featureId, (store) => ({
      feature: store.features().read(scope(permissionScope.featureId)),
      permissions: store.featurePermissions().read(scope(permissionScope.featureId)),
    }));
  };
  return {
    permissionReader,
    withPermissionSnapshot: <T>(
      action: (
        local: FeaturePermissionReader,
        cross: (
          sourceFeatureId: string,
          targetFeatureId: string,
        ) => {
          source: ReturnType<
            ReturnType<import('@orqst/database').Store['crossFeaturePermissions']>['read']
          >;
          target: ReturnType<
            ReturnType<import('@orqst/database').Store['crossFeaturePermissions']>['read']
          >;
        },
      ) => T,
    ): T =>
      withTerminalPreferences(directory, (store) =>
        store.transaction(() => {
          const localPolicies = store.featurePermissions();
          const local: FeaturePermissionReader = (requested) => {
            if (requested.workspaceId !== workspaceId)
              throw new Error('Feature permission workspace denied');
            return {
              feature: store.features().read(scope(requested.featureId)),
              permissions: localPolicies.read(scope(requested.featureId)),
            };
          };
          const cross = (source: string, target: string) => {
            const crossPolicies = store.crossFeaturePermissions();
            return {
              source: crossPolicies.read(scope(source)),
              target: crossPolicies.read(scope(target)),
            };
          };
          const result = action(local, cross);
          if (result && typeof (result as { then?: unknown }).then === 'function')
            throw new Error('Feature permission snapshot must be synchronous');
          return result;
        }),
      ),
    crossFeatureSnapshot: (sourceFeatureId: string, targetFeatureId: string) =>
      withTerminalPreferences(directory, (store) =>
        store.transaction(() => {
          const permissions = store.crossFeaturePermissions();
          return {
            source: permissions.read(scope(sourceFeatureId)),
            target: permissions.read(scope(targetFeatureId)),
          };
        }),
      ),
    saveCrossFeaturePermissions: (
      featureId: string,
      actorId: string,
      expectedRevision: number,
      policy: import('@orqst/protocol').CrossFeaturePolicy,
    ) =>
      withTerminalPreferences(directory, (store) =>
        store.crossFeaturePermissions().save(scope(featureId), actorId, expectedRevision, policy),
      ),
    readPermissions: (featureId: string) =>
      withFeature(featureId, (store) => store.featurePermissions().read(scope(featureId))),
    savePermissions: (featureId: string, actorId: string, input: FeaturePermissionSave) =>
      withFeature(featureId, (store) =>
        store.featurePermissions().save(scope(featureId), actorId, input),
      ),
    permissionEvents: (featureId: string, after = 0) =>
      withFeature(featureId, (store) => store.featurePermissions().events(scope(featureId), after)),
    readView: () =>
      withTerminalPreferences(directory, (store) => store.features().readView(workspaceId)),
    saveView: (input: unknown) =>
      withTerminalPreferences(directory, (store) => store.features().saveView(workspaceId, input)),
    read: (featureId: string) =>
      withTerminalPreferences(directory, (store) => store.features().read(scope(featureId))),
    list: () => withTerminalPreferences(directory, (store) => store.features().list(workspaceId)),
    create: (input: {
      name: string;
      description?: string;
      status?: import('@orqst/protocol').WorkspaceFeature['status'];
    }) =>
      withTerminalPreferences(directory, (store) =>
        store.features().create({ ...input, workspaceId }),
      ),
    update: (featureId: string, input: unknown) =>
      withTerminalPreferences(directory, (store) =>
        store.features().update(scope(featureId), input),
      ),
    assignTerminal: (featureId: string, terminalId: string, expectedRevision: number) =>
      withTerminalPreferences(directory, (store) =>
        store.features().assignTerminal(scope(featureId), terminalId, expectedRevision),
      ),
    readTeam: (featureId: string) =>
      withFeature(featureId, (store, ids) =>
        ids.length
          ? store.terminalTeams(featureId).read(workspaceId, ids)
          : { revision: 0, configuration: null },
      ),
    saveTeam: (featureId: string, input: TerminalTeamSave) =>
      withFeature(featureId, (store, ids) =>
        store.terminalTeams(featureId).save(workspaceId, ids, input),
      ),
    readLayout: (featureId: string) =>
      withFeature(featureId, (store, ids) =>
        ids.length ? (store.terminalLayouts(featureId).read(ids) ?? null) : null,
      ),
    saveLayout: (featureId: string, record: TerminalLayoutRecord) =>
      withFeature(featureId, (store, ids) => store.terminalLayouts(featureId).save(ids, record)),
    routingProposal: (
      featureId: string,
      terminalId: string,
      panes: CommunicationPane[],
      expectedRevision: number,
    ) =>
      withFeature(featureId, (store, ids) => {
        const state = store.terminalTeams(featureId).read(workspaceId, ids);
        if (state.revision !== expectedRevision || !state.configuration)
          throw new Error('Stale team configuration');
        const reader: FeaturePermissionReader = () => ({
          feature: store.features().read(scope(featureId)),
          permissions: store.featurePermissions().read(scope(featureId)),
        });
        return teamRoutingProposal(
          state.configuration,
          terminalId,
          workspaceId,
          panes,
          featureId,
          (source, target) =>
            featurePermissionRevision(source, target, ['delegate', 'execute'], reader),
        );
      }),
    events: (featureId: string, after = 0) =>
      withTerminalPreferences(directory, (store) =>
        store.features().events(scope(featureId), after),
      ),
  };
}

export type FeatureConfigurationDatabase = ReturnType<typeof featureConfigurationDatabase>;
