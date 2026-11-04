import { z } from 'zod';
import { paneRoutingSchema } from './pane-communication.js';
import { terminalDisplayNameSchema } from './terminal-workspace.js';
import { TERMINAL_SLOT_CEILING } from './terminal-capacity.js';

/** Saved intent only. Live bindings, capabilities, process state and grants are excluded. */
export const terminalTeamSchema = z
  .strictObject({
    version: z.literal(1),
    name: terminalDisplayNameSchema,
    members: z
      .array(
        z.strictObject({
          terminalId: z.uuid(),
          name: terminalDisplayNameSchema,
          handle: paneRoutingSchema.shape.handle,
          role: paneRoutingSchema.shape.role,
          allowedTargetTerminalIds: z.array(z.uuid()).max(TERMINAL_SLOT_CEILING - 1),
        }),
      )
      .min(1)
      .max(TERMINAL_SLOT_CEILING),
  })
  .superRefine((team, ctx) => {
    const ids = new Set(team.members.map((member) => member.terminalId));
    const handles = new Set(team.members.map((member) => member.handle));
    const graph = new Map(team.members.map((m) => [m.terminalId, m.allowedTargetTerminalIds]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const cycle = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      if ((graph.get(id) ?? []).some(cycle)) return true;
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    if (
      ids.size !== team.members.length ||
      handles.size !== team.members.length ||
      team.members.some((m) =>
        m.allowedTargetTerminalIds.some((id) => !ids.has(id) || id === m.terminalId),
      ) ||
      team.members.some(
        (m) => new Set(m.allowedTargetTerminalIds).size !== m.allowedTargetTerminalIds.length,
      ) ||
      team.members.some((m) => cycle(m.terminalId))
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid team identities or directed policy' });
  });
export type TerminalTeam = z.infer<typeof terminalTeamSchema>;
export const terminalTeamStateSchema = z.strictObject({
  revision: z.number().int().nonnegative().safe(),
  configuration: terminalTeamSchema.nullable(),
});
export type TerminalTeamState = z.infer<typeof terminalTeamStateSchema>;
export const terminalTeamSaveSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative().safe(),
  configuration: terminalTeamSchema,
});
export type TerminalTeamSave = z.infer<typeof terminalTeamSaveSchema>;
