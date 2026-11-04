import {
  terminalTeamSchema,
  paneRoutingUpdateSchema,
  type CommunicationPane,
  type TerminalTeam,
} from '@orqst/protocol';

/** Produces a proposal for the existing native review, never calls configureRouting or grants. */
export function teamRoutingProposal(
  raw: TerminalTeam,
  terminalId: string,
  workspaceId: string,
  panes: CommunicationPane[],
  featureId?: string,
) {
  const team = terminalTeamSchema.parse(raw);
  const member = team.members.find((m) => m.terminalId === terminalId);
  if (!member) throw new Error('Team member unavailable');
  const resolve = (id: string) => {
    const matches = panes.filter((p) => p.terminalId === id);
    const pane = matches[0];
    if (
      matches.length !== 1 ||
      !pane ||
      pane.workspaceId !== workspaceId ||
      pane.featureId !== featureId ||
      pane.ownership !== 'managed' ||
      !pane.binding ||
      !pane.routing ||
      pane.state !== 'ready'
    )
      throw new Error('Live team identity unavailable');
    return pane;
  };
  resolve(terminalId);
  return paneRoutingUpdateSchema.parse({
    name: member.name,
    handle: member.handle,
    role: member.role,
    allowedTargetPaneIds: member.allowedTargetTerminalIds.map((id) => resolve(id).paneId),
  });
}
