import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AtSign,
  Check,
  CircleHelp,
  Columns3,
  CornerDownLeft,
  Crown,
  LayoutGrid,
  List,
  Maximize2,
  MessageSquare,
  Minimize2,
  Minus,
  PictureInPicture2,
  Plus,
  RectangleHorizontal,
  Rows3,
  Send,
  Square,
  SquareStack,
  X,
  XCircle,
} from 'lucide-react';
import {
  addPane,
  arrange,
  arrangementModes,
  containRect,
  GAP,
  mosaicGeometry,
  paneView,
  resizeFromEdge,
  resizeTrack,
  setOrchestrator,
  togglePin,
  type Edge,
  dropTarget,
  orderIndex,
  arcPath,
  lanePath,
  linkStyle,
  minimize,
  paneSizes,
  removePane,
  reorder,
  resizeSplit,
  restoreAll,
  toggleMaximize,
  updatePane,
  visiblePanes,
  type ArrangementMode,
  type ArrangementState,
  type PaneSize,
  type PlacedPane,
  type Rect,
} from './terminal-arrangement';
import { PaneMenu, type AccountOption, type PaneAction, type PaneActionType } from './PaneMenu';
import { TerminalDetails } from './TerminalDetails';
import { MentionComposer, type DeliveryState, type MentionSend } from './MentionComposer';
import './terminal-studio.css';
import './mention-composer.css';
import './pane-menu.css';

export type TerminalProvider = 'codex' | 'claude' | 'opencode' | 'shell';
export type TerminalStatus =
  'running' | 'waiting_for_user' | 'completed' | 'failed' | 'interrupted' | 'unknown';

export interface StudioTerminal {
  id: string;
  /** Stable visible label such as `T-001`. */
  label: string;
  name: string;
  provider: TerminalProvider;
  /** `undefined` = unknown, `null` = CLI default, string = selected model. */
  model?: string | null;
  status: TerminalStatus;
  /** Epoch ms when the owned PTY started, when known. */
  startedAt?: number;
  /** Latest evidenced activity label, when known. */
  lastActivity?: string;
  /** Workspace that owns this terminal. */
  workspace: { id: string; name: string };
  /** Saved orchestrator label of the Feature (descriptive, grants nothing). */
  orchestrator?: boolean;
  /** Cumulative token snapshot when evidenced; never invented. */
  tokens?: { total?: number; input?: number; output?: number; cached?: number };
  /** CLI account (ORQST profile) this terminal runs under, when known. */
  account?: { id: string; label: string };
  /** Stable internal identifier shown only in details. */
  uuid?: string;
}

/** Evidenced suggestion to continue a terminal on another account (one click, never automatic). */
export interface AccountSuggestion {
  terminalId: string;
  toAccountId: string;
  reason: 'limit_reached';
}

/** A finished piece of work, derived from an evidenced status transition. */
export interface StudioStatusEvent {
  id: string;
  terminalId: string;
  status: 'completed' | 'failed' | 'waiting_for_user';
  at: number;
}

/** A communication event backed by Core evidence (or a labelled synthetic preview). */
export interface StudioMessage {
  id: string;
  from: string;
  to: string;
  kind: 'message' | 'delegation' | 'result';
}

interface Props {
  terminals: StudioTerminal[];
  messages: StudioMessage[];
  renderBody: (terminal: StudioTerminal) => ReactNode;
  onNewTerminal?: () => void;
  onClose?: (id: string) => void;
  /** Local storage key for the arrangement of this Feature. */
  storageKey: string;
  now?: number;
  /** CLI accounts available for switching. */
  accounts?: AccountOption[];
  /** Actions the host can perform today; others are shown disabled. */
  supportedActions?: PaneActionType[];
  onTerminalAction?: (id: string, action: PaneAction) => void;
  accountSuggestions?: AccountSuggestion[];
  /** Send a structured message that mentions other terminals (never typed into a PTY). */
  onMention?: (message: MentionSend) => Promise<DeliveryState>;
  /** Persist the orchestrator label for this Feature (descriptive only). */
  onOrchestratorChange?: (id: string | null) => void;
  /** Called once per evidenced end of work, for native/OS notifications. */
  onStatusEvent?: (event: StudioStatusEvent, terminal: StudioTerminal) => void;
}

const NOTICE_MS = 8000;
const endStatuses = new Set(['completed', 'failed', 'waiting_for_user']);

/** Stable hue per workspace id so the same workspace always has the same color. */
export function workspaceHue(id: string): number {
  // FNV-1a, then the golden angle so similar ids still get distant hues.
  let hash = 0x811c9dc5;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return Math.round((hash % 1000) * 137.508) % 360;
}

const modeIcons: Record<ArrangementMode, typeof LayoutGrid> = {
  mosaic: LayoutGrid,
  columns: Columns3,
  rows: Rows3,
  focus: Square,
  list: List,
  free: PictureInPicture2,
};

const sizeIcons: Record<PaneSize, typeof Square> = {
  small: Square,
  wide: RectangleHorizontal,
  large: SquareStack,
};

const kindIcons: Record<StudioMessage['kind'], typeof Send> = {
  message: MessageSquare,
  delegation: Send,
  result: CornerDownLeft,
};

