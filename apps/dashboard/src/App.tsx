import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Check,
  CheckCircle2,
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
  Radio,
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
  Usage,
} from '@orqst/protocol';
import { featurePreparationRequestSchema, type FeaturePreparationRequest } from '@orqst/protocol';
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
import { DashboardHistory, viewFromLocation, viewPath } from './navigation';
import { NativeSessionNavigation } from './native-session-navigation';
import { Agents } from './Agents';
import { Studio } from './Studio';
import { StudioWorkspace } from './StudioWorkspace';
import { Workspaces } from './Workspaces';
import { pinnedFirst, useWorkspacePins } from './workspace-pins';
import { OverviewLayoutEditor, OverviewPanels } from './OverviewLayout';
import { useOverviewPreferences } from './overview-preferences';
import { CommandPalette } from './CommandPalette';
import { useFeatureShell } from './use-feature-shell.js';
import { unassignedTerminalCount } from './feature-counts.js';
import { Modal } from './Modal';
import { Settings } from './Settings';
import { ObservationGuide } from './ObservationGuide';
import { NotificationPreferences } from './NotificationPreferences';
import { useAppearancePreferences } from './appearance-preferences';
import { appViews, readShellPreferences, shellStorageKey, type AppView } from './shell-preferences';

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
function Status({ status }: { status: AgentStatus }) {
  const { t } = useTranslation();
  return (
    <span className={`status status-${status}`}>
      <span className="status-dot" />
      {t(`statusLabels.${status}`)}
    </span>
  );
}
function TokenSummary({ usage }: { usage: Usage }) {
  const { t } = useTranslation();
  const f = useFormatting();
  return (
    <>
      <div className="token-total">
        {f.number(usage.total)}
        <span>{t('tokens')}</span>
      </div>
      <div className="token-metrics">
        <div>
          <ArrowDownLeft size={15} />
          <span>{t('input')}</span>
          <strong>{f.number(usage.input)}</strong>
        </div>
        <div>
          <ArrowUpRight size={15} />
          <span>{t('output')}</span>
          <strong>{f.number(usage.output)}</strong>
        </div>
        <div>
          <Layers3 size={15} />
          <span>{t('cached')}</span>
          <strong>{f.number(usage.cached)}</strong>
        </div>
      </div>
      <p className="fine-print">{t('cachedNote')}</p>
    </>
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
        <Status status={session.status} />
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
  const overview = useOverviewPreferences();
  const workspacePins = useWorkspacePins();
  const [overviewLayoutOpen, setOverviewLayoutOpen] = useState(false);
  const overviewLayoutTrigger = useRef<HTMLButtonElement>(null);
  const overviewLayoutOpener = useRef<Element | null>(null);
  function openOverviewLayout() {
    overviewLayoutOpener.current = document.activeElement;
    setOverviewLayoutOpen(true);
  }
  function closeOverviewLayout() {
    setOverviewLayoutOpen(false);
    requestAnimationFrame(() => {
      if (!overviewLayoutOpener.current?.isConnected) overviewLayoutTrigger.current?.focus();
    });
  }
  const [shell, setShell] = useState(readShellPreferences);
  const [workspaceId, setWorkspaceId] = useState(shell.workspaceId);
  const [view, setView] = useState<AppView>(
    viewFromLocation(location) ?? (location.hash ? 'overview' : shell.view),
  );
  const [preparationRequest, setPreparationRequest] = useState<FeaturePreparationRequest>();
  const showPreparation = useRef<(detail: unknown) => void>(() => {});
  useEffect(() => {
    const show = (event: Event) => showPreparation.current((event as CustomEvent).detail);
    window.addEventListener('orqst-show-preparation', show);
    return () => window.removeEventListener('orqst-show-preparation', show);
  }, []);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(shell.status);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
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
  const featureShell = useFeatureShell();
  const pendingSessionLink = useRef(isSessionLocation(location));
  const routeActions = useRef({
    traverse: () => {},
    guard: (_href: string, action: () => void) => action(),
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        shellStorageKey,
        JSON.stringify({ ...shell, view, workspaceId, status }),
      );
    } catch {
      // Disabled or full browser storage must not prevent observation.
    }
  }, [shell, view, workspaceId, status]);
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
  const prefsRef = useRef<Preferences>({
    sound: false,
    completed: true,
    failed: true,
    intervention: true,
  });
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
    (event: StoredEvent) => {
      if (nativeDesktop) return;
      const key =
        event.type === 'agent.completed'
          ? 'completed'
          : event.type === 'agent.failed'
            ? 'failed'
            : event.type === 'agent.intervention.required'
              ? 'intervention'
              : null;
      if (!key || !prefsRef.current[key]) return;
      if (prefsRef.current.sound) void sound();
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
    if (!navigator.userAgent.includes(' ORQSTTauri/0.1')) return;
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
    if (isSessionLocation(location) && !snapshot) {
      pendingSessionLink.current = true;
      return;
    }
    pendingSessionLink.current = false;
    const id = sessionFromLocation(location, snapshot?.sessions.map((value) => value.id) ?? []);
    const page = viewFromLocation(location) ?? view;
    if (id) {
      applySession(id);
      setWorkspaceId(snapshot?.sessions.find((session) => session.id === id)?.workspaceId ?? '');
      setQuery('');
      setStatus('');
    } else if (page === 'overview') applySession(undefined);
    if (page !== 'overview') setArtifactRequest(undefined);
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
    prefsRef.current = localPrefs;
  }, [localPrefs]);
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
    if (window.orqstTauriStudio?.contractVersion !== 1) return;
    const parsed = featurePreparationRequestSchema.safeParse(detail);
    if (!parsed.success) return;
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
      setQuery('');
      setStatus('');
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
      setQuery('');
      setStatus('');
      applySession(id);
      applyView('overview', id);
      if (artifact) setArtifactRequest(artifact);
    };
    if (id === selected && view === 'overview') transition();
    else requestNavigation(transition);
  }
  const sessions =
    snapshot?.sessions.filter((session) => !workspaceId || session.workspaceId === workspaceId) ??
    [];
  const filtered = sessions.filter(
    (session) =>
      (!status || session.status === status) &&
      `${session.agentName} ${session.task ?? ''} ${session.id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const attention = sessions.filter(
    (session) => session.status === 'waiting_for_user' || session.status === 'failed',
  );
  const selectedSession = snapshot?.sessions.find((session) => session.id === selected);
  const usage = sessions.reduce(
    (sum, session) => ({
      input: sum.input + session.usage.input,
      output: sum.output + session.usage.output,
      cached: sum.cached + session.usage.cached,
      total: sum.total + session.usage.total,
    }),
    { input: 0, output: 0, cached: 0, total: 0 },
  );
  const currentWorkspace = snapshot?.workspaces.find((workspace) => workspace.id === workspaceId);
  const recent = (snapshot?.events ?? []).filter(
    (event) => !workspaceId || sessions.some((session) => session.id === event.sessionId),
  );
  const unread = snapshot?.notifications.filter((item) => !item.read).length ?? 0;
  async function preferences(next: Preferences) {
    setLocalPrefs(next);
    prefsRef.current = next;
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
  const notificationPreferences = (
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
  return (
    <div
      className={`app-shell ${shell.collapsed ? 'sidebar-collapsed' : ''}${view === 'studio' && window.orqstFeatures?.contractVersion === 1 ? ' studio-shell' : ''}`}
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
        <p className="brand-tagline">{t('tagline')}</p>
        <button
          className="icon-button sidebar-collapse"
          aria-label={t(shell.collapsed ? 'shell.expand' : 'shell.collapse')}
          aria-expanded={!shell.collapsed}
          onClick={() => setShell((value) => ({ ...value, collapsed: !value.collapsed }))}
        >
          {shell.collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
        <nav aria-label={t('analytics.navigation')}>
          {appViews.map((page) => (
            <a
              key={page}
              className={`workspace-link ${view === page ? 'active' : ''}`}
              href={viewPath(page)}
              title={t(`shell.views.${page}`)}
              aria-label={t(`shell.views.${page}`)}
              aria-current={view === page ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigate(page);
              }}
            >
              {page === 'settings' ? (
                <Settings2 size={16} />
              ) : page === 'models' ? (
                <BarChart3 size={16} />
              ) : page === 'workspaces' ? (
                <Folder size={16} />
              ) : page === 'artifacts' ? (
                <FileText size={16} />
              ) : page === 'agents' || page === 'studio' ? (
                <Terminal size={16} />
              ) : (
                <Activity size={16} />
              )}
              <span>{t(`shell.views.${page}`)}</span>
            </a>
          ))}
        </nav>
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
            pinnedFirst(snapshot.workspaces, workspacePins.pins).map((workspace) => (
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
          <div className="integration-heading">{t('integration')}</div>
          {snapshot?.adapters.map((adapter) => (
            <div className="integration-item" key={adapter.id}>
              <span className={`tiny-dot ${adapter.implemented ? 'green' : ''}`} />
              <span>{t(`shell.adapters.${adapter.id}`, { defaultValue: adapter.id })}</span>
              <small>{t(adapter.implemented ? 'implemented' : 'planned')}</small>
            </div>
          ))}
          <div className="local-badge">
            <ShieldCheck size={16} />
            <span>{t('localEdition')}</span>
          </div>
          <p>{t('localPrivacy')}</p>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
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
            <Command size={15} />
            <span>{currentWorkspace?.name ?? t('allWorkspaces')}</span>
            <ChevronRight size={14} />
            <strong>{t(`shell.views.${view}`)}</strong>
            {featureShell.snapshot && (
              <>
                <ChevronRight size={14} />
                <span>
                  {featureShell.snapshot.features.find(
                    (feature) => feature.featureId === featureShell.snapshot?.activeFeatureId,
                  )?.name ?? t('features.unassigned')}
                </span>
                <ChevronRight size={14} />
                <span>
                  {t('features.terminalCount', {
                    count:
                      featureShell.snapshot.features.find(
                        (feature) => feature.featureId === featureShell.snapshot?.activeFeatureId,
                      )?.terminalIds.length ?? 0,
                  })}
                </span>
              </>
            )}
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
            <button
              className="icon-button"
              aria-label={t('shell.views.settings')}
              onClick={() => navigate('settings')}
            >
              <Settings2 size={17} />
            </button>
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
            <button
              className={`icon-button bell-button ${unread ? 'has-unread' : ''}`}
              aria-label={t('notifications')}
              onClick={() => setNotificationOpen(!notificationOpen)}
            >
              <Bell size={17} />
            </button>
          </div>
        </header>
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
          {(error || saveError) && view !== 'overview' && (
            <p className="notice" role="alert">
              {t(saveError ? 'savedError' : 'error')}
            </p>
          )}
          {!snapshot && !error && view !== 'models' && view !== 'settings' && (
            <p className="notice" role="status">
              {t('shell.loading')}
            </p>
          )}
          {notice && !notificationOpen && (
            <div className="notice" role="status">
              {t(notice)}
              <button className="icon-button" aria-label={t('close')} onClick={() => setNotice('')}>
                <X size={14} />
              </button>
            </div>
          )}

          {view === 'studio' ? (
            window.orqstFeatures?.contractVersion === 1 ? (
              <StudioWorkspace
                preparationRequest={preparationRequest}
                onPreparationHandled={() => setPreparationRequest(undefined)}
                onOverview={() => navigate('overview')}
                workspaces={snapshot?.workspaces ?? []}
                workspaceId={workspaceId}
                onWorkspace={setWorkspaceId}
              />
            ) : (
              <Studio />
            )
          ) : view === 'settings' ? (
            <Settings
              appearance={appearance.appearance}
              onAppearance={appearance.setAppearance}
              storageUnavailable={appearance.storageUnavailable}
              systemReducedMotion={appearance.systemReducedMotion}
              notifications={notificationPreferences}
              onGuide={() => setGuideOpen(true)}
            />
          ) : view === 'models' ? (
            <ModelAnalytics
              workspaceId={workspaceId}
              snapshot={snapshot}
              connection={connection}
              snapshotError={error}
            />
          ) : view === 'artifacts' ? (
            snapshot && (
              <ArtifactLibrary
                key={workspaceId}
                snapshot={snapshot}
                workspaceId={workspaceId}
                online={connection === 'connected' && !error}
                onOpen={(request) => openSession(request.sessionId, request)}
              />
            )
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
          ) : view === 'agents' ? (
            snapshot && <Agents snapshot={snapshot} />
          ) : (
            <>
              <div className="page-heading overview-heading">
                <div>
                  <span className="eyebrow">
                    <Radio size={12} />
                    {t('readOnly')}
                  </span>
                  <h1>{t('heading')}</h1>
                  <p>{t('description')}</p>
                </div>
                <button ref={overviewLayoutTrigger} className="button" onClick={openOverviewLayout}>
                  <Settings2 size={16} />
                  {t('overviewLayout.title')}
                </button>
              </div>
              {(error || saveError) && (
                <p className="notice" role="alert">
                  {t(saveError ? 'savedError' : 'error')}
                </p>
              )}
              <section className="stats" aria-label={t('overview')}>
                <div className="stat">
                  <span>
                    {t('sessions')}
                    <Terminal size={15} />
                  </span>
                  <strong>{f.number(sessions.length)}</strong>
                  <small>{currentWorkspace?.name ?? t('allWorkspaces')}</small>
                </div>
                <div className="stat">
                  <span>
                    {t('running')}
                    <Activity size={15} />
                  </span>
                  <strong>
                    {f.number(sessions.filter((session) => session.status === 'running').length)}
                    {sessions.some((session) => session.status === 'running') && (
                      <i className="stat-live" aria-hidden="true" />
                    )}
                  </strong>
                  <small>{t('latest')}</small>
                </div>
                <div className="stat">
                  <span>
                    {t('attention')}
                    <Bell size={15} />
                  </span>
                  <strong className={attention.length ? 'amber-text' : ''}>
                    {f.number(attention.length)}
                  </strong>
                  <small>{t('liveOnly')}</small>
                </div>
                <div className="stat">
                  <span>
                    {t('tokens')}
                    <Zap size={15} />
                  </span>
                  <strong>{f.compact(usage.total)}</strong>
                  <small>{t('tokenScope')}</small>
                </div>
              </section>
              <section className="panel agents-panel">
                <div className="panel-heading">
                  <h2>
                    <Terminal size={17} />
                    {t('agents')}
                    <span className="count-badge">{sessions.length}</span>
                  </h2>
                  <span className="subtle-label">{t('latest')}</span>
                </div>
                <div className="filters">
                  <label className="search-box">
                    <Search size={15} />
                    <input
                      aria-label={t('search')}
                      placeholder={t('search')}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <label className="status-filter">
                    <Settings2 size={14} />
                    <select
                      aria-label={t('status')}
                      value={status}
                      onChange={(event) => setStatus(event.target.value)}
                    >
                      <option value="">{t('allStatuses')}</option>
                      {(
                        [
                          'running',
                          'waiting_for_user',
                          'completed',
                          'failed',
                          'interrupted',
                          'unknown',
                        ] as const
                      ).map((value) => (
                        <option value={value} key={value}>
                          {t(`statusLabels.${value}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {!sessions.length ? (
                  <div className="empty-state">
                    <img
                      className="empty-mascot"
                      src="/brand/orqst-mascot.svg"
                      width={690}
                      height={590}
                      alt=""
                      aria-hidden="true"
                    />
                    <h3>{t('emptyTitle')}</h3>
                    <p>{t('emptyBody')}</p>
                    <button className="button" onClick={() => setGuideOpen(true)}>
                      {t('observationGuide.title')}
                    </button>
                    {snapshot?.diagnostics.scanning && (
                      <span className="connection">{t('syncing')}</span>
                    )}
                  </div>
                ) : (
                  <div className="table-scroll" tabIndex={0} role="group" aria-label={t('agents')}>
                    <table className="session-table" role="table">
                      <thead>
                        <tr>
                          <th>{t('agent')}</th>
                          <th>{t('status')}</th>
                          <th>{t('duration')}</th>
                          <th>{t('lastActivity')}</th>
                          <th>{t('tokens')}</th>
                          <th>
                            <span className="sr-only">{t('viewSession')}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((session) => (
                          <tr
                            key={session.id}
                            className={selected === session.id ? 'selected-row' : ''}
                          >
                            <td>
                              <button
                                className="agent-cell"
                                onClick={() => selectSession(session.id)}
                              >
                                <span
                                  className={`agent-avatar ${session.parentSessionId ? 'child-agent' : ''}`}
                                >
                                  {session.parentSessionId ? (
                                    <GitBranch size={17} />
                                  ) : (
                                    <Terminal size={17} />
                                  )}
                                </span>
                                <span>
                                  <strong>{session.agentName}</strong>
                                  <small title={session.task ?? ''}>
                                    {session.task ?? t('noTask')}
                                  </small>
                                </span>
                              </button>
                            </td>
                            <td data-label={t('status')}>
                              <Status status={session.status} />
                            </td>
                            <td className="mono muted" data-label={t('duration')}>
                              {f.duration(session)}
                            </td>
                            <td className="mono muted" data-label={t('lastActivity')}>
                              {f.date(session.lastActivity)}
                            </td>
                            <td className="mono token-cell" data-label={t('tokens')}>
                              {f.compact(session.usage.total)}
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                aria-label={`${t('viewSession')} ${session.agentName}`}
                                onClick={() => selectSession(session.id)}
                              >
                                <ChevronRight size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!filtered.length && <p className="empty-copy">{t('filteredEmpty')}</p>}
                  </div>
                )}
                <div className="panel-footer">
                  <span className="tiny-dot" />
                  {t('observedNote')}
                </div>
              </section>
              {selectedSession && snapshot ? (
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
                <OverviewPanels
                  preferences={overview.preferences}
                  onCustomize={openOverviewLayout}
                  panels={{
                    activity: (
                      <section className="panel activity-panel">
                        <div className="panel-heading">
                          <h2>
                            <Activity size={17} />
                            {t('activity')}
                          </h2>
                          <span className="subtle-label">{f.number(recent.length)}</span>
                        </div>
                        <Timeline events={recent.slice(-45)} />
                        <div className="panel-footer">
                          {t('limitNotice', { count: Math.min(recent.length, 45) })}
                        </div>
                      </section>
                    ),
                    attention: (
                      <section className="panel attention-panel">
                        <div className="panel-heading">
                          <h2>
                            <Bell size={16} />
                            {t('attention')}
                          </h2>
                          <span className="count-badge">{attention.length}</span>
                        </div>
                        {attention.length ? (
                          <div className="attention-list">
                            {attention.slice(0, 10).map((session) => (
                              <button onClick={() => selectSession(session.id)} key={session.id}>
                                <span>
                                  <strong>{session.agentName}</strong>
                                  <Status status={session.status} />
                                </span>
                                <ChevronRight size={16} />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="quiet-state">
                            <CheckCircle2 size={26} />
                            <strong>{t('attentionEmpty')}</strong>
                            <p>{t('attentionBody')}</p>
                          </div>
                        )}
                      </section>
                    ),
                    usage: (
                      <section className="panel usage-panel">
                        <div className="panel-heading">
                          <h2>
                            <Zap size={16} />
                            {t('usage')}
                          </h2>
                        </div>
                        <div className="usage-body">
                          <TokenSummary usage={usage} />
                        </div>
                      </section>
                    ),
                    diagnostics: (
                      <section className="panel diagnostics-panel">
                        <div className="panel-heading">
                          <h2>
                            <ShieldCheck size={16} />
                            {t('diagnostics')}
                          </h2>
                        </div>
                        <dl>
                          {[
                            ['sourceFiles', snapshot?.diagnostics.files ?? 0],
                            ['malformed', snapshot?.diagnostics.malformed ?? 0],
                            ['oversized', snapshot?.diagnostics.oversized ?? 0],
                            ['scanErrors', snapshot?.diagnostics.errors ?? 0],
                          ].map(([key, value]) => (
                            <div key={key}>
                              <dt>{t(String(key))}</dt>
                              <dd>{f.number(Number(value))}</dd>
                            </div>
                          ))}
                        </dl>
                        <p className="fine-print">{t('retentionNote')}</p>
                      </section>
                    ),
                  }}
                />
              )}
            </>
          )}
        </main>
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
      {overviewLayoutOpen && (
        <OverviewLayoutEditor
          preferences={overview.preferences}
          onChange={overview.setPreferences}
          storageUnavailable={overview.storageUnavailable}
          onClose={closeOverviewLayout}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          snapshot={snapshot}
          onNavigate={navigate}
          onWorkspace={(id) => openWorkspace(id, 'overview')}
          onSession={openSession}
          onNotifications={() => setNotificationOpen(true)}
          onCreate={() => setWorkspaceOpen(true)}
          onGuide={() => setGuideOpen(true)}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {guideOpen && (
        <ObservationGuide
          snapshot={snapshot}
          connection={connection}
          snapshotError={error}
          onNavigate={(page) => navigate(page, true)}
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
            <div className="drawer-subheading">
              <span>{t('notificationCounts', { count: unread })}</span>
              <button
                className="text-button"
                onClick={() => {
                  void api('/api/notifications/read', { method: 'POST' })
                    .then(() => refresh())
                    .then(() => setSaveError(false))
                    .catch(() => setSaveError(true));
                }}
              >
                {t('markRead')}
              </button>
            </div>
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
            {snapshot?.notifications.some(
              (item) =>
                notificationFilter === 'all' ||
                (notificationFilter === 'unread' ? !item.read : item.type === notificationFilter),
            ) ? (
              snapshot.notifications
                .filter(
                  (item) =>
                    notificationFilter === 'all' ||
                    (notificationFilter === 'unread'
                      ? !item.read
                      : item.type === notificationFilter),
                )
                .map((item) => (
                  <button
                    className={`notification-item notification-${item.type.replaceAll('.', '-')} ${item.read ? 'read' : ''}`}
                    disabled={!snapshot.sessions.some((session) => session.id === item.sessionId)}
                    title={
                      snapshot.sessions.some((session) => session.id === item.sessionId)
                        ? t('viewSession')
                        : t('shell.notifications.sourceMissing')
                    }
                    key={item.id}
                    onClick={() => {
                      openSession(item.sessionId);
                      setNotificationOpen(false);
                    }}
                  >
                    <span className="tiny-dot" />
                    <span>
                      <strong>{t(`events.${item.type}`)}</strong>
                      <small>
                        {snapshot.sessions.find((session) => session.id === item.sessionId)
                          ?.agentName ?? item.sessionId.slice(0, 8)}
                      </small>
                      <small>
                        {snapshot.workspaces.find(
                          (workspace) =>
                            workspace.id ===
                            snapshot.sessions.find((session) => session.id === item.sessionId)
                              ?.workspaceId,
                        )?.name ?? t('unknown')}
                      </small>
                      <time dateTime={item.timestamp}>{f.date(item.timestamp)}</time>
                    </span>
                    <ExternalLink size={14} />
                  </button>
                ))
            ) : (
              <p className="empty-copy">
                {t(
                  snapshot?.notifications.length
                    ? 'shell.notifications.noMatches'
                    : 'notificationEmpty',
                )}
              </p>
            )}
            {notificationPreferences}
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
