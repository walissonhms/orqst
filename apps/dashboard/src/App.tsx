import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Bell,
  Check,
  ChevronRight,
  Circle,
  Command,
  ExternalLink,
  Folder,
  FileText,
  GitBranch,
  Globe2,
  Layers3,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  BarChart3,
  Plus,
  Pin,
  Search,
  Settings2,
  ShieldCheck,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import type {
  AgentStatus,
  ArtifactExtractionRequest,
  Preferences,
  SessionView,
  Snapshot,
  StoredEvent,
} from '@orqst/protocol';
import {
  defaultFeatureId,
  featureDisplayName,
  featurePreparationRequestSchema,
  type FeaturePreparationRequest,
} from '@orqst/protocol';
import { api } from './api';
import { ArtifactLibrary } from './ArtifactLibrary';
import { artifactSelection } from './artifact-library';
import { ArtifactPanel, type ArtifactCloseGuard } from './ArtifactPanel';
import { LiveMetrics } from './LiveMetrics';
import { ModelHistory } from './ModelHistory';
import { ObservedTools } from './ObservedTools';
import { useSessionMetrics, type LiveMetricsState } from './use-session-metrics';
import { SessionTokenBadge } from './SessionTokenBadge';
import { ModelAnalytics } from './ModelAnalytics';
import { useObservatory } from './use-observatory';
import { isSessionLocation, sessionFromLocation } from './session-link';
import {
  DashboardHistory,
  StudioShellContext,
  viewFromLocation,
  viewPath,
  type StudioTreeProps,
} from './navigation';
import { findNotificationSource, NativeSessionNavigation } from './native-session-navigation';
import { Studio } from './Studio';
import { StudioWorkspace } from './StudioWorkspace';
import { Workspaces } from './Workspaces';
import { pinnedFirst, useWorkspacePins } from './workspace-pins';
import { OverviewLayout, type StudioCardTarget } from './OverviewLayout';
import { CommandPalette } from './CommandPalette';
import { useFeatureShell } from './use-feature-shell.js';
import { unassignedTerminalCount } from './feature-counts.js';
import { quitBlocked, type QuitBlocked } from './quit-notice.js';
import { Modal } from './Modal';
import { Settings, readStartup } from './Settings';
import { needsOnboarding, ObservationGuide } from './ObservationGuide';
import { NotificationPreferences } from './NotificationPreferences';
import { useAppearancePreferences } from './appearance-preferences';
import { isTemporaryWorkspace, shellSections, shortAge, STALE_MS } from './shell-sections';
import { appViews, readShellPreferences, shellStorageKey, type AppView } from './shell-preferences';

const viewIcons = {
  overview: Activity,
  studio: Terminal,
  workspaces: Folder,
  agents: Terminal,
  models: BarChart3,
  artifacts: FileText,
  settings: Settings2,
} satisfies Record<AppView, typeof Activity>;

const studioRoutes: readonly AppView[] = ['overview', 'studio', 'workspaces', 'settings'];

function RouteLinks({
  views,
  current,
  onNavigate,
  compact = false,
}: {
  views: readonly AppView[];
  current: AppView;
  onNavigate: (view: AppView) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('analytics.navigation')}
      className={compact ? 'studio-route-links' : undefined}
    >
      {views.map((view) => {
        const Icon = viewIcons[view];
        const label = t(`shell.views.${view}`);
        return (
          <a
            key={view}
            className={`workspace-link${view === current ? ' active' : ''}`}
            href={viewPath(view)}
            title={label}
            aria-label={label}
            aria-current={view === current ? 'page' : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onNavigate(view);
            }}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </a>
        );
      })}
    </nav>
  );
}

