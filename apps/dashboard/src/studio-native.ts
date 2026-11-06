import type {
  FeatureCanvasEvidence,
  FeatureNativeRequest,
  FeatureNativeSnapshot,
} from '@orqst/protocol';
import type { WorkspacePane } from './feature-workspace-dock.js';
import type { ArrangementMode } from './terminal-arrangement.js';
import type { StudioTerminal } from './TerminalStudio.js';

/** Evidence older than this is not shown (matches the canvas projection). */
const EVIDENCE_MS = 10_000;

/**
 * Project the native snapshot into Studio terminals. Only evidenced facts are used:
 * the agent status comes only from evidenced turn records (otherwise `unknown`).
 */
export function studioTerminals(
  snapshot: FeatureNativeSnapshot | undefined,
  panes: WorkspacePane[],
  evidence: FeatureCanvasEvidence | undefined,
  now: number,
): StudioTerminal[] {
  if (!snapshot) return [];
  const assigned = snapshot.features.flatMap((feature) => feature.terminalIds);
  const selected = snapshot.features.find(
    (feature) => feature.featureId === snapshot.activeFeatureId,
  );
  const members =
    selected?.terminalIds ??
    snapshot.slots.filter((slot) => !assigned.includes(slot.terminalId)).map((s) => s.terminalId);
  const fresh =
    evidence && now >= evidence.observedAt && now - evidence.observedAt <= EVIDENCE_MS
      ? evidence
      : undefined;
  return snapshot.slots
    .filter((slot) => members.includes(slot.terminalId))
    .map((slot) => {
      const label = `T-${String(slot.slot + 1).padStart(3, '0')}`;
      // A display name the user gave wins; otherwise the CLI name, never the ID twice.
      const fallback = { codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode' }[
        slot.provider
      ];
      const pane = panes.find((entry) => entry.slot === slot.slot);
      const entry = fresh?.entries.find(
        (candidate) => candidate.slot === slot.slot && candidate.terminalId === slot.terminalId,
      );
      const last = entry?.activities?.at(-1);
      return {
        id: slot.terminalId,
        uuid: slot.terminalId,
        label,
        name: pane?.label && pane.label !== label ? pane.label : fallback,
        provider: slot.provider,
        ...(slot.selectedModel === undefined ? {} : { model: slot.selectedModel }),
        // Agent state only from evidenced turns (owned Claude today); never from the process.
        status: entry?.agentState ?? 'unknown',
        ...(entry?.startedAt !== undefined && entry.state === 'running'
          ? { startedAt: entry.startedAt }
          : {}),
        ...(last ? { lastActivity: last.label } : {}),
        workspace: slot.workspace ?? snapshot.workspace,
        orchestrator: selected?.orchestratorTerminalId === slot.terminalId,
      };
    });
}

/** Native chrome insets: full window (like the preview) or with the Feature panel. */
export interface NativeChrome {
  sidebar: 0 | 46 | 155;
  top: 36 | 47 | 81 | 92;
  bottom: 34 | 38;
}

/** Preview sizes: 47px toolbar (plus the 45px Feature header with the panel), 38px dock. */
export function nativeChrome(immersive: boolean, windowWidth: number): NativeChrome {
  return immersive
    ? { sidebar: 0, top: 47, bottom: 38 }
    : { sidebar: windowWidth > 720 ? 155 : 46, top: 92, bottom: 38 };
}

/** Rectangle of a PTY hole, in logical px relative to the native content area. */
export interface NativePaneLayout {
  id: string;
  rect: { x: number; y: number; width: number; height: number } | null;
  z: number;
}

type ArrangeRequest = Omit<
  Extract<FeatureNativeRequest, { action: 'arrange' }>,
  'contractVersion' | 'generation'
>;

/**
 * Build the native arrange request. Every current member is sent once; hidden ones
 * carry `rect: null`. Rectangles are clipped to whole pixels inside the viewport.
 */
export function arrangeRequest(
  snapshot: FeatureNativeSnapshot,
  memberIds: string[],
  layout: NativePaneLayout[],
  mode: ArrangementMode,
  viewport: { width: number; height: number },
  chrome?: NativeChrome,
): ArrangeRequest {
  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  const byId = new Map(layout.map((entry) => [entry.id, entry]));
  const panes = snapshot.slots
    .filter((slot) => memberIds.includes(slot.terminalId))
    .map((slot) => {
      const entry = byId.get(slot.terminalId);
      const rect = entry?.rect ? clip(entry.rect, width, height) : null;
      return {
        slot: slot.slot,
        terminalId: slot.terminalId,
        visible: rect !== null,
        z: Math.max(0, Math.min(255, Math.round(entry?.z ?? 0))),
        rect,
      };
    });
  // Native rules: list shows no PTY; focus shows at most one.
  const visible = panes.filter((pane) => pane.visible);
  if (mode === 'list' || (mode === 'focus' && visible.length > 1))
    for (const pane of mode === 'list' ? panes : visible.slice(1)) {
      pane.visible = false;
      pane.rect = null;
    }
  return chrome
    ? { action: 'arrange', layoutVersion: 2, chrome, mode, viewport: { width, height }, panes }
    : { action: 'arrange', layoutVersion: 1, mode, viewport: { width, height }, panes };
}

function clip(rect: NativePaneLayout['rect'] & object, width: number, height: number) {
  const x = Math.max(0, Math.ceil(rect.x));
  const y = Math.max(0, Math.ceil(rect.y));
  const right = Math.min(width, Math.floor(rect.x + rect.width));
  const bottom = Math.min(height, Math.floor(rect.y + rect.height));
  return right - x >= 1 && bottom - y >= 1 ? { x, y, width: right - x, height: bottom - y } : null;
}
