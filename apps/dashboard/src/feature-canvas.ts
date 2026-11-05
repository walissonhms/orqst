import {
  eventSchema,
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

/** Parentage must be explicit in a validated source event, scoped to the same Feature. */
export function canvasEdges(agents: CanvasAgent[]): Array<{ from: string; to: string }> {
  return agents.flatMap((child) => {
    const session = child.session;
    if (!session?.parentSessionId) return [];
    const parent = agents.find(
      (agent) =>
        agent.session?.id === session.parentSessionId &&
        agent.featureId === child.featureId &&
        agent.session.workspaceId === session.workspaceId,
    );
    if (
      !parent ||
      parent.id === child.id ||
      !child.events.some(
        (event) =>
          event.sessionId === session.id &&
          event.workspaceId === session.workspaceId &&
          event.payload.parentSessionId === session.parentSessionId &&
          eventSchema.safeParse(event, { jitless: true }).success,
      )
    )
      return [];
    return [{ from: parent.id, to: child.id }];
  });
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