/** Header badge naming the other end of the latest message for this pane. */
function FlowBadge({
  incoming,
  outgoing,
  labelOf,
}: {
  incoming?: StudioMessage;
  outgoing?: StudioMessage;
  labelOf: (id: string) => string;
}) {
  const { t } = useTranslation();
  const message = incoming ?? outgoing;
  if (!message) return null;
  const Icon = kindIcons[message.kind];
  const text = incoming
    ? t('terminalStudio.flow.from', { label: labelOf(message.from) })
    : t('terminalStudio.flow.to', { label: labelOf(message.to) });
  return (
    <span
      key={message.id}
      className={`ts-flow ts-link-${message.kind} ${incoming ? 'ts-flow-in' : 'ts-flow-out'}`}
      title={t(`terminalStudio.messageKind.${message.kind}`)}
    >
      <Icon size={11} strokeWidth={2.25} />
      {text}
    </span>
  );
}

const edges: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const LINK_MS = 2400;
const MAX_ACTIVE = 3;

function loadState(key: string): Partial<ArrangementState> | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<ArrangementState>) : undefined;
  } catch {
    return undefined;
  }
}

function saveState(key: string, state: ArrangementState) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Storage can be unavailable; the arrangement still works for this session.
  }
}

/** Keep stored arrangement in sync with the actual terminal list. */
function reconcile(state: ArrangementState, terminals: StudioTerminal[]): ArrangementState {
  const ids = new Set(terminals.map((terminal) => terminal.id));
  let next: ArrangementState = {
    ...state,
    panes: state.panes.filter((pane) => ids.has(pane.id)),
  };
  for (const terminal of terminals)
    if (!next.panes.some((pane) => pane.id === terminal.id)) next = addPane(next, terminal.id);
  if (next.maximized && !ids.has(next.maximized)) next = { ...next, maximized: null };
  // The host's saved orchestrator label wins over the local one.
  if (next.pinned?.some((id) => !ids.has(id)))
    next = { ...next, pinned: next.pinned.filter((id) => ids.has(id)) };
  const marked = terminals.find((terminal) => terminal.orchestrator);
  if (marked) next = { ...next, orchestrator: marked.id };
  else if (next.orchestrator && !ids.has(next.orchestrator)) next = { ...next, orchestrator: null };
  return next;
}

function validGrid(value: unknown): ArrangementState['grid'] {
  if (!value || typeof value !== 'object') return undefined;
  const numbers = (list: unknown) =>
    Array.isArray(list)
      ? list
          .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
          .slice(0, 16)
      : [];
  const record = value as Record<string, unknown>;
  return { cols: numbers(record.cols), rows: numbers(record.rows) };
}

function initialState(key: string, terminals: StudioTerminal[]): ArrangementState {
  const stored = loadState(key);
  const base: ArrangementState = {
    mode: arrangementModes.includes(stored?.mode as ArrangementMode)
      ? (stored!.mode as ArrangementMode)
      : 'mosaic',
    panes: Array.isArray(stored?.panes) ? stored.panes : [],
    maximized: typeof stored?.maximized === 'string' ? stored.maximized : null,
    weights: stored?.weights && typeof stored.weights === 'object' ? stored.weights : {},
    grid: validGrid(stored?.grid),
    orchestrator: typeof stored?.orchestrator === 'string' ? stored.orchestrator : null,
    pinned: Array.isArray(stored?.pinned)
      ? stored.pinned.filter((id): id is string => typeof id === 'string').slice(0, 16)
      : [],
  };
  return reconcile(base, terminals);
}

