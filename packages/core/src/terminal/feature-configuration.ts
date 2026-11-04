import {
  featureScopeSchema,
  type FeatureScope,
  type CommunicationPane,
  type TerminalLayoutRecord,
  type TerminalTeamSave,
} from '@orqst/protocol';
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
  return {
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
        return teamRoutingProposal(state.configuration, terminalId, workspaceId, panes, featureId);
      }),
    events: (featureId: string, after = 0) =>
      withTerminalPreferences(directory, (store) =>
        store.features().events(scope(featureId), after),
      ),
  };
}

export type FeatureConfigurationDatabase = ReturnType<typeof featureConfigurationDatabase>;
