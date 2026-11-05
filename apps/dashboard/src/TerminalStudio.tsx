import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  CircleHelp,
  Columns3,
  CornerDownLeft,
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
  dropIndex,
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
import './terminal-studio.css';

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
  return next;
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
}: Props) {
  const { t } = useTranslation();
  const stageRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Rect>({ x: 0, y: 0, width: 1200, height: 700 });
  const [state, setState] = useState(() => initialState(storageKey, terminals));
  const [stack, setStack] = useState<string[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [split, setSplit] = useState<{ index: number; last: number; pointer: number } | null>(null);
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

  const byId = useMemo(
    () => new Map(terminals.map((terminal) => [terminal.id, terminal])),
    [terminals],
  );
  const placed = useMemo(() => arrange(state, view, stack), [state, view, stack]);
  const placedById = useMemo(() => new Map(placed.map((pane) => [pane.id, pane])), [placed]);
  const minimized = state.panes.filter((pane) => pane.minimized).sort((a, b) => a.order - b.order);
  const visibleCount = visiblePanes(state).length;
  const receiving = new Set(active.map((message) => message.to));
  const sending = new Set(active.map((message) => message.from));

  const bringToFront = useCallback((id: string) => {
    setStack((current) => [...current.filter((entry) => entry !== id), id]);
  }, []);

  const setMode = (mode: ArrangementMode) =>
    setState((current) => ({ ...current, mode, maximized: null }));

  const startDrag = (event: React.PointerEvent, pane: PlacedPane, kind: Drag['kind']) => {
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
    const { id, origin, dx, dy, kind } = drag;
    setDrag(null);
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    if (state.mode === 'free') {
      const rect =
        kind === 'move'
          ? { ...origin, x: origin.x + dx, y: origin.y + dy }
          : { ...origin, width: origin.width + dx, height: origin.height + dy };
      setState((current) => updatePane(current, id, { free: containRect(rect, view) }));
      return;
    }
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return;
    const target = dropIndex(
      placed.filter((pane) => pane.id !== id),
      state,
      event.clientX - stage.left,
      event.clientY - stage.top,
    );
    if (target >= 0) setState((current) => reorder(current, id, target));
  };

  const liveRect = (pane: PlacedPane): Rect => {
    if (!drag || drag.id !== pane.id) return pane.rect;
    if (state.mode === 'free') {
      return drag.kind === 'move'
        ? containRect(
            { ...drag.origin, x: drag.origin.x + drag.dx, y: drag.origin.y + drag.dy },
            view,
          )
        : containRect(
            {
              ...drag.origin,
              width: drag.origin.width + drag.dx,
              height: drag.origin.height + drag.dy,
            },
            view,
          );
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

  const style = linkStyle(state);
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
    <section className="ts-root" aria-label={t('terminalStudio.title')}>
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
        <span className="ts-count">
          {t('terminalStudio.count', { visible: visibleCount, total: terminals.length })}
        </span>
        {minimized.length > 0 && (
          <button type="button" className="ts-ghost" onClick={() => setState(restoreAll)}>
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
                  {state.mode === 'mosaic' && !isMax && (
                    <button
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
              {pane.compact ? null : <div className="ts-body">{renderBody(terminal)}</div>}
              {state.mode === 'free' && !isMax && (
                <div
                  className="ts-resize"
                  aria-hidden="true"
                  onPointerDown={(event) => startDrag(event, pane, 'resize')}
                />
              )}
            </article>
          );
        })}

        {splitHandles}

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
            {visiblePanes(state).map((pane) => {
              const terminal = byId.get(pane.id);
              if (!terminal) return null;
              const current = (state.maximized ?? visiblePanes(state)[0]?.id) === pane.id;
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

      <footer className="ts-dock" aria-label={t('terminalStudio.dock')}>
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
    </section>
  );
}
