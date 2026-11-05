import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  CircleHelp,
  Circle,
  Hand,
  LoaderCircle,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
} from 'lucide-react';
import {
  canvasActivities,
  canvasClock,
  canvasEdges,
  canvasGeometry,
  fitCanvas,
  type CanvasAgent,
  type CanvasCamera,
  type CanvasGroup,
} from './feature-canvas.js';
import './feature-canvas.css';

function StatusIcon({ agent }: { agent: CanvasAgent }) {
  const status = agent.session?.status ?? 'unknown';
  if (status === 'running') return <LoaderCircle size={14} className="canvas-spinner" />;
  if (status === 'completed') return <Check size={14} />;
  if (status === 'waiting_for_user') return <CircleHelp size={14} />;
  return <Circle size={12} />;
}

export function CanvasAgentCard({
  agent,
  onOpen,
  busy,
}: {
  agent: CanvasAgent;
  onOpen: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const session = agent.session;
  const activities = canvasActivities(agent);
  const status = session?.status ?? 'unknown';
  const start = session ? Date.parse(session.startedAt) : NaN;
  const end = session ? Date.parse(session.lastActivity) : NaN;
  // A terminal lifetime is not a turn duration. Show only the interval supported by observed events.
  const duration =
    Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? canvasClock(end - start)
      : null;
  return (
    <article className="canvas-agent" data-status={status} data-agent-id={agent.id}>
      <button
        className="canvas-agent-heading"
        onClick={onOpen}
        disabled={busy}
        title={t('canvas.openTerminal')}
      >
        <StatusIcon agent={agent} />
        <span>{agent.title}</span>
        {agent.minimized && <small>{t('canvas.minimized')}</small>}
      </button>
      <div className="canvas-agent-activities">
        {activities.length ? (
          activities.map((event) => (
            <div key={event.id} title={event.payload.name || event.payload.text}>
              <time dateTime={event.timestamp}>
                {Number.isFinite(start) ? canvasClock(Date.parse(event.timestamp) - start) : '—'}
              </time>
              <span>{event.payload.name || event.payload.text}</span>
            </div>
          ))
        ) : (
          <p>{t('canvas.activityUnavailable')}</p>
        )}
        <span className="canvas-agent-state">
          {t(session ? `statusLabels.${status}` : 'canvas.statusUnavailable')}
        </span>
      </div>
      <footer>
        <span className={`canvas-provider canvas-provider-${agent.provider}`} aria-hidden="true">
          {agent.provider === 'claude' ? '✳' : agent.provider === 'codex' ? '◉' : '◇'}
        </span>
        <span title={session?.model ?? undefined}>
          {session?.model ?? t('canvas.modelUnavailable')}
        </span>
        <small>
          {duration
            ? t(status === 'completed' ? 'canvas.took' : 'canvas.observed', { duration })
            : t('canvas.durationUnavailable')}
        </small>
      </footer>
      {status === 'waiting_for_user' && (
        <button className="canvas-reply" disabled={busy} onClick={onOpen}>
          {t('canvas.reply')}
        </button>
      )}
    </article>
  );
}

/** Summary DOM only. Native terminal documents are never mounted or transformed here. */
export function FeatureCanvas({
  agents,
  groups,
  onOpen,
  onPrepare,
  busy = false,
}: {
  agents: CanvasAgent[];
  groups: CanvasGroup[];
  onOpen: (agent: CanvasAgent) => void;
  onPrepare?: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<CanvasCamera>({ x: 30, y: 30, zoom: 0.9 });
  const [pan, setPan] = useState(false);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const drag = useRef<{ id: number; x: number; y: number; camera: CanvasCamera } | null>(null);
  const geometry = useMemo(() => canvasGeometry(agents, groups), [agents, groups]);
  const edges = useMemo(() => canvasEdges(agents), [agents]);
  const fitted = useRef(false);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!event.ctrlKey && !event.metaKey) {
        setCamera((value) => ({ ...value, x: value.x - event.deltaX, y: value.y - event.deltaY }));
        return;
      }
      setCamera((value) => {
        const zoom = Math.max(0.2, Math.min(2, value.zoom * (event.deltaY < 0 ? 1.1 : 0.9)));
        const ratio = zoom / value.zoom;
        return {
          x: size.width / 2 - (size.width / 2 - value.x) * ratio,
          y: size.height / 2 - (size.height / 2 - value.y) * ratio,
          zoom,
        };
      });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [size]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      setSize(next);
      if (!fitted.current && agents.length) {
        setCamera(
          next.width < 600
            ? { x: -18, y: 20, zoom: 0.85 }
            : fitCanvas(next.width, next.height, geometry),
        );
        fitted.current = true;
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [geometry, agents.length]);
  function zoomTo(zoom: number) {
    setCamera((value) => {
      const next = Math.max(0.2, Math.min(2, zoom));
      const ratio = next / value.zoom;
      return {
        x: size.width / 2 - (size.width / 2 - value.x) * ratio,
        y: size.height / 2 - (size.height / 2 - value.y) * ratio,
        zoom: next,
      };
    });
  }
  const miniScale = Math.min(132 / geometry.width, 74 / geometry.height);
  return (
    <div
      ref={viewport}
      className={`feature-canvas${pan ? ' canvas-pan' : ''}`}
      role="region"
      aria-label={t('canvas.title')}
      tabIndex={0}
      style={{
        backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const delta = {
          ArrowLeft: [40, 0],
          ArrowRight: [-40, 0],
          ArrowUp: [0, 40],
          ArrowDown: [0, -40],
        }[event.key];
        if (delta) {
          event.preventDefault();
          setCamera((value) => ({ ...value, x: value.x + delta[0]!, y: value.y + delta[1]! }));
        }
        if (event.key === '+' || event.key === '=') zoomTo(camera.zoom + 0.1);
        if (event.key === '-') zoomTo(camera.zoom - 0.1);
        if (event.key === '0') setCamera(fitCanvas(size.width, size.height, geometry));
      }}
      onPointerDown={(event) => {
        if (
          event.button !== 0 ||
          (event.target instanceof Element &&
            (event.target.closest('.canvas-toolbar, .canvas-minimap') ||
              (!pan && event.target.closest('button, article'))))
        )
          return;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, camera };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onClickCapture={(event) => {
        if (pan && event.target instanceof Element && event.target.closest('article')) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.id === event.pointerId)
          setCamera({
            ...start.camera,
            x: start.camera.x + event.clientX - start.x,
            y: start.camera.y + event.clientY - start.y,
          });
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <div
        className="canvas-world"
        style={{
          width: geometry.width,
          height: geometry.height,
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
        }}
      >
        <svg
          className="canvas-edges"
          width={geometry.width}
          height={geometry.height}
          aria-label={t('canvas.evidencedLinks')}
        >
          {edges.map((edge) => {
            const from = geometry.cards.get(edge.from);
            const to = geometry.cards.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + from.width / 2;
            const y1 = from.y + from.height;
            const x2 = to.x + to.width / 2;
            const y2 = to.y;
            return (
              <path
                key={`${edge.from}:${edge.to}`}
                d={`M ${x1} ${y1} V ${Math.min(y1 + 24, y2 - 14)} H ${to.x - 10} V ${y2 - 12} H ${x2} V ${y2}`}
              />
            );
          })}
        </svg>
        {groups.map((group) => {
          const rect = geometry.frames.get(group.id)!;
          const members = agents.filter(
            (agent) => agent.groupId === group.id && !agent.orchestrator,
          );
          return (
            <section
              className="canvas-group"
              key={group.id}
              aria-label={group.name}
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
            >
              <header>
                <h2>{group.name}</h2>
                <small>
                  {t('canvas.agents', { count: members.length })} ·{' '}
                  {t('canvas.running', {
                    count: members.filter((agent) => agent.session?.status === 'running').length,
                  })}
                  {members.some((agent) => agent.session?.status === 'waiting_for_user') && (
                    <span className="canvas-needs">
                      {' '}
                      ·{' '}
                      {t('canvas.needs', {
                        count: members.filter(
                          (agent) => agent.session?.status === 'waiting_for_user',
                        ).length,
                      })}
                    </span>
                  )}
                </small>
              </header>
            </section>
          );
        })}
        {agents.map((agent) => {
          const rect = geometry.cards.get(agent.id);
          return rect ? (
            <div
              key={agent.id}
              className="canvas-card-position"
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
            >
              <CanvasAgentCard agent={agent} busy={busy} onOpen={() => onOpen(agent)} />
            </div>
          ) : null;
        })}
      </div>
      {!agents.length && (
        <div className="canvas-empty">
          <h1>{t('canvas.emptyTitle')}</h1>
          <p>{t('canvas.emptyBody')}</p>
          {onPrepare && (
            <button disabled={busy} onClick={onPrepare}>
              <Plus size={15} />
              {t('canvas.newSession')}
            </button>
          )}
        </div>
      )}
      <button
        className="canvas-minimap"
        aria-label={t('canvas.minimap')}
        title={t('canvas.minimap')}
        onClick={(event) => {
          if (event.detail === 0) {
            setCamera(fitCanvas(size.width, size.height, geometry));
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setCamera((value) => ({
            ...value,
            x:
              size.width / 2 -
              ((((event.clientX - rect.left) * 148) / rect.width - 8) / miniScale) * value.zoom,
            y:
              size.height / 2 -
              ((((event.clientY - rect.top) * 90) / rect.height - 8) / miniScale) * value.zoom,
          }));
        }}
      >
        <svg width="148" height="90" viewBox="0 0 148 90" aria-hidden="true">
          {Array.from(geometry.frames, ([id, rect]) => (
            <rect
              key={id}
              x={8 + rect.x * miniScale}
              y={8 + rect.y * miniScale}
              width={rect.width * miniScale}
              height={rect.height * miniScale}
              className="mini-group"
            />
          ))}
          {agents.map((agent) => {
            const rect = geometry.cards.get(agent.id);
            return rect ? (
              <rect
                key={agent.id}
                x={8 + rect.x * miniScale}
                y={8 + rect.y * miniScale}
                width={rect.width * miniScale}
                height={rect.height * miniScale}
                className={agent.session?.status === 'waiting_for_user' ? 'mini-wait' : 'mini-card'}
              />
            ) : null;
          })}
          <rect
            x={8 - (camera.x / camera.zoom) * miniScale}
            y={8 - (camera.y / camera.zoom) * miniScale}
            width={(size.width / camera.zoom) * miniScale}
            height={(size.height / camera.zoom) * miniScale}
            className="mini-viewport"
          />
        </svg>
      </button>
      <div className="canvas-toolbar" role="toolbar" aria-label={t('canvas.tools')}>
        <button aria-label={t('canvas.select')} aria-pressed={!pan} onClick={() => setPan(false)}>
          <MousePointer2 size={17} />
        </button>
        <button aria-label={t('canvas.pan')} aria-pressed={pan} onClick={() => setPan(true)}>
          <Hand size={17} />
        </button>
        {onPrepare && (
          <button disabled={busy} aria-label={t('canvas.newSession')} onClick={onPrepare}>
            <Plus size={17} />
          </button>
        )}
        <span className="canvas-tool-divider" />
        <button aria-label={t('canvas.zoomOut')} onClick={() => zoomTo(camera.zoom - 0.1)}>
          <Minus size={16} />
        </button>
        <output aria-label={t('canvas.zoom')}>{Math.round(camera.zoom * 100)}%</output>
        <button aria-label={t('canvas.zoomIn')} onClick={() => zoomTo(camera.zoom + 0.1)}>
          <Plus size={16} />
        </button>
        <button
          aria-label={t('canvas.fit')}
          onClick={() => setCamera(fitCanvas(size.width, size.height, geometry))}
        >
          <Maximize size={16} />
        </button>
      </div>
    </div>
  );
}
