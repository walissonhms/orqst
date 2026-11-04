import type { TerminalTeamSave } from '@orqst/protocol';
import { withTerminalPreferences } from './layout-database.js';

/** Same private database/guards as layouts. Hosts supply reviewed IDs and project digest. */
export function terminalTeamDatabase(directory: string, identities: string[], workspaceId: string) {
  return {
    read: () =>
      withTerminalPreferences(directory, (store) =>
        store.terminalTeams().read(workspaceId, identities),
      ),
    save: (input: TerminalTeamSave) =>
      withTerminalPreferences(directory, (store) =>
        store.terminalTeams().save(workspaceId, identities, input),
      ),
  };
}
