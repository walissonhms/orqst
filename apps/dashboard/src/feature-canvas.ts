import {
  eventSchema,
  communicationPaneSchema,
  communicationMessageSchema,
  communicationAuditSchema,
  type CommunicationPane,
  type CommunicationMessage,
  type CommunicationAudit,
  type SessionView,
  type StoredEvent,
  type FeatureNativeSnapshot,
} from '@orqst/protocol';
import type { WorkspacePane } from './feature-workspace-dock.js';

export interface CanvasAgent {
  id: string;
  slot: number;
  groupId: string;
  featureId: string | null;
  title: string;
  provider: string;
  minimized: boolean;
  orchestrator: boolean;
  /** Only an explicit Core/CLI binding may supply a session; a live PTY is not a running turn. */
  session?: SessionView;
  events: StoredEvent[];
}
export interface CanvasGroup {
  id: string;
  name: string;
}
/** Supplied only by the Core journal projection; absent from the current native facade. */
export interface CanvasJournalEdge {
  source: CommunicationPane;
  target: CommunicationPane;
  message: CommunicationMessage;
  admission: CommunicationAudit;
}
export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CanvasCamera {
  x: number;
  y: number;
  zoom: number;
}

/** The current native metadata contract has no owned CLI-session/event correlation.
 * Keep missing evidence missing, even when a process or a saved Feature says "active". */
export function canvasMembers(
  snapshot: FeatureNativeSnapshot | undefined,
  panes: WorkspacePane[],
): CanvasAgent[] {
  if (!snapshot) return [];
  const assigned = snapshot.features.flatMap((feature) => feature.terminalIds);
  const selected = snapshot.features.find(
    (feature) => feature.featureId === snapshot.activeFeatureId,
  );
  const members =
    selected?.terminalIds ??
    snapshot.slots
      .filter((slot) => !assigned.includes(slot.terminalId))
      .map((slot) => slot.terminalId);
  return snapshot.slots
    .filter((slot) => members.includes(slot.terminalId))
    .map((slot) => {
      const pane = panes.find((entry) => entry.slot === slot.slot);
      return {
        id: slot.terminalId,
        slot: slot.slot,
        groupId: selected?.featureId ?? 'unassigned',
        featureId: selected?.featureId ?? null,
        title: pane?.label || `T-${String(slot.slot + 1).padStart(3, '0')}`,
        provider: slot.provider,
        minimized: pane?.minimized ?? false,
        orchestrator: false,
        events: [],
      };
    });
}

export function canvasActivities(agent: CanvasAgent): StoredEvent[] {
  if (!agent.session) return [];
  return agent.events
    .filter(
      (event) =>
        event.sessionId === agent.session!.id &&
        event.workspaceId === agent.session!.workspaceId &&
        eventSchema.safeParse(event, { jitless: true }).success &&
        Boolean(event.payload.name || event.payload.text),
    )
    .sort((a, b) => b.sequence - a.sequence)
    .slice(0, 3)
    .reverse();
}

/** Completed duration requires an actual completion event, not the last unrelated activity. */
export function canvasDuration(agent: CanvasAgent): number | null {
  const session = agent.session;
  if (!session) return null;
  const start = Date.parse(session.startedAt);
  const completed =
    session.status === 'completed'
      ? agent.events
          .filter(
            (event) =>
              event.sessionId === session.id &&
              event.workspaceId === session.workspaceId &&
              ['agent.completed', 'session.completed'].includes(event.type) &&
              eventSchema.safeParse(event, { jitless: true }).success,
          )
          .sort((a, b) => b.sequence - a.sequence)[0]
      : undefined;
  const end = Date.parse(
    session.status === 'completed' ? (completed?.timestamp ?? '') : session.lastActivity,
  );
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

/** A source-file parent field alone is not a Core journal admission. */
export function canvasEdges(
  agents: CanvasAgent[],
  journal: CanvasJournalEdge[] = [],
): Array<{ from: string; to: string }> {
  const edges = new Map<string, { from: string; to: string }>();
  for (const entry of journal) {
    const { source, target, message, admission } = entry;
    if (
      !communicationPaneSchema.safeParse(source, { jitless: true }).success ||
      !communicationPaneSchema.safeParse(target, { jitless: true }).success ||
      !communicationMessageSchema.safeParse(message, { jitless: true }).success ||
      !communicationAuditSchema.safeParse(admission, { jitless: true }).success ||
      !message.featureId ||
      !source.terminalId ||
      !target.terminalId ||
      source.ownership !== 'managed' ||
      target.ownership !== 'managed' ||
      !source.binding ||
      !target.binding ||
      source.workspaceId !== message.workspaceId ||
      target.workspaceId !== message.workspaceId ||
      admission.workspaceId !== message.workspaceId ||
      source.featureId !== message.featureId ||
      target.featureId !== message.featureId ||
      admission.featureId !== message.featureId ||
      message.sourcePaneId !== source.paneId ||
      message.targetPaneId !== target.paneId ||
      admission.paneId !== source.paneId ||
      admission.messageId !== message.messageId ||
      admission.action !== 'admitted' ||
      admission.actorId !== message.actorId ||
      admission.deliveryState !== 'queued' ||
      admission.taskState !== 'pending' ||
      source.terminalId === target.terminalId ||
      !agents.some(
        (agent) => agent.id === source.terminalId && agent.featureId === message.featureId,
      ) ||
      !agents.some(
        (agent) => agent.id === target.terminalId && agent.featureId === message.featureId,
      )
    )
      continue;
    const edge = { from: source.terminalId, to: target.terminalId };
    edges.set(`${edge.from}:${edge.to}`, edge);
  }
  return [...edges.values()];
}

export function canvasGeometry(agents: CanvasAgent[], groups: CanvasGroup[]) {
  const cards = new Map<string, CanvasRect>();
  const frames = new Map<string, CanvasRect>();
  const roots = agents.filter((agent) => agent.orchestrator);
  const top = roots.length ? 286 : 74;
  groups.forEach((group, column) => {
    const members = agents.filter((agent) => agent.groupId === group.id && !agent.orchestrator);
    const x = 40 + column * 390;
    frames.set(group.id, {
      x,
      y: top,
      width: 360,
      height: Math.max(260, members.length * 234 + 44),
    });
    members.forEach((agent, row) =>
      cards.set(agent.id, { x: x + 18, y: top + 24 + row * 234, width: 324, height: 206 }),
    );
  });
  const width = Math.max(430, groups.length * 390 + 50);
  roots.forEach((agent, index) =>
    cards.set(agent.id, { x: width / 2 - 162 + index * 350, y: 20, width: 324, height: 206 }),
  );
  return {
    cards,
    frames,
    width: Math.max(width, roots.length * 350),
    height: Math.max(450, ...Array.from(frames.values(), (rect) => rect.y + rect.height + 60)),
  };
}

export function fitCanvas(
  width: number,
  height: number,
  world: { width: number; height: number },
): CanvasCamera {
  const zoom = Math.max(
    0.2,
    Math.min(1, (width - 36) / world.width, (height - 100) / world.height),
  );
  return {
    x: (width - world.width * zoom) / 2,
    y: Math.max(20, (height - world.height * zoom - 70) / 2),
    zoom,
  };
}
export function canvasClock(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