function useFormatting() {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en-US';
  return {
    number: (value: number) => new Intl.NumberFormat(locale).format(value),
    compact: (value: number) =>
      new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
        value,
      ),
    time: (value: string) =>
      new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(value)),
    date: (value: string) =>
      new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value)),
    duration: (session: SessionView) => {
      const seconds = Math.max(
        0,
        Math.floor((Date.parse(session.lastActivity) - Date.parse(session.startedAt)) / 1000),
      );
      return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: seconds >= 3600 ? 'hour' : seconds >= 60 ? 'minute' : 'second',
        unitDisplay: 'narrow',
        maximumFractionDigits: 1,
      }).format(seconds / (seconds >= 3600 ? 3600 : seconds >= 60 ? 60 : 1));
    },
  };
}
/** A last-known `running` without recent activity is labelled stale, never live. */
function Status({ status, lastActivity }: { status: AgentStatus; lastActivity?: string }) {
  const { t } = useTranslation();
  const stale =
    status === 'running' &&
    lastActivity !== undefined &&
    Date.now() - (Date.parse(lastActivity) || 0) > STALE_MS;
  return (
    <span
      className={`status status-${stale ? 'stale' : status}`}
      title={stale ? t('statusLabels.staleHint') : undefined}
    >
      <span className="status-dot" />
      {stale ? t('statusLabels.stale') : t(`statusLabels.${status}`)}
    </span>
  );
}
function Timeline({
  events,
  onExtract,
  extractionOpen = false,
}: {
  events: StoredEvent[];
  onExtract?: (event: StoredEvent) => void;
  extractionOpen?: boolean;
}) {
  const { t } = useTranslation();
  const f = useFormatting();
  const visible = [...events].sort(
    (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || b.sequence - a.sequence,
  );
  return (
    <div className="timeline">
      {visible.length ? (
        visible.map((event) => (
          <article
            className={`timeline-event event-${event.type.replaceAll('.', '-')}`}
            key={event.id}
          >
            <span className="timeline-marker">
              {event.type === 'agent.completed' ? (
                <Check size={12} />
              ) : event.type.includes('tool') ? (
                <Terminal size={11} />
              ) : event.type.includes('tokens') ? (
                <Zap size={11} />
              ) : (
                <Circle size={8} />
              )}
            </span>
            <div className="event-heading">
              <span className="event-title">
                {event.payload.role ? t(`roles.${event.payload.role}`) : t(`events.${event.type}`)}
                {event.payload.name && <code>{event.payload.name}</code>}
              </span>
              <time title={f.date(event.timestamp)}>{f.time(event.timestamp)}</time>
            </div>
            <div className="event-label">
              <span>{event.payload.agentName ?? event.sessionId.slice(0, 8)}</span>
              <span>·</span>
              <span>{t(`events.${event.type}`)}</span>
              {event.payload.recipient && <code>→ {event.payload.recipient}</code>}
            </div>
            {(event.payload.text || event.payload.result) && (
              <details className="event-content">
                <summary>{(event.payload.text ?? event.payload.result)?.slice(0, 180)}</summary>
                <pre className="reading-content">{event.payload.text ?? event.payload.result}</pre>
              </details>
            )}
            {onExtract && artifactSelection(event) && (
              <button
                className="button"
                disabled={extractionOpen}
                id={`artifact-extract-${event.sequence}`}
                onClick={() => onExtract(event)}
              >
                {t('artifacts.extract')}
              </button>
            )}
            {event.payload.usage && (
              <div className="event-usage">
                <Zap size={12} />
                {f.number(event.payload.usage.total)} <span>{t('tokens')}</span>
                {event.correlation.turnId && event.payload.turnUsage && (
                  <span>
                    · {t('taskTokens')}: {f.number(event.payload.turnUsage.total)}
                  </span>
                )}
              </div>
            )}
            <details className="source-detail">
              <summary>{t('source')}</summary>
              <code>
                {event.source.file}:{event.source.line} · {event.source.recordType}
                <br />
                {event.source.hash}
                <br />
                {t('correlation')}: {event.correlation.turnId ?? '—'}
                {event.correlation.callId && <> / {event.correlation.callId}</>}
              </code>
            </details>
          </article>
        ))
      ) : (
        <p className="empty-copy">{t('emptyActivity')}</p>
      )}
    </div>
  );
}
function SessionDetail({
  session,
  snapshot,
  connection,
  snapshotError,
  onClose,
  onSave,
  onMetrics,
  artifactCloseGuard,
  artifactRequest,
  onArtifact,
}: {
  session: SessionView;
  snapshot: Snapshot;
  connection: 'connecting' | 'connected' | 'offline';
  snapshotError: boolean;
  onClose: () => void;
  onSave: () => void;
  onMetrics: (sessionId: string, metrics: LiveMetricsState) => void;
  artifactCloseGuard: RefObject<ArtifactCloseGuard | null>;
  artifactRequest: ArtifactExtractionRequest | undefined;
  onArtifact: (request: ArtifactExtractionRequest | undefined) => void;
}) {
  const { t } = useTranslation();
  const f = useFormatting();
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [hasOlder, setHasOlder] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<'activity' | 'results' | 'usage' | 'observedTools'>('activity');
  const [tokenThreshold, setTokenThreshold] = useState<number>();
  const sessionHeading = useRef<HTMLHeadingElement>(null);
  const metrics = useSessionMetrics(session, snapshot, connection, snapshotError);
  useEffect(() => {
    onMetrics(session.id, metrics);
  }, [
    session.id,
    metrics.confirmed,
    metrics.result,
    metrics.pending,
    metrics.failed,
    metrics.stale,
    metrics.offline,
    onMetrics,
  ]);
  useEffect(() => {
    let active = true;
    setEvents([]);
    setHasOlder(true);
    void api<{ events: StoredEvent[] }>(
      `/api/events?sessionId=${encodeURIComponent(session.id)}&before=${Number.MAX_SAFE_INTEGER}&limit=150`,
    )
      .then((data) => {
        if (active) {
          setEvents((current) =>
            [
              ...new Map([...data.events, ...current].map((event) => [event.id, event])).values(),
            ].sort((a, b) => a.sequence - b.sequence),
          );
          setHasOlder(data.events.length === 150);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [session.id]);
  useEffect(() => {
    const latest = snapshot.events.filter((event) => event.sessionId === session.id);
    setEvents((current) =>
      [...new Map([...current, ...latest].map((event) => [event.id, event])).values()].sort(
        (a, b) => a.sequence - b.sequence,
      ),
    );
  }, [snapshot.cursor, session.id, snapshot.events]);
  async function older() {
    try {
      const first = events[0]?.sequence ?? Number.MAX_SAFE_INTEGER;
      const data = await api<{ events: StoredEvent[] }>(
        `/api/events?sessionId=${encodeURIComponent(session.id)}&before=${first}&limit=150`,
      );
      setEvents((current) =>
        [...new Map([...data.events, ...current].map((event) => [event.id, event])).values()].sort(
          (a, b) => a.sequence - b.sequence,
        ),
      );
      setHasOlder(data.events.length === 150);
    } catch {
      setError(true);
    }
  }
  async function associate(workspaceId: string) {
    try {
      await api(`/api/sessions/${encodeURIComponent(session.id)}/workspace`, {
        method: 'PUT',
        body: JSON.stringify({ workspaceId: workspaceId || null }),
      });
      onSave();
    } catch {
      setError(true);
    }
  }
  const parent = snapshot.sessions.find((item) => item.id === session.parentSessionId);
  return (
    <section className="panel session-detail" aria-label={t('details')}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{t('details')}</span>
          <h2 tabIndex={-1} ref={sessionHeading}>
            <Terminal size={19} />
            {session.agentName}
          </h2>
        </div>
        <button className="icon-button" aria-label={t('close')} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="session-meta">
        <Status status={session.status} lastActivity={session.lastActivity} />
        <code>{session.id}</code>
        <span>{f.duration(session)}</span>
        <div className="session-model">
          <span>{t('modelObservation.identifier')}: </span>
          <code>{session.model ?? t('modelObservation.notRecorded')}</code>
          <details>
            <summary>{t('modelObservation.limits')}</summary>
            <p>{t('modelObservation.historyNote')}</p>
            <p>{t('modelObservation.availabilityNote')}</p>
          </details>
        </div>
      </div>
      <LiveMetrics
        state={metrics}
        announce
        threshold={tokenThreshold}
        onThresholdChange={setTokenThreshold}
      />
      <ModelHistory
        session={session}
        cursor={snapshot.cursor}
        online={connection === 'connected' && !snapshotError}
      />
      {session.status === 'waiting_for_user' && <p className="notice">{t('interventionNote')}</p>}
      {error && (
        <p role="alert" className="notice">
          {t('savedError')}
        </p>
      )}
      <p className="session-task reading-content">{session.task ?? t('noTask')}</p>
      <div className="association">
        <label>
          {t('association')}
          <select
            aria-label={t('association')}
            value={session.manualWorkspace ? session.workspaceId : ''}
            onChange={(event) => {
              void associate(event.target.value);
            }}
          >
            <option value="">{t('automatic')}</option>
            {snapshot.workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        <span>
          <GitBranch size={14} />
          {session.parentSessionId
            ? `${t('parent')}: ${parent?.agentName ?? session.parentSessionId}`
            : t('unknownParent')}
        </span>
      </div>
      <div className="tabs">
        {(['activity', 'results', 'usage', 'observedTools'] as const).map((value) => (
          <button
            key={value}
            className={tab === value ? 'selected' : ''}
            onClick={() => setTab(value)}
          >
            {t(value === 'observedTools' ? 'observedTools.tab' : value)}
          </button>
        ))}
      </div>
      {tab === 'activity' && (
        <>
          <p className="fine-print detail-intro">{t('originalText')}</p>
          <Timeline
            events={events}
            extractionOpen={Boolean(artifactRequest)}
            onExtract={(event) => {
              onArtifact(artifactSelection(event));
            }}
          />
          {hasOlder && (
            <button
              className="button history-button"
              onClick={() => {
                void older();
              }}
            >
              {t('loadMore')}
            </button>
          )}
        </>
      )}
      {tab === 'observedTools' && (
        <ObservedTools
          events={events}
          sessionId={session.id}
          online={connection === 'connected' && !snapshotError}
          failed={error}
          hasOlder={hasOlder}
          onOlder={() => void older()}
        />
      )}
      {artifactRequest && (
        <ArtifactPanel
          request={artifactRequest}
          closeGuard={artifactCloseGuard}
          metrics={metrics}
          tokenThreshold={tokenThreshold}
          onClose={() => {
            onArtifact(undefined);
            requestAnimationFrame(() => {
              const trigger = document.getElementById(
                `artifact-extract-${artifactRequest.sequence}`,
              );
              (trigger ?? sessionHeading.current)?.focus();
            });
          }}
        />
      )}
      {tab === 'results' && (
        <div className="result-content">
          <span className="eyebrow">{t('resultTitle')}</span>
          <pre>{session.result ?? t('noResult')}</pre>
        </div>
      )}
      {tab === 'usage' && (
        <div className="usage-content">
          <h3>{t('tokenRecords')}</h3>
          <p className="fine-print">{t('noTurnTokens')}</p>
          <Timeline events={events.filter((event) => event.type === 'agent.tokens.updated')} />
          {hasOlder && (
            <button
              className="button"
              onClick={() => {
                void older();
              }}
            >
              {t('loadMore')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
export function App() {
  const { t, i18n } = useTranslation();
  const f = useFormatting();
  const appearance = useAppearancePreferences();
  const workspacePins = useWorkspacePins();
  const [shell, setShell] = useState(readShellPreferences);
  const [showAllWorkspaces, setShowAllWorkspaces] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const [workspaceId, setWorkspaceId] = useState(shell.workspaceId);
  const [view, setView] = useState<AppView>(() => {
    const explicit = viewFromLocation(location);
    if (explicit) return explicit;
    if (location.hash) return 'overview';
    const startup = readStartup();
    return startup === 'last' ? shell.view : startup;
  });
  const [studioReturn, setStudioReturn] = useState(false);
  const [preparationRequest, setPreparationRequest] = useState<FeaturePreparationRequest>();
  const showPreparation = useRef<(detail: unknown) => void>(() => {});
  useEffect(() => {
    const show = (event: Event) => showPreparation.current((event as CustomEvent).detail);
    window.addEventListener('orqst-show-preparation', show);
    return () => window.removeEventListener('orqst-show-preparation', show);
  }, []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(
    () => location.pathname === '/' && !location.hash && needsOnboarding(),
  );
  function openGuide() {
    if (needsOnboarding()) setGuideOpen(true);
  }
  function closeGuide() {
    setGuideOpen(false);
    requestAnimationFrame(() => {
      if (document.activeElement === document.body)
        document.getElementById('main-content')?.focus();
    });
  }
  const artifactCloseGuard = useRef<ArtifactCloseGuard | null>(null);
  const [artifactRequest, setArtifactRequest] = useState<ArtifactExtractionRequest>();
  const navigation = useRef<DashboardHistory | null>(null);
  useEffect(() => {
    const blocked = (event: Event) =>
      setQuitWait(quitBlocked((event as CustomEvent<unknown>).detail));
    const fenced = (event: Event) =>
      setQuitFence(Boolean((event as CustomEvent<{ fence?: boolean }>).detail?.fence));
    window.addEventListener('orqst-quit-blocked', blocked);
    window.addEventListener('orqst-terminal-fence', fenced);
    return () => {
      window.removeEventListener('orqst-quit-blocked', blocked);
      window.removeEventListener('orqst-terminal-fence', fenced);
    };
  }, []);
  const featureShell = useFeatureShell();
  const featureSnapshot = featureShell.snapshot;
  const managedShell = window.orqstFeatures?.contractVersion === 1;
  const managedStudio = managedShell && view === 'studio';
  const managedFeature = featureSnapshot?.features.find(
    (feature) => feature.featureId === featureSnapshot.activeFeatureId,
  );
  const studioScope = featureSnapshot
    ? {
        workspace: featureSnapshot.workspace,
        featureId: featureSnapshot.activeFeatureId,
        featureName: managedFeature
          ? featureDisplayName(managedFeature, t('features.defaultName'))
          : undefined,
      }
    : undefined;
  const [quitWait, setQuitWait] = useState<QuitBlocked | null>(null);
  const [quitFence, setQuitFence] = useState(false);
  const pendingSessionLink = useRef(isSessionLocation(location));
  const routeActions = useRef({
    traverse: () => {},
    guard: (_href: string, action: () => void) => action(),
  });
  useEffect(() => {
    try {
      localStorage.setItem(shellStorageKey, JSON.stringify({ ...shell, view, workspaceId }));
    } catch {
      // Disabled or full browser storage must not prevent observation.
    }
  }, [shell, view, workspaceId]);
  const [selected, setSelected] = useState<string>();
  const [headerMetrics, setHeaderMetrics] = useState<{
    sessionId: string;
    metrics: LiveMetricsState;
  }>();
  const updateHeaderMetrics = useCallback((sessionId: string, metrics: LiveMetricsState) => {
    setHeaderMetrics({ sessionId, metrics });
  }, []);
  const nativeDesktop = navigator.userAgent.includes(' ORQSTDesktop/0.1');
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationFilter, setNotificationFilter] = useState('all');
  const [markingRead, setMarkingRead] = useState(false);
  const [markReadError, setMarkReadError] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      setMenuOpen(false);
      menuTrigger.current?.focus();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);
  const [notice, setNotice] = useState('');
  const audioRef = useRef<AudioContext | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [localPrefs, setLocalPrefs] = useState<Preferences>({
    sound: false,
    completed: true,
    failed: true,
    intervention: true,
  });
  const [prefsSaving, setPrefsSaving] = useState(false);
  const sound = useCallback(async (activate = false) => {
    try {
      if (!audioRef.current && activate) audioRef.current = new AudioContext();
      const context = audioRef.current;
      if (!context) throw new Error('Audio requires user activation');
      if (activate) await context.resume();
      if (context.state !== 'running') throw new Error('Audio suspended');
      const oscillator = context.createOscillator(),
        gain = context.createGain();
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.frequency.setValueAtTime(660, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(880, context.currentTime + 0.12);
      gain.gain.setValueAtTime(0.045, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.3);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.3);
      if (activate) setNotice('soundReady');
    } catch {
      setNotice('soundBlocked');
    }
  }, []);
  const onLive = useCallback(
    (event: StoredEvent, silent: boolean) => {
      if (nativeDesktop) return;
      const key =
        event.type === 'agent.completed'
          ? 'completed'
          : event.type === 'agent.failed'
            ? 'failed'
            : event.type === 'agent.intervention.required'
              ? 'intervention'
              : null;
      if (!key) return;
      if (!silent) void sound();
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(
            t(
              key === 'completed'
                ? 'notificationCompleted'
                : key === 'failed'
                  ? 'notificationFailed'
                  : 'notificationIntervention',
            ),
            { body: event.payload.agentName ?? event.sessionId.slice(0, 8), tag: event.id },
          );
        } catch {
          setNotice('desktopBlocked');
        }
      }
    },
    [nativeDesktop, sound, t],
  );
  const { snapshot, connection, error, refresh } = useObservatory(onLive);
  const nativeNavigation = useRef<NativeSessionNavigation | null>(null);
  const nativeNavigationContext = useRef({ key: '', token: {} });
  const nativeNavigationKey = JSON.stringify([connection, workspaceId, view, selected]);
  if (nativeNavigationContext.current.key !== nativeNavigationKey)
    nativeNavigationContext.current = { key: nativeNavigationKey, token: {} };
  const nativeNavigationActions = useRef({
    context: () => nativeNavigationContext.current.token,
    refresh,
    open: (id: string, fresh: Snapshot, current: () => boolean) =>
      openSession(id, undefined, { snapshot: fresh, current }),
  });
  nativeNavigationActions.current = {
    context: () => nativeNavigationContext.current.token,
    refresh,
    open: (id, fresh, current) => openSession(id, undefined, { snapshot: fresh, current }),
  };
  useEffect(() => {
    if (!navigator.userAgent.split(/\s+/).includes('ORQSTTauri/0.1')) return;
    const navigation = new NativeSessionNavigation({
      context: () => nativeNavigationActions.current.context(),
      refresh: () => nativeNavigationActions.current.refresh(),
      open: (id, fresh, current) => nativeNavigationActions.current.open(id, fresh, current),
    });
    nativeNavigation.current = navigation;
    const select = (event: Event) => {
      const detail: unknown = event instanceof CustomEvent ? event.detail : null;
      void navigation.request(detail);
    };
    window.addEventListener('orqst-native-session', select);
    return () => {
      navigation.cancel();
      nativeNavigation.current = null;
      window.removeEventListener('orqst-native-session', select);
    };
  }, []);
  useEffect(() => nativeNavigation.current?.observe(snapshot), [snapshot]);
  function linkedDestination() {
    const id = sessionFromLocation(location, snapshot?.sessions.map((value) => value.id) ?? []);
    if (
      isSessionLocation(location) &&
      !id &&
      (!snapshot || (snapshot.diagnostics.scanning && snapshot.diagnostics.lastScan === null))
    ) {
      pendingSessionLink.current = true;
      return;
    }
    pendingSessionLink.current = false;
    const page = viewFromLocation(location) ?? view;
    if (id) {
      applySession(id);
      setWorkspaceId(snapshot?.sessions.find((session) => session.id === id)?.workspaceId ?? '');
    } else if (page === 'overview') applySession(undefined);
    if (page !== 'overview') setArtifactRequest(undefined);
    if (page === 'studio' || view === 'studio') setStudioReturn(page !== 'studio');
    setView(page);
    navigation.current?.replace(viewPath(page, id));
    setMenuOpen(false);
  }
  routeActions.current = {
    traverse: linkedDestination,
    guard: (href, action) => {
      const target = new URL(href, location.origin);
      const id = sessionFromLocation(target, snapshot?.sessions.map((value) => value.id) ?? []);
      const page = viewFromLocation(target) ?? view;
      if (page !== view || (page === 'overview' && id !== selected)) requestNavigation(action);
      else action();
    },
  };
  useEffect(() => {
    const controller = new DashboardHistory(
      (href, action) => routeActions.current.guard(href, action),
      () => routeActions.current.traverse(),
    );
    navigation.current = controller;
    routeActions.current.traverse();
    return () => {
      controller.dispose();
      navigation.current = null;
    };
  }, []);
  useEffect(() => {
    if (snapshot && pendingSessionLink.current) routeActions.current.traverse();
  }, [snapshot]);
  useEffect(() => {
    if (snapshot && !prefsSaving) setLocalPrefs(snapshot.preferences);
  }, [snapshot, prefsSaving]);
  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? 'en-US';
  }, [i18n.resolvedLanguage]);
  useEffect(() => {
    if (
      snapshot &&
      workspaceId &&
      !snapshot.workspaces.some((workspace) => workspace.id === workspaceId)
    ) {
      setWorkspaceId('');
    }
  }, [snapshot, workspaceId]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k' || event.altKey)
        return;
      // Existing modal workflows keep their own keyboard/focus ownership.
      if (document.querySelector('dialog[open]') && !paletteOpen) return;
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [paletteOpen]);
  function requestNavigation(action: () => void, navigation = true) {
    if (artifactCloseGuard.current) artifactCloseGuard.current(action, navigation);
    else action();
  }
  function applySession(id: string | undefined) {
    if (id !== selected) {
      setHeaderMetrics(undefined);
      setArtifactRequest(undefined);
    }
    setSelected(id);
  }
  function selectSession(id: string | undefined) {
    if (id === selected) return;
    requestNavigation(() => {
      applySession(id);
      navigation.current?.push(viewPath(view, id));
    }, id !== undefined);
  }
  function applyView(page: AppView, sessionId = selected) {
    if (page !== 'overview') setArtifactRequest(undefined);
    if (page === 'studio' || view === 'studio') setStudioReturn(page !== 'studio');
    setView(page);
    navigation.current?.push(viewPath(page, sessionId));
    setMenuOpen(false);
  }
  function navigate(page: AppView, focusContent = false) {
    if (page === view) return;
    requestNavigation(() => {
      applyView(page);
      if (focusContent)
        requestAnimationFrame(() => document.getElementById('main-content')?.focus());
    });
  }
  showPreparation.current = (detail) => {
    const parsed = featurePreparationRequestSchema.safeParse(detail);
    if (!parsed.success) return;
    if (parsed.data.destination && managedShell) {
      const destination = parsed.data.destination;
      if (destination === 'notifications') setNotificationOpen(true);
      else if (destination === 'search') setPaletteOpen(true);
      else
        requestNavigation(() => {
          applyView(destination, destination === 'overview' ? selected : undefined);
          setStudioReturn(true);
          requestAnimationFrame(() => document.getElementById('main-content')?.focus());
        });
      return;
    }
    if (parsed.data.destination || window.orqstTauriStudio?.contractVersion !== 1) return;
    requestNavigation(() => {
      setPreparationRequest(parsed.data);
      applyView('studio');
    });
  };
  function openWorkspace(id: string, page: AppView = view) {
    if (id === workspaceId && page === view) return;
    requestNavigation(() => {
      setWorkspaceId(id);
      applySession(undefined);
      applyView(page, '');
    });
  }
  function openSession(
    id: string,
    artifact?: ArtifactExtractionRequest,
    native?: { snapshot: Snapshot; current: () => boolean },
  ) {
    const session = (native?.snapshot ?? snapshot)?.sessions.find((item) => item.id === id);
    if (!session) return;
    const transition = () => {
      if (native && !native.current()) return;
      setWorkspaceId(session.workspaceId);
      applySession(id);
      applyView('overview', id);
      if (artifact) setArtifactRequest(artifact);
    };
    if (id === selected && view === 'overview') transition();
    else requestNavigation(transition);
  }
  const selectedSession = snapshot?.sessions.find((session) => session.id === selected);
  const currentWorkspace = snapshot?.workspaces.find((workspace) => workspace.id === workspaceId);
  const initialScan = snapshot?.diagnostics.scanning && snapshot.diagnostics.lastScan === null;
  const historyReady = !!snapshot && !initialScan;
  const offline = connection === 'offline' || error;
  const unread = snapshot?.notifications.filter((item) => !item.read).length ?? 0;
  const visibleNotifications = snapshot?.notifications.filter(
    (item) =>
      notificationFilter === 'all' ||
      (notificationFilter === 'unread' ? !item.read : item.type === notificationFilter),
  );
  async function openStudioCard(target: StudioCardTarget): Promise<boolean> {
    const native = featureShell.native;
    let current = featureShell.snapshot;
    if (!native || !current) return false;
    if (current.activeFeatureId !== target.featureId) {
      const selection = await native.request({
        action: 'select',
        contractVersion: 1,
        generation: current.generation,
        featureId: target.featureId,
        expectedRevision: current.view.revision,
      });
      if (selection.status !== 'ok' || !selection.snapshot) return false;
      current = selection.snapshot;
    }
    const member = current.features.some(
      (feature) =>
        feature.featureId === target.featureId && feature.terminalIds.includes(target.terminalId),
    );
    const slot = current.slots.find(
      (entry) => entry.terminalId === target.terminalId && !entry.closed,
    );
    if (!member || !slot || current.activeFeatureId !== target.featureId) return false;
    navigate('studio', true);
    // Resolve the slot again after Studio mounts so a concurrent layout update cannot retarget focus.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const reading = await native.request({
      action: 'snapshot',
      contractVersion: 1,
      generation: current.generation,
    });
    const next = reading.snapshot;
    const currentSlot = next?.slots.find(
      (entry) => entry.terminalId === target.terminalId && !entry.closed,
    );
    if (
      reading.status !== 'ok' ||
      !next ||
      !currentSlot ||
      next.activeFeatureId !== target.featureId ||
      !next.features.some(
        (feature) =>
          feature.featureId === target.featureId && feature.terminalIds.includes(target.terminalId),
      )
    )
      return false;
    const focus = await native.request({
      action: 'pane',
      contractVersion: 1,
      generation: next.generation,
      slot: currentSlot.slot,
      terminalId: target.terminalId,
      command: 'focus',
    });
    return focus.status === 'ok';
  }

  async function startOnboarding(path: string | undefined, skip: boolean) {
    if (path) {
      const name = path.split(/[\\/]/).filter(Boolean).at(-1)?.slice(0, 100) ?? path.slice(0, 100);
      const workspace = await api<{ id: string }>('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name, path }),
      });
      await refresh();
      setWorkspaceId(workspace.id);
    } else if (!skip && featureSnapshot && featureShell.native) {
      const general = defaultFeatureId(featureSnapshot.workspace.id);
      if (
        featureSnapshot.activeFeatureId !== general &&
        featureSnapshot.features.some(
          (feature) => feature.featureId === general && feature.status !== 'archived',
        )
      ) {
        const selection = await featureShell.native.request({
          action: 'select',
          contractVersion: 1,
          generation: featureSnapshot.generation,
          featureId: general,
          expectedRevision: featureSnapshot.view.revision,
        });
        if (selection.status !== 'ok' || selection.snapshot?.activeFeatureId !== general)
          throw new Error('Workspace Feature unavailable');
      }
    }
    navigate('studio', true);
  }
  async function markNotificationsRead() {
    setMarkingRead(true);
    setMarkReadError(false);
    try {
      await api('/api/notifications/read', { method: 'POST' });
      await refresh();
    } catch {
      setMarkReadError(true);
    } finally {
      setMarkingRead(false);
    }
  }
  async function preferences(next: Preferences) {
    setLocalPrefs(next);
    setPrefsSaving(true);
    try {
      await api('/api/preferences', { method: 'PUT', body: JSON.stringify(next) });
      await refresh();
      setSaveError(false);
    } catch {
      setSaveError(true);
      if (snapshot) setLocalPrefs(snapshot.preferences);
    } finally {
      setPrefsSaving(false);
    }
  }
  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await api('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: data.get('name'), path: data.get('path') }),
      });
      await refresh();
      setWorkspaceOpen(false);
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }
  async function desktop() {
    try {
      if (!('Notification' in window)) throw new Error('Unavailable');
      const permission = await Notification.requestPermission();
      setNotice(permission === 'granted' ? 'desktopEnabled' : 'desktopBlocked');
    } catch {
      setNotice('desktopBlocked');
    }
  }
  const notificationPreferences = (settings = false) => (
    <>
      {(!snapshot || error || connection !== 'connected') && (
        <p className="notice" role="status">
          {t('settings.notificationsUnavailable')}
        </p>
      )}
      <NotificationPreferences
        value={localPrefs}
        disabled={prefsSaving || !snapshot || error || connection !== 'connected'}
        nativeDesktop={nativeDesktop}
        settings={settings}
        onChange={(next) => {
          void preferences(next);
        }}
        onTestSound={() => {
          void sound(true);
        }}
        onPermission={() => {
          void desktop();
        }}
      />
    </>
  );
  const languageControl = (
    <label className="language-select">
      <Globe2 size={14} />
      <select
        aria-label={t('language')}
        value={i18n.resolvedLanguage ?? 'en-US'}
        onChange={(event) => {
          void i18n.changeLanguage(event.target.value);
        }}
      >
        <option value="en-US">EN</option>
        <option value="pt-BR">PT-BR</option>
      </select>
    </label>
  );
  const notificationControl = (
    <button
      className={`icon-button bell-button ${unread ? 'has-unread' : ''}`}
      aria-label={t('notifications')}
      aria-description={
        snapshot &&
        t(offline ? 'shell.notifications.staleCount' : 'notificationCounts', {
          count: unread,
        })
      }
      aria-haspopup="dialog"
      onClick={() => setNotificationOpen(true)}
    >
      <Bell size={17} />
    </button>
  );
  const studioTree: StudioTreeProps = {
    scope: studioScope,
    observedWorkspaces: snapshot?.workspaces ?? [],
    observedWorkspaceId: workspaceId,
    onObservedWorkspaceChange: (id) => openWorkspace(id),
  };
  const sideSections = shellSections(snapshot?.sessions ?? [], now);
  const hiddenWorkspaces = snapshot
    ? snapshot.workspaces.filter(
        (workspace) =>
          !workspacePins.pins.includes(workspace.id) &&
          workspace.id !== workspaceId &&
          isTemporaryWorkspace(workspace),
      ).length + Math.max(0, snapshot.workspaces.filter((w) => !isTemporaryWorkspace(w)).length - 8)
    : 0;
  return (
    <div
      className={`app-shell ${shell.collapsed ? 'sidebar-collapsed' : ''}${managedShell ? ' managed-shell' : ''}${managedStudio ? ' studio-shell' : ''}`}
    >
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        {t('shell.skip')}
      </a>
      <aside id="app-sidebar" className={`sidebar ${menuOpen ? 'mobile-open' : ''}`}>
        <a
          className="brand"
          href="/overview"
          aria-label={t('brand')}
          onClick={(event) => {
            event.preventDefault();
            navigate('overview');
          }}
        >
          <img
            className="brand-logo"
            src={
              appearance.resolvedTheme === 'dark'
                ? '/brand/orqst-logo-dark.svg'
                : '/brand/orqst-logo.svg'
            }
            width={880}
            height={270}
            alt={t('brand')}
          />
        </a>
        <button
          className="icon-button sidebar-collapse"
          aria-label={t(shell.collapsed ? 'shell.expand' : 'shell.collapse')}
          aria-expanded={!shell.collapsed}
          onClick={() => setShell((value) => ({ ...value, collapsed: !value.collapsed }))}
        >
          {shell.collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
        <div className="side-actions">
          <button className="side-row" onClick={() => setPaletteOpen(true)}>
            <Search size={15} />
            <span>{t('shell.side.search')}</span>
            <kbd>⌘K</kbd>
          </button>
          <button className="side-row" onClick={() => navigate('studio')}>
            <Plus size={15} />
            <span>{t('shell.side.newSession')}</span>
            <kbd>⌘N</kbd>
          </button>
        </div>
        <RouteLinks
          views={managedShell ? appViews.filter((page) => !studioRoutes.includes(page)) : appViews}
          current={view}
          onNavigate={navigate}
        />
        {(
          [
            ['needsYou', sideSections.needsYou],
            ['running', sideSections.running],
            ['recent', sideSections.recent],
          ] as const
        ).map(([key, list]) => (
          <details key={key} className="side-section" open>
            <summary>
              <span>{t(`shell.side.${key}`)}</span>
              <small>{key === 'recent' ? list.length : list.length}</small>
            </summary>
            {list.length === 0 ? (
              <p className="side-empty">
                {key === 'running' && sideSections.stale > 0
                  ? t('shell.side.staleOnly', { count: sideSections.stale })
                  : '—'}
              </p>
            ) : (
              list.map((session) => (
                <button
                  key={session.id}
                  className={`side-session side-${key === 'recent' && session.status === 'running' ? 'stale' : session.status}${selected === session.id ? ' active' : ''}`}
                  title={session.task ?? session.agentName}
                  onClick={() => openSession(session.id)}
                >
                  <span className="side-dot" aria-hidden="true" />
                  <span className="side-title">{session.task ?? session.agentName}</span>
                  <small>{shortAge(session.lastActivity, now)}</small>
                </button>
              ))
            )}
            {key === 'running' && sideSections.stale > 0 && list.length > 0 && (
              <p className="side-empty">{t('shell.side.stale', { count: sideSections.stale })}</p>
            )}
          </details>
        ))}
        <div className="nav-heading">
          <span>{t('workspaceNav')}</span>
          <button
            className="icon-button"
            aria-label={t('createWorkspace')}
            onClick={() => setWorkspaceOpen(true)}
          >
            <Plus size={15} />
          </button>
        </div>
        <nav aria-label={t('workspaceNav')}>
          <button
            aria-label={t('allWorkspaces')}
            title={t('allWorkspaces')}
            className={`workspace-link ${!workspaceId ? 'active' : ''}`}
            onClick={() => {
              openWorkspace('');
            }}
          >
            <Layers3 size={16} />
            <span>{t('allWorkspaces')}</span>
            <small>{snapshot?.sessions.length ?? 0}</small>
          </button>
          {snapshot &&
            pinnedFirst(snapshot.workspaces, workspacePins.pins)
              .filter(
                (workspace) =>
                  showAllWorkspaces ||
                  workspace.id === workspaceId ||
                  workspacePins.pins.includes(workspace.id) ||
                  !isTemporaryWorkspace(workspace),
              )
              .slice(0, showAllWorkspaces ? undefined : 8)
              .map((workspace) => (
                <button
                  key={workspace.id}
                  className={`workspace-link ${workspaceId === workspace.id ? 'active' : ''}`}
                  title={workspace.path}
                  aria-label={
                    workspacePins.pins.includes(workspace.id)
                      ? t('shell.workspaces.pinnedName', { name: workspace.name })
                      : workspace.name
                  }
                  onClick={() => {
                    openWorkspace(workspace.id);
                  }}
                >
                  {workspacePins.pins.includes(workspace.id) ? (
                    <Pin size={16} aria-hidden="true" />
                  ) : (
                    <Folder size={16} />
                  )}
                  <span>{workspace.name}</span>
                  <small>{workspace.sessions}</small>
                </button>
              ))}
          {snapshot && hiddenWorkspaces > 0 && (
            <button className="side-more" onClick={() => setShowAllWorkspaces((value) => !value)}>
              {showAllWorkspaces
                ? t('shell.side.showFewer')
                : t('shell.side.showAll', { count: hiddenWorkspaces })}
            </button>
          )}
        </nav>
        {featureShell.snapshot && (
          <>
            <div className="nav-heading">
              <span>{t('features.heading')}</span>
            </div>
            <nav aria-label={t('features.heading')}>
              {featureShell.snapshot.features.map((feature) => (
                <button
                  key={feature.featureId}
                  className={`workspace-link ${feature.featureId === featureShell.snapshot?.activeFeatureId ? 'active' : ''}`}
                  aria-current={
                    feature.featureId === featureShell.snapshot?.activeFeatureId
                      ? 'page'
                      : undefined
                  }
                  disabled={featureShell.busy}
                  title={`${feature.description}\n${t(`features.status_${feature.status}`)}`}
                  onClick={() => void featureShell.select(feature.featureId)}
                >
                  <Layers3 size={16} />
                  <span>{feature.name}</span>
                  <small>{feature.terminalIds.length}</small>
                </button>
              ))}
              <button
                className={`workspace-link ${featureShell.snapshot.activeFeatureId === null ? 'active' : ''}`}
                disabled={featureShell.busy}
                onClick={() => void featureShell.select(null)}
              >
                <Layers3 size={16} />
                <span>{t('features.unassigned')}</span>
                <small>{unassignedTerminalCount(featureShell.snapshot)}</small>
              </button>
            </nav>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="local-badge" title={t('localPrivacy')}>
            <ShieldCheck size={14} />
            <span>{t('localEdition')}</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        {!managedStudio && (
          <header className="topbar">
            {managedShell && (
              <RouteLinks views={studioRoutes} current={view} onNavigate={navigate} compact />
            )}
            <div className="breadcrumbs">
              <button
                ref={menuTrigger}
                className="icon-button menu-toggle"
                aria-label={t('workspaceNav')}
                aria-controls="app-sidebar"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(!menuOpen)}
              >
                <Menu size={18} />
              </button>
              <Command size={15} aria-hidden="true" />
              <span>{currentWorkspace?.name ?? t('allWorkspaces')}</span>
              <ChevronRight size={14} aria-hidden="true" />
              <strong>{t(`shell.views.${view}`)}</strong>
            </div>
            <div className="topbar-actions">
              {window.orqstManagedAgents?.contractVersion === 1 && (
                <button
                  className="button"
                  onClick={() => {
                    void window.orqstManagedAgents
                      ?.open()
                      .then((reply) => {
                        if (reply?.status && reply.status !== 'ok')
                          setNotice(
                            reply.status === 'focus_required'
                              ? 'managedAgents.open_focus_required'
                              : 'managedAgents.open_unavailable',
                          );
                        else setNotice('');
                      })
                      .catch(() => setNotice('managedAgents.open_unavailable'));
                  }}
                >
                  <Terminal size={15} />
                  {t('managedAgents.title')}
                </button>
              )}
              <button
                className="button command-trigger"
                aria-label={t('shell.palette.title')}
                aria-keyshortcuts="Meta+K Control+K"
                onClick={() => setPaletteOpen(true)}
              >
                <Search size={15} />
                <span>{t('shell.palette.shortLabel')}</span>
                <kbd>{t('shell.palette.shortcut')}</kbd>
              </button>
              <span className={`connection connection-${connection}`} role="status">
                <span className="tiny-dot" />
                {t(connection)}
              </span>
              {!managedShell && (
                <button
                  className="icon-button"
                  aria-label={t('shell.views.settings')}
                  onClick={() => navigate('settings')}
                >
                  <Settings2 size={17} />
                </button>
              )}
              {languageControl}
              {notificationControl}
            </div>
          </header>
        )}
        {(quitWait || quitFence) && (
          <div className="quit-blocked" role="alert">
            <strong>{t(quitFence ? 'quitBlocked.fence' : 'quitBlocked.title')}</strong>
            {quitWait && (
              <>
                <span>{t(`quitBlocked.${quitWait.reason}`)}</span>
                {quitWait.uncertain.length > 0 && (
                  <ul>
                    {quitWait.uncertain.map((entry) => (
                      <li key={entry.slot}>{`${entry.slot}: ${entry.reason}`}</li>
                    ))}
                  </ul>
                )}
                <span>{t('quitBlocked.retry')}</span>
              </>
            )}
          </div>
        )}
        {selectedSession && view === 'overview' && (
          <div
            className="session-context-bar"
            aria-label={t('shell.metrics.context')}
            role="region"
          >
            <span className="session-context-name" title={selectedSession.agentName}>
              {selectedSession.agentName}
            </span>
            <span className="session-context-model" title={t('modelObservation.availabilityNote')}>
              {selectedSession.adapter} · {t('modelObservation.identifier')}:{' '}
              <code>{selectedSession.model ?? t('modelObservation.notRecorded')}</code>
            </span>
            <Status status={selectedSession.status} />
            <SessionTokenBadge
              state={
                headerMetrics?.sessionId === selectedSession.id ? headerMetrics.metrics : undefined
              }
              offline={connection !== 'connected' || error}
            />
          </div>
        )}
        <main id="main-content" tabIndex={-1}>
          {!managedStudio && (error || saveError) && view !== 'overview' && (
            <p className="notice" role="alert">
              {t(saveError ? 'savedError' : 'error')}
            </p>
          )}
          {!managedStudio && !snapshot && !error && view !== 'models' && view !== 'settings' && (
            <p className="notice" role="status">
              {t('shell.loading')}
            </p>
          )}
          {!managedStudio && initialScan && (
            <p className="notice" role="status">
              {t('syncing')}
            </p>
          )}
          {!managedStudio && notice && !notificationOpen && (
            <div className="notice" role="status">
              {t(notice)}
              <button className="icon-button" aria-label={t('close')} onClick={() => setNotice('')}>
                <X size={14} />
              </button>
            </div>
          )}

          {view === 'studio' ? (
            managedStudio ? (
              <StudioShellContext.Provider
                value={{
                  tree: studioTree,
                  navigate,
                  openNotifications: () => setNotificationOpen(true),
                  openSearch: () => setPaletteOpen(true),
                }}
              >
                <StudioWorkspace
                  preparationRequest={preparationRequest}
                  onPreparationHandled={() => setPreparationRequest(undefined)}
                  navigation={
                    <>
                      <RouteLinks
                        views={studioRoutes.filter((route) => route !== 'studio')}
                        current={view}
                        onNavigate={(page) => navigate(page, true)}
                        compact
                      />
                      <button
                        type="button"
                        className="icon-button"
                        title={t('shell.palette.title')}
                        aria-label={t('shell.palette.title')}
                        aria-keyshortcuts="Meta+K Control+K"
                        aria-haspopup="dialog"
                        onClick={() => setPaletteOpen(true)}
                      >
                        <Search size={16} aria-hidden="true" />
                      </button>
                      {notificationControl}
                    </>
                  }
                  toolbarUtilities={
                    <div className="feature-toolbar-utilities">{languageControl}</div>
                  }
                  workspaces={studioTree.observedWorkspaces}
                  workspaceId={studioTree.observedWorkspaceId}
                  onWorkspace={studioTree.onObservedWorkspaceChange}
                />
              </StudioShellContext.Provider>
            ) : (
              <Studio />
            )
          ) : view === 'settings' || view === 'agents' ? (
            <Settings
              appearance={appearance.appearance}
              onAppearance={appearance.setAppearance}
              storageUnavailable={appearance.storageUnavailable}
              systemReducedMotion={appearance.systemReducedMotion}
              key={view}
              initialTab={view === 'agents' ? 'agents' : undefined}
              notifications={notificationPreferences(true)}
              catalogScope={
                featureSnapshot && {
                  workspaceId: featureSnapshot.workspace.id,
                  featureId: featureSnapshot.activeFeatureId,
                }
              }
              defaultFolder={currentWorkspace?.path}
              snapshot={snapshot}
              returnAction={
                studioReturn
                  ? { label: t('shell.views.studio'), onReturn: () => navigate('studio', true) }
                  : undefined
              }
            />
          ) : view === 'models' ? (
            <ModelAnalytics
              scope={featureSnapshot}
              workspaceId={workspaceId}
              snapshot={snapshot}
              connection={connection}
              snapshotError={error}
            />
          ) : view === 'artifacts' ? (
            <ArtifactLibrary
              key={workspaceId}
              snapshot={snapshot}
              scope={featureSnapshot}
              workspaceId={workspaceId}
              online={connection === 'connected' && !error}
              selection={artifactRequest}
              closeGuard={artifactCloseGuard}
              onOpen={(request) => requestNavigation(() => setArtifactRequest(request), false)}
              onClose={() => setArtifactRequest(undefined)}
            />
          ) : view === 'workspaces' ? (
            snapshot && (
              <Workspaces
                snapshot={snapshot}
                activeId={workspaceId}
                pins={workspacePins}
                layout={shell.workspaceLayout}
                sort={shell.workspaceSort}
                onLayout={(value) =>
                  setShell((previous) => ({ ...previous, workspaceLayout: value }))
                }
                onSort={(value) => setShell((previous) => ({ ...previous, workspaceSort: value }))}
                onOpen={(id) => openWorkspace(id, 'overview')}
                onAnalytics={(id) => openWorkspace(id, 'models')}
                onCreate={() => setWorkspaceOpen(true)}
              />
            )
          ) : selectedSession && snapshot ? (
            <SessionDetail
              key={selectedSession.id}
              session={selectedSession}
              snapshot={snapshot}
              connection={connection}
              snapshotError={error}
              onMetrics={updateHeaderMetrics}
              artifactCloseGuard={artifactCloseGuard}
              artifactRequest={artifactRequest}
              onArtifact={setArtifactRequest}
              onClose={() => selectSession(undefined)}
              onSave={() => {
                void refresh();
              }}
            />
          ) : (
            <OverviewLayout
              scope={featureSnapshot}
              snapshot={snapshot}
              online={connection === 'connected' && !error}
              onRefresh={refresh}
              onOpen={openStudioCard}
            />
          )}
        </main>
        <footer className="status-bar" aria-label={t('shell.side.status')}>
          <span className="status-item status-running">
            <span className="side-dot" aria-hidden="true" />
            {t('shell.side.runningCount', { count: sideSections.running.length })}
          </span>
          {sideSections.needsYou.length > 0 && (
            <span className="status-item status-attention">
              {t('shell.side.needsYouCount', { count: sideSections.needsYou.length })}
            </span>
          )}
          <span className="status-spacer" />
          <span className={`status-item connection-${connection}`}>
            <span className="tiny-dot" />
            {t(connection)}
          </span>
          <span className="status-item">{t('localEdition')}</span>
        </footer>
        <footer className="app-footer">
          <span>
            <span className="brand-dot" />
            {t('brand')}
            <span className="version">v0.1.0</span>
          </span>
          <span>
            <ShieldCheck size={12} />
            {t('localPrivacy')}
          </span>
        </footer>
      </div>
      {paletteOpen && (
        <CommandPalette
          snapshot={snapshot}
          studioScope={studioScope}
          onNavigate={navigate}
          onWorkspace={(id) => openWorkspace(id, 'overview')}
          onSession={openSession}
          onNotifications={() => setNotificationOpen(true)}
          onCreate={() => setWorkspaceOpen(true)}
          onGuide={openGuide}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {guideOpen && (
        <ObservationGuide
          scope={
            featureSnapshot && {
              workspaceId: featureSnapshot.workspace.id,
              featureId: featureSnapshot.activeFeatureId,
            }
          }
          workspaceName={featureSnapshot?.workspace.name}
          canCreateWorkspace={!managedShell && !!snapshot && connection === 'connected' && !error}
          onStart={startOnboarding}
          onClose={closeGuide}
        />
      )}
      {notificationOpen && (
        <Modal
          label={t('notifications')}
          className="notification-drawer shell-dialog"
          onClose={() => setNotificationOpen(false)}
        >
          <div className="panel-heading">
            <h2>
              <Bell size={18} />
              {t('notifications')}
            </h2>
            <button
              className="icon-button"
              aria-label={t('close')}
              onClick={() => setNotificationOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="drawer-body">
            {notice && (
              <p className="notice" role="status">
                {t(notice)}
              </p>
            )}
            {saveError && (
              <p className="notice" role="alert">
                {t('savedError')}
              </p>
            )}
            {offline && (
              <p className="notice" role="status">
                {t(snapshot ? 'shell.notifications.stale' : 'shell.notifications.unavailable')}
              </p>
            )}
            {markReadError && (
              <p className="notice" role="alert">
                {t('shell.notifications.markReadFailed')}
              </p>
            )}
            {snapshot && (
              <div className="drawer-subheading">
                <span>{t('notificationCounts', { count: unread })}</span>
                <button
                  className="text-button"
                  disabled={connection !== 'connected' || error || markingRead || unread === 0}
                  onClick={() => void markNotificationsRead()}
                >
                  {t('markRead')}
                </button>
              </div>
            )}
            <label className="notification-filter">
              {t('shell.notifications.filter')}
              <select
                value={notificationFilter}
                onChange={(event) => setNotificationFilter(event.target.value)}
              >
                <option value="all">{t('shell.notifications.all')}</option>
                <option value="unread">{t('shell.notifications.unread')}</option>
                <option value="agent.completed">{t('events.agent.completed')}</option>
                <option value="agent.failed">{t('events.agent.failed')}</option>
                <option value="agent.intervention.required">
                  {t('events.agent.intervention.required')}
                </option>
              </select>
            </label>
            {snapshot && visibleNotifications?.length ? (
              visibleNotifications.map((item) => {
                const session = findNotificationSource(snapshot, item.sessionId);
                const workspace = snapshot.workspaces.find(
                  (entry) => entry.id === session?.workspaceId,
                );
                return (
                  <button
                    className={`notification-item notification-${item.type.replaceAll('.', '-')} ${item.read ? 'read' : ''}`}
                    disabled={!session}
                    title={t(session ? 'viewSession' : 'shell.notifications.sourceMissing')}
                    key={item.id}
                    onClick={() => {
                      openSession(item.sessionId);
                      setNotificationOpen(false);
                    }}
                  >
                    <span className="tiny-dot" aria-hidden="true" />
                    <span>
                      <strong>{t(`events.${item.type}`)}</strong>
                      <small>{session?.agentName ?? item.sessionId.slice(0, 8)}</small>
                      <small>{workspace?.name ?? t('unknown')}</small>
                      <time dateTime={item.timestamp}>{f.date(item.timestamp)}</time>
                      <span className="sr-only">
                        {t(
                          item.read ? 'shell.notifications.read' : 'shell.notifications.itemUnread',
                        )}
                      </span>
                    </span>
                    <ExternalLink size={14} aria-hidden="true" />
                  </button>
                );
              })
            ) : snapshot?.notifications.length || (historyReady && !offline) ? (
              <p className="empty-copy">
                {t(
                  snapshot?.notifications.length
                    ? 'shell.notifications.noMatches'
                    : 'notificationEmpty',
                )}
              </p>
            ) : (
              !offline && (
                <p className="empty-copy" role="status">
                  {t('shell.notifications.loading')}
                </p>
              )
            )}
            {notificationPreferences()}
          </div>
        </Modal>
      )}
      {workspaceOpen && (
        <Modal
          label={t('createWorkspace')}
          className="workspace-dialog shell-dialog"
          initialFocus="input"
          onClose={() => setWorkspaceOpen(false)}
        >
          <form
            className="workspace-modal panel"
            onSubmit={(event) => {
              void createWorkspace(event);
            }}
          >
            <div className="panel-heading">
              <h2>
                <Folder size={18} />
                {t('createWorkspace')}
              </h2>
              <button
                type="button"
                className="icon-button"
                aria-label={t('close')}
                onClick={() => setWorkspaceOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              {saveError && (
                <p className="notice" role="alert">
                  {t('savedError')}
                </p>
              )}
              <label>
                {t('workspaceName')}
                <input name="name" required maxLength={100} />
              </label>
              <label>
                {t('workspacePath')}
                <input name="path" required maxLength={4096} />
              </label>
              <div className="modal-actions">
                <button type="button" className="button" onClick={() => setWorkspaceOpen(false)}>
                  {t('cancel')}
                </button>
                <button type="submit" className="button primary">
                  {t('save')}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