function elapsed(startedAt: number | undefined, now: number): string | undefined {
  if (startedAt === undefined) return undefined;
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function StatusIcon({ status }: { status: TerminalStatus }) {
  const { t } = useTranslation();
  const label = t(`terminalStudio.status.${status}`);
  const icon =
    status === 'running' ? (
      <span className="ts-spinner" />
    ) : status === 'waiting_for_user' ? (
      <CircleHelp size={14} />
    ) : status === 'completed' ? (
      <Check size={14} />
    ) : status === 'failed' ? (
      <XCircle size={14} />
    ) : (
      <span className="ts-ring" />
    );
  return (
    <span className={`ts-status ts-status-${status}`} role="img" aria-label={label} title={label}>
      {icon}
    </span>
  );
}

function ProviderMark({ provider }: { provider: TerminalProvider }) {
  return <span className={`ts-provider ts-provider-${provider}`} aria-hidden="true" />;
}

interface Drag {
  id: string;
  pointer: number;
  startX: number;
  startY: number;
  origin: Rect;
  kind: 'move' | 'resize';
  edge?: Edge;
  dx: number;
  dy: number;
}

export function TerminalStudio({
  terminals,
  messages,
  renderBody,
  onNewTerminal,
  onClose,
  storageKey,
  now: fixedNow,
  onStatusEvent,
  onOrchestratorChange,
  onMention,
  accounts = [],
  supportedActions = [],
  onTerminalAction,
  accountSuggestions = [],
}: Props) {
  const { t } = useTranslation();
  const stageRef = useRef<HTMLDivElement>(null);
  const [scope, setScope] = useState<string>('all');
  const [composer, setComposer] = useState<{ from: string | null } | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const supported = useMemo(
    () => new Set<PaneActionType>(onTerminalAction ? supportedActions : []),
    [onTerminalAction, supportedActions],
  );
  const [notices, setNotices] = useState<StudioStatusEvent[]>([]);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [view, setView] = useState<Rect>({ x: 0, y: 0, width: 1200, height: 700 });
  const [state, setState] = useState(() => initialState(storageKey, terminals));
  const [stack, setStack] = useState<string[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [split, setSplit] = useState<{ index: number; last: number; pointer: number } | null>(null);
  const [track, setTrack] = useState<{
    axis: 'cols' | 'rows';
    index: number;
    pointer: number;
    last: number;
  } | null>(null);
  const moveTrack = (event: React.PointerEvent) => {
    if (!track || track.pointer !== event.pointerId) return;
    const position = track.axis === 'cols' ? event.clientX : event.clientY;
    const delta = position - track.last;
    setTrack({ ...track, last: position });
    setState((current) => resizeTrack(current, view, track.axis, track.index, delta));
  };
  const [active, setActive] = useState<StudioMessage[]>([]);
  const [now, setNow] = useState(() => fixedNow ?? Date.now());

  useEffect(() => {
    if (fixedNow !== undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [fixedNow]);

  useEffect(() => setState((current) => reconcile(current, terminals)), [terminals]);
  useEffect(() => saveState(storageKey, state), [storageKey, state]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setView({ x: 0, y: 0, width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Show each new communication event as an animated link for a short time.
  // Each event owns its timer, so a newer event never keeps an older one on screen.
  const seen = useRef(new Set<string>());
  const timers = useRef(new Set<number>());
  useEffect(() => {
    const fresh = messages.filter((message) => !seen.current.has(message.id));
    if (fresh.length === 0) return;
    fresh.forEach((message) => seen.current.add(message.id));
    setActive((current) => [...current, ...fresh].slice(-MAX_ACTIVE));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setActive((current) => current.filter((message) => !fresh.includes(message)));
    }, LINK_MS);
    timers.current.add(timer);
  }, [messages]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  // Detect the end of work from evidenced status transitions (running → end state).
  const previous = useRef(new Map<string, TerminalStatus>());
  const statusCallback = useRef(onStatusEvent);
  statusCallback.current = onStatusEvent;
  useEffect(() => {
    const events: StudioStatusEvent[] = [];
    for (const terminal of terminals) {
      const before = previous.current.get(terminal.id);
      previous.current.set(terminal.id, terminal.status);
      if (before === 'running' && endStatuses.has(terminal.status)) {
        const event: StudioStatusEvent = {
          id: `${terminal.id}:${Date.now()}:${terminal.status}`,
          terminalId: terminal.id,
          status: terminal.status as StudioStatusEvent['status'],
          at: Date.now(),
        };
        events.push(event);
        statusCallback.current?.(event, terminal);
      }
    }
    if (events.length === 0) return;
    setNotices((current) => [...current, ...events].slice(-4));
    setFlash((current) => new Set([...current, ...events.map((event) => event.terminalId)]));
    const timer = window.setTimeout(() => {
      setNotices((current) => current.filter((notice) => !events.includes(notice)));
      setFlash((current) => {
        const next = new Set(current);
        events.forEach((event) => next.delete(event.terminalId));
        return next;
      });
    }, NOTICE_MS);
    timers.current.add(timer);
  }, [terminals]);

  const workspaces = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; total: number; working: number; attention: number }
    >();
    for (const terminal of terminals) {
      const entry = map.get(terminal.workspace.id) ?? {
        ...terminal.workspace,
        total: 0,
        working: 0,
        attention: 0,
      };
      entry.total += 1;
      if (terminal.status === 'running') entry.working += 1;
      if (terminal.status === 'waiting_for_user' || terminal.status === 'failed')
        entry.attention += 1;
      map.set(terminal.workspace.id, entry);
    }
    return [...map.values()];
  }, [terminals]);
  useEffect(() => {
    if (scope !== 'all' && !workspaces.some((workspace) => workspace.id === scope)) setScope('all');
  }, [scope, workspaces]);
  const inScope = (terminal: StudioTerminal | undefined) =>
    !!terminal &&
    (scope === 'all' ||
      terminal.workspace.id === scope ||
      (state.pinned ?? []).includes(terminal.id));
  const working = terminals.filter((terminal) => terminal.status === 'running').length;
  const needsYou = terminals.filter(
    (terminal) => terminal.status === 'waiting_for_user' || terminal.status === 'failed',
  ).length;

  const byId = useMemo(
    () => new Map(terminals.map((terminal) => [terminal.id, terminal])),
    [terminals],
  );
  // The workspace filter only changes the view; it never minimizes or stops anything.
  const scoped = useMemo<ArrangementState>(
    () =>
      scope === 'all'
        ? state
        : {
            ...state,
            maximized:
              state.maximized && inScope(byId.get(state.maximized)) ? state.maximized : null,
            panes: state.panes.map((pane) =>
              inScope(byId.get(pane.id)) ? pane : { ...pane, minimized: true },
            ),
          },
    [state, scope, byId],
  );
  const placed = useMemo(() => arrange(scoped, view, stack), [scoped, view, stack]);
  const placedById = useMemo(() => new Map(placed.map((pane) => [pane.id, pane])), [placed]);
  const minimized = state.panes
    .filter((pane) => pane.minimized && inScope(byId.get(pane.id)))
    .sort((a, b) => a.order - b.order);
  const visibleCount = visiblePanes(scoped).length;
  const scopedTotal = terminals.filter(inScope).length;

  const reveal = (id: string) => {
    const terminal = byId.get(id);
    if (terminal && !inScope(terminal)) setScope('all');
    setState((current) => updatePane(current, id, { minimized: false }));
    bringToFront(id);
    setFlash((current) => new Set([...current, id]));
    window.setTimeout(
      () =>
        setFlash((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        }),
      1600,
    );
  };
  const receiving = new Set(active.map((message) => message.to));
  const sending = new Set(active.map((message) => message.from));

  const bringToFront = useCallback((id: string) => {
    setStack((current) => [...current.filter((entry) => entry !== id), id]);
  }, []);

  const setMode = (mode: ArrangementMode) =>
    setState((current) => ({ ...current, mode, maximized: null }));

  const startDrag = (
    event: React.PointerEvent,
    pane: PlacedPane,
    kind: Drag['kind'],
    edge?: Edge,
  ) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    bringToFront(pane.id);
    setDrag({
      id: pane.id,
      pointer: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: pane.rect,
      kind,
      edge,
      dx: 0,
      dy: 0,
    });
  };

  const moveDrag = (event: React.PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    setDrag({ ...drag, dx: event.clientX - drag.startX, dy: event.clientY - drag.startY });
  };

  const endDrag = (event: React.PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const { id, origin, dx, dy, kind, edge } = drag;
    setDrag(null);
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    if (state.mode === 'free') {
      const rect =
        kind === 'move'
          ? { ...origin, x: origin.x + dx, y: origin.y + dy }
          : resizeFromEdge(origin, edge ?? 'se', dx, dy);
      setState((current) => updatePane(current, id, { free: containRect(rect, view) }));
      return;
    }
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return;
    const target = dropTarget(
      placed.filter((pane) => pane.id !== id),
      event.clientX - stage.left,
      event.clientY - stage.top,
    );
    if (target) setState((current) => reorder(current, id, orderIndex(current, target)));
  };

  const liveRect = (pane: PlacedPane): Rect => {
    if (!drag || drag.id !== pane.id) return pane.rect;
    if (state.mode === 'free') {
      return drag.kind === 'move'
        ? containRect(
            { ...drag.origin, x: drag.origin.x + drag.dx, y: drag.origin.y + drag.dy },
            view,
          )
        : containRect(resizeFromEdge(drag.origin, drag.edge ?? 'se', drag.dx, drag.dy), view);
    }
    return { ...pane.rect, x: pane.rect.x + drag.dx, y: pane.rect.y + drag.dy };
  };

  const splitHandles =
    (state.mode === 'columns' || state.mode === 'rows') && !state.maximized
      ? placed.slice(0, -1).map((pane, index) => {
          const rect = pane.rect;
          const style =
            state.mode === 'columns'
              ? { left: rect.x + rect.width, top: rect.y, width: 8, height: rect.height }
              : { left: rect.x, top: rect.y + rect.height, width: rect.width, height: 8 };
          return (
            <div
              key={`split-${pane.id}`}
              className={`ts-split ts-split-${state.mode}`}
              style={style}
              role="separator"
              aria-orientation={state.mode === 'columns' ? 'vertical' : 'horizontal'}
              aria-label={t('terminalStudio.resizeSplit')}
              tabIndex={0}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 64 : 16;
                const delta =
                  event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                    ? -step
                    : event.key === 'ArrowRight' || event.key === 'ArrowDown'
                      ? step
                      : 0;
                if (delta) setState((current) => resizeSplit(current, view, index, delta));
              }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setSplit({
                  index,
                  pointer: event.pointerId,
                  last: state.mode === 'columns' ? event.clientX : event.clientY,
                });
              }}
              onPointerMove={(event) => {
                if (!split || split.pointer !== event.pointerId) return;
                const position = state.mode === 'columns' ? event.clientX : event.clientY;
                const delta = position - split.last;
                setSplit({ ...split, last: position });
                setState((current) => resizeSplit(current, view, split.index, delta));
              }}
              onPointerUp={() => setSplit(null)}
            />
          );
        })
      : null;

  // Mosaic: drag the borders between terminals to resize columns and rows.
  const trackHandles = (() => {
    if (scoped.mode !== 'mosaic' || scoped.maximized || placed.length < 2) return null;
    const g = mosaicGeometry(visiblePanes(scoped), paneView(scoped, view), state.grid);
    const spans = (axis: 'cols' | 'rows', border: number, at: number) =>
      g.cells.some((cell) =>
        axis === 'cols'
          ? cell.col <= border &&
            cell.col + cell.w - 1 >= border + 1 &&
            cell.row <= at &&
            cell.row + cell.h - 1 >= at
          : cell.row <= border &&
            cell.row + cell.h - 1 >= border + 1 &&
            cell.col <= at &&
            cell.col + cell.w - 1 >= at,
      );
    const handles: ReactNode[] = [];
    const start = (axis: 'cols' | 'rows', index: number) => (event: React.PointerEvent) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      setTrack({
        axis,
        index,
        pointer: event.pointerId,
        last: axis === 'cols' ? event.clientX : event.clientY,
      });
    };
    const keys = (axis: 'cols' | 'rows', index: number) => (event: React.KeyboardEvent) => {
      const step = event.shiftKey ? 64 : 16;
      const back = axis === 'cols' ? 'ArrowLeft' : 'ArrowUp';
      const forward = axis === 'cols' ? 'ArrowRight' : 'ArrowDown';
      const delta = event.key === back ? -step : event.key === forward ? step : 0;
      if (delta) setState((current) => resizeTrack(current, view, axis, index, delta));
    };
    for (let c = 0; c < g.colW.length - 1; c++)
      for (let r = 0; r < g.rowH.length; r++) {
        if (spans('cols', c, r)) continue;
        handles.push(
          <div
            key={`col-${c}-${r}`}
            className="ts-split ts-split-columns ts-track"
            style={{ left: g.colX[c]! + g.colW[c]!, top: g.rowY[r], width: GAP, height: g.rowH[r] }}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('terminalStudio.resizeColumns')}
            tabIndex={r === 0 ? 0 : -1}
            onKeyDown={keys('cols', c)}
            onPointerDown={start('cols', c)}
            onPointerMove={moveTrack}
            onPointerUp={() => setTrack(null)}
          />,
        );
      }
    for (let r = 0; r < g.rowH.length - 1; r++)
      for (let c = 0; c < g.colW.length; c++) {
        if (spans('rows', r, c)) continue;
        handles.push(
          <div
            key={`row-${r}-${c}`}
            className="ts-split ts-split-rows ts-track"
            style={{ left: g.colX[c], top: g.rowY[r]! + g.rowH[r]!, width: g.colW[c], height: GAP }}
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('terminalStudio.resizeRows')}
            tabIndex={c === 0 ? 0 : -1}
            onKeyDown={keys('rows', r)}
            onPointerDown={start('rows', r)}
            onPointerMove={moveTrack}
            onPointerUp={() => setTrack(null)}
          />,
        );
      }
    return handles;
  })();

  const style = linkStyle(scoped);
  const links =
    style === 'focus'
      ? []
      : active
          .map((message) => {
            const from = placedById.get(message.from);
            const to = placedById.get(message.to);
            if (!from || !to) return null;
            const a = liveRect(from);
            const b = liveRect(to);
            return {
              message,
              path: style === 'lane' ? lanePath(a, b, view) : arcPath(a, b, view),
            };
          })
          .filter((link) => link !== null);
  // Events whose ends are not both on screen are announced in the dock instead.
  const offscreen = active.filter(
    (message) => style === 'focus' || !placedById.has(message.from) || !placedById.has(message.to),
  );
  const flowFor = (id: string) => ({
    outgoing: active.findLast((message) => message.from === id),
    incoming: active.findLast((message) => message.to === id),
  });

  return (
    <section
      className={`ts-root${fullScreen ? ' ts-fullscreen' : ''}`}
      aria-label={t('terminalStudio.title')}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && fullScreen) {
          setFullScreen(false);
          setState((current) => ({ ...current, maximized: null }));
        }
      }}
    >
      <header className="ts-toolbar">
        <div className="ts-modes" role="radiogroup" aria-label={t('terminalStudio.layout')}>
          {arrangementModes.map((mode) => {
            const Icon = modeIcons[mode];
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={state.mode === mode}
                className={state.mode === mode ? 'active' : ''}
                title={t(`terminalStudio.mode.${mode}`)}
                onClick={() => setMode(mode)}
              >
                <Icon size={15} />
                <span>{t(`terminalStudio.mode.${mode}`)}</span>
              </button>
            );
          })}
        </div>
        <span className="ts-summary">
          {working > 0 && (
            <span className="ts-sum-working">
              <span className="ts-spinner" aria-hidden="true" />
              {t('terminalStudio.summary.working', { count: working })}
            </span>
          )}
          {needsYou > 0 && (
            <span className="ts-sum-attention">
              {t('terminalStudio.summary.needsYou', { count: needsYou })}
            </span>
          )}
          <span className="ts-count">
            {t('terminalStudio.count', { visible: visibleCount, total: scopedTotal })}
          </span>
        </span>
        {minimized.length > 0 && (
          <button
            type="button"
            className="ts-ghost"
            onClick={() =>
              setState((current) =>
                scope === 'all'
                  ? restoreAll(current)
                  : {
                      ...current,
                      panes: current.panes.map((pane) =>
                        inScope(byId.get(pane.id)) ? { ...pane, minimized: false } : pane,
                      ),
                    },
              )
            }
          >
            {t('terminalStudio.restoreAll')}
          </button>
        )}
        {onNewTerminal && (
          <button type="button" className="ts-primary" onClick={onNewTerminal}>
            <Plus size={15} />
            {t('terminalStudio.newTerminal')}
          </button>
        )}
      </header>

      {workspaces.length > 1 && (
        <nav className="ts-scopes" aria-label={t('terminalStudio.workspaces')}>
          <button
            type="button"
            className={scope === 'all' ? 'active' : ''}
            aria-pressed={scope === 'all'}
            onClick={() => setScope('all')}
          >
            {t('terminalStudio.allWorkspaces')}
            <span className="ts-scope-count">{terminals.length}</span>
          </button>
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              className={scope === workspace.id ? 'active' : ''}
              aria-pressed={scope === workspace.id}
              style={{ '--ts-ws': workspaceHue(workspace.id) } as React.CSSProperties}
              onClick={() => setScope(workspace.id)}
              title={t('terminalStudio.scopeTitle', {
                name: workspace.name,
                working: workspace.working,
                total: workspace.total,
              })}
            >
              <span className="ts-ws-dot" aria-hidden="true" />
              {workspace.name}
              {workspace.working > 0 && <span className="ts-spinner" aria-hidden="true" />}
              {workspace.attention > 0 && (
                <span className="ts-scope-alert">{workspace.attention}</span>
              )}
              <span className="ts-scope-count">{workspace.total}</span>
            </button>
          ))}
        </nav>
      )}

      <div
        ref={stageRef}
        className={`ts-stage ts-mode-${state.mode}${drag ? ' ts-dragging' : ''}`}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={() => setDrag(null)}
      >
        {terminals.length === 0 && (
          <div className="ts-empty">
            <p>{t('terminalStudio.empty')}</p>
            {onNewTerminal && (
              <button type="button" className="ts-primary" onClick={onNewTerminal}>
                <Plus size={15} />
                {t('terminalStudio.newTerminal')}
              </button>
            )}
          </div>
        )}
        {terminals.length > 0 && visibleCount === 0 && (
          <div className="ts-empty">
            <p>{t('terminalStudio.allMinimized')}</p>
            <button type="button" className="ts-ghost" onClick={() => setState(restoreAll)}>
              {t('terminalStudio.restoreAll')}
            </button>
          </div>
        )}

        {placed.map((pane) => {
          const terminal = byId.get(pane.id);
          const arranged = state.panes.find((entry) => entry.id === pane.id);
          if (!terminal || !arranged) return null;
          const rect = liveRect(pane);
          const isMax = state.maximized === pane.id || state.mode === 'focus';
          const time = elapsed(terminal.startedAt, now);
          const SizeIcon = sizeIcons[arranged.size];
          const classes = [
            'ts-pane',
            pane.compact ? 'ts-compact' : '',
            drag?.id === pane.id ? 'ts-lifted' : '',
            receiving.has(pane.id) ? 'ts-receiving' : '',
            sending.has(pane.id) ? 'ts-sending' : '',
            terminal.status === 'waiting_for_user' ? 'ts-attention' : '',
            terminal.status === 'running' ? 'ts-working' : '',
            state.orchestrator === pane.id ? 'ts-orchestrator' : '',
            (state.pinned ?? []).includes(pane.id) ? 'ts-pinned' : '',
            flash.has(pane.id) ? `ts-done ts-done-${terminal.status}` : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <article
              key={pane.id}
              className={classes}
              style={{
                transform: `translate(${rect.x}px, ${rect.y}px)`,
                width: rect.width,
                height: rect.height,
                zIndex: drag?.id === pane.id ? 999 : pane.z + 1,
                ['--ts-ws' as string]: workspaceHue(terminal.workspace.id),
              }}
              aria-label={`${terminal.label} ${terminal.name}`}
              onPointerDown={() => state.mode === 'free' && bringToFront(pane.id)}
            >
              <div
                className="ts-head"
                onPointerDown={(event) => startDrag(event, pane, 'move')}
                onDoubleClick={() => setState((current) => toggleMaximize(current, pane.id))}
                title={t('terminalStudio.dragHint')}
              >
                <StatusIcon status={terminal.status} />
                <span className="ts-label">{terminal.label}</span>
                <span className="ts-name">{terminal.name}</span>
                {state.orchestrator === pane.id && (
                  <span className="ts-role" title={t('terminalStudio.orchestratorHint')}>
                    <Crown size={11} strokeWidth={2.25} aria-hidden="true" />
                    {t('terminalStudio.orchestrator')}
                  </span>
                )}
                {workspaces.length > 1 && (
                  <span className="ts-ws" title={terminal.workspace.name}>
                    <span className="ts-ws-dot" aria-hidden="true" />
                    {terminal.workspace.name}
                  </span>
                )}
                <FlowBadge {...flowFor(pane.id)} labelOf={(id) => byId.get(id)?.label ?? '?'} />
                <span className="ts-meta">
                  <ProviderMark provider={terminal.provider} />
                  <span>
                    {terminal.model === undefined
                      ? '—'
                      : terminal.model === null
                        ? t('terminalStudio.defaultModel')
                        : terminal.model}
                  </span>
                  <span className="ts-time" title={t('terminalStudio.processTime')}>
                    {time ?? '—'}
                  </span>
                </span>
                {pane.compact && (
                  <span className="ts-compact-activity">
                    {terminal.lastActivity ?? t('terminalStudio.noActivity')}
                  </span>
                )}
                <span className="ts-actions">
                  {onMention && terminals.length > 1 && (
                    <button
                      type="button"
                      className="ts-secondary"
                      title={t('terminalStudio.mention.fromThis')}
                      aria-label={t('terminalStudio.mention.fromThis')}
                      onClick={() => setComposer({ from: pane.id })}
                    >
                      <AtSign size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`ts-crown${state.orchestrator === pane.id ? ' active' : ''}`}
                    aria-pressed={state.orchestrator === pane.id}
                    title={
                      state.orchestrator === pane.id
                        ? t('terminalStudio.unsetOrchestrator')
                        : t('terminalStudio.setOrchestrator')
                    }
                    aria-label={
                      state.orchestrator === pane.id
                        ? t('terminalStudio.unsetOrchestrator')
                        : t('terminalStudio.setOrchestrator')
                    }
                    onClick={() => {
                      const next = state.orchestrator === pane.id ? null : pane.id;
                      setState((current) => setOrchestrator(current, pane.id));
                      onOrchestratorChange?.(next);
                    }}
                  >
                    <Crown size={14} />
                  </button>
                  {state.mode === 'mosaic' && !isMax && (
                    <button
                      className="ts-secondary"
                      type="button"
                      title={t('terminalStudio.size', {
                        size: t(`terminalStudio.sizes.${arranged.size}`),
                      })}
                      aria-label={t('terminalStudio.size', {
                        size: t(`terminalStudio.sizes.${arranged.size}`),
                      })}
                      onClick={() =>
                        setState((current) =>
                          updatePane(current, pane.id, {
                            size: paneSizes[
                              (paneSizes.indexOf(arranged.size) + 1) % paneSizes.length
                            ]!,
                          }),
                        )
                      }
                    >
                      <SizeIcon size={14} />
                    </button>
                  )}
                  <PaneMenu
                    terminal={terminal}
                    accounts={accounts}
                    supported={supported}
                    maximized={isMax}
                    pinned={(state.pinned ?? []).includes(pane.id)}
                    onAction={(action) =>
                      action.type === 'details'
                        ? setDetails(pane.id)
                        : onTerminalAction?.(pane.id, action)
                    }
                    onToggleMaximize={() => setState((current) => toggleMaximize(current, pane.id))}
                    onTogglePin={() => setState((current) => togglePin(current, pane.id))}
                    onFullScreen={() => {
                      setState((current) => ({ ...current, maximized: pane.id }));
                      setFullScreen(true);
                    }}
                  />
                  <button
                    type="button"
                    title={t('terminalStudio.minimize')}
                    aria-label={t('terminalStudio.minimize')}
                    onClick={() => setState((current) => minimize(current, pane.id))}
                  >
                    <Minus size={14} />
                  </button>
                  {state.mode !== 'focus' && (
                    <button
                      type="button"
                      title={isMax ? t('terminalStudio.restore') : t('terminalStudio.maximize')}
                      aria-label={
                        isMax ? t('terminalStudio.restore') : t('terminalStudio.maximize')
                      }
                      onClick={() => setState((current) => toggleMaximize(current, pane.id))}
                    >
                      {isMax ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    </button>
                  )}
                  {onClose && (
                    <button
                      type="button"
                      className="ts-close"
                      title={t('terminalStudio.hide')}
                      aria-label={t('terminalStudio.hide')}
                      onClick={() => {
                        setState((current) => removePane(current, pane.id));
                        onClose(pane.id);
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </span>
              </div>
              {(() => {
                const suggestion = accountSuggestions.find(
                  (entry) =>
                    entry.terminalId === pane.id &&
                    !dismissed.has(`${entry.terminalId}:${entry.toAccountId}`),
                );
                const target = suggestion
                  ? accounts.find((account) => account.id === suggestion.toAccountId)
                  : undefined;
                if (!suggestion || !target || pane.compact) return null;
                return (
                  <div className="ts-suggest" role="status">
                    <span>
                      {t('terminalStudio.account.limitSuggest', {
                        from: terminal.account?.label ?? '—',
                        to: target.label,
                      })}
                    </span>
                    <button
                      type="button"
                      disabled={!supported.has('migrate')}
                      onClick={() =>
                        onTerminalAction?.(pane.id, {
                          type: 'migrate',
                          accountId: target.id,
                          mode: 'move',
                        })
                      }
                    >
                      {t('terminalStudio.account.continue')}
                    </button>
                    <button
                      type="button"
                      className="ts-suggest-later"
                      onClick={() =>
                        setDismissed(
                          (current) =>
                            new Set([...current, `${suggestion.terminalId}:${target.id}`]),
                        )
                      }
                    >
                      {t('terminalStudio.account.notNow')}
                    </button>
                  </div>
                );
              })()}
              {pane.compact ? null : <div className="ts-body">{renderBody(terminal)}</div>}
              {state.mode === 'free' &&
                !isMax &&
                edges.map((edge) => (
                  <div
                    key={edge}
                    className={`ts-edge ts-edge-${edge}`}
                    aria-hidden="true"
                    onPointerDown={(event) => startDrag(event, pane, 'resize', edge)}
                  />
                ))}
            </article>
          );
        })}

        {splitHandles}
        {trackHandles}

        <svg className="ts-links" width={view.width} height={view.height} aria-hidden="true">
          <defs>
            <filter id="ts-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>
          {links.map(({ message, path }) => (
            <g key={message.id} className={`ts-link ts-link-${message.kind}`}>
              <path className="ts-link-glow" d={path} filter="url(#ts-glow)" />
              <path className="ts-link-line" d={path} />
            </g>
          ))}
        </svg>
        {links.map(({ message, path }) => {
          const Icon = kindIcons[message.kind];
          return (
            <span
              key={`flight-${message.id}`}
              className={`ts-flight ts-link-${message.kind}`}
              style={{ offsetPath: `path("${path}")` }}
              aria-hidden="true"
            >
              <Icon size={11} strokeWidth={2.25} />
            </span>
          );
        })}

        {state.mode === 'focus' && visibleCount > 1 && (
          <nav className="ts-focus-switch" aria-label={t('terminalStudio.switchTerminal')}>
            {visiblePanes(scoped).map((pane) => {
              const terminal = byId.get(pane.id);
              if (!terminal) return null;
              const current = (scoped.maximized ?? visiblePanes(scoped)[0]?.id) === pane.id;
              return (
                <button
                  key={pane.id}
                  type="button"
                  className={[
                    current ? 'active' : '',
                    receiving.has(pane.id) ? 'ts-receiving' : '',
                    sending.has(pane.id) ? 'ts-sending' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-current={current}
                  onClick={() => setState((s) => ({ ...s, maximized: pane.id }))}
                >
                  <StatusIcon status={terminal.status} />
                  {terminal.label}
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {onMention && composer && (
        <MentionComposer
          terminals={terminals}
          from={composer.from}
          onFromChange={(from) => setComposer({ from })}
          onSend={onMention}
          onClose={() => setComposer(null)}
          autoFocus
        />
      )}

      <footer className="ts-dock" aria-label={t('terminalStudio.dock')}>
        {onMention && !composer && terminals.length > 1 && (
          <button
            type="button"
            className="ts-mention-open"
            onClick={() => setComposer({ from: null })}
          >
            <AtSign size={13} />
            {t('terminalStudio.mention.open')}
          </button>
        )}
        <span className="ts-dock-title">{t('terminalStudio.minimized')}</span>
        {minimized.length === 0 && <span className="ts-dock-empty">—</span>}
        {minimized.map((pane) => {
          const terminal = byId.get(pane.id);
          if (!terminal) return null;
          return (
            <button
              key={pane.id}
              type="button"
              className={`ts-chip${receiving.has(pane.id) ? ' ts-receiving' : ''}`}
              onClick={() =>
                setState((current) => updatePane(current, pane.id, { minimized: false }))
              }
              title={t('terminalStudio.restore')}
            >
              <StatusIcon status={terminal.status} />
              <span className="ts-label">{terminal.label}</span>
              {terminal.name}
            </button>
          );
        })}
        <div className="ts-toasts">
          {notices.map((notice) => {
            const terminal = byId.get(notice.terminalId);
            if (!terminal) return null;
            return (
              <div key={notice.id} className={`ts-notice ts-notice-${notice.status}`} role="status">
                <StatusIcon status={notice.status} />
                <span className="ts-notice-text">
                  <strong>
                    <span className="ts-label">{terminal.label}</span> {terminal.name}
                  </strong>
                  <span>
                    {t(`terminalStudio.notice.${notice.status}`)} · {terminal.workspace.name}
                  </span>
                </span>
                <button type="button" onClick={() => reveal(terminal.id)}>
                  {t('terminalStudio.notice.open')}
                </button>
                <button
                  type="button"
                  className="ts-notice-close"
                  aria-label={t('terminalStudio.notice.dismiss')}
                  onClick={() =>
                    setNotices((current) => current.filter((entry) => entry.id !== notice.id))
                  }
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
          {offscreen.map((message) => {
            const Icon = kindIcons[message.kind];
            return (
              <div key={message.id} className={`ts-toast ts-link-${message.kind}`}>
                <Icon size={13} />
                <span className="ts-label">{byId.get(message.from)?.label ?? '?'}</span>
                <span aria-hidden="true">→</span>
                <span className="ts-label">{byId.get(message.to)?.label ?? '?'}</span>
                {t(`terminalStudio.messageKind.${message.kind}`)}
              </div>
            );
          })}
        </div>
        <div className="ts-sr-only" aria-live="polite">
          {active.map((message) => (
            <span key={message.id}>
              {t('terminalStudio.announce', {
                from: byId.get(message.from)?.label ?? '?',
                to: byId.get(message.to)?.label ?? '?',
                kind: t(`terminalStudio.messageKind.${message.kind}`),
              })}
            </span>
          ))}
        </div>
      </footer>
      {details && byId.get(details) && (
        <TerminalDetails terminal={byId.get(details)!} onClose={() => setDetails(null)} />
      )}
      {fullScreen && (
        <button
          type="button"
          className="ts-exit-full"
          onClick={() => {
            setFullScreen(false);
            setState((current) => ({ ...current, maximized: null }));
          }}
        >
          {t('terminalStudio.menu.exitFullScreen')}
        </button>
      )}
    </section>
  );
}
