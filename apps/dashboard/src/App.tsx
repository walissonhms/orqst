import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bell,
  Check,
  Circle,
  ExternalLink,
  Folder,
  GitBranch,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import type {
  AgentStatus,
  ArtifactExtractionRequest,
  FeatureCanvasEvidence,
  Preferences,
  SessionView,
  Snapshot,
  WorkspaceFeature,
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
  type StudioShellCommand,
} from './navigation';
import { findNotificationSource, NativeSessionNavigation } from './native-session-navigation';
import { FeatureStudio, type StudioFocus } from './FeatureStudio';
import { CommunicationInspector } from './CommunicationInspector';
import { AppShell } from './AppShell';
import { ShellSidebar, type FeatureOperation } from './ShellSidebar';
import { studioTerminals } from './studio-native';
import { openFeatureTerminalIds } from './feature-counts';
import { useOwnedPaneEvidence } from './use-terminal-lifecycle';
import { Workspaces } from './Workspaces';
import { pinnedFirst, useWorkspacePins } from './workspace-pins';
import { OverviewLayout, type StudioCardTarget } from './OverviewLayout';
import { CommandPalette } from './CommandPalette';
import { useFeatureShell } from './use-feature-shell.js';
import { quitBlocked, type QuitBlocked } from './quit-notice.js';
import { Modal } from './Modal';
import { readStartup, Settings } from './Settings';
import { needsOnboarding, ObservationGuide } from './ObservationGuide';
import { NotificationPreferences } from './NotificationPreferences';
import { useAppearancePreferences } from './appearance-preferences';
import { STALE_MS } from './shell-sections';
import { readShellPreferences, shellStorageKey, type AppView } from './shell-preferences';

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
            <p title={t('modelObservation.historyNote.detail')}>
              {t('modelObservation.historyNote.label')}
            </p>
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
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const managedShell = window.orqstFeatures?.contractVersion === 1;
  const [workspaceId, setWorkspaceId] = useState(shell.workspaceId);
  const [managedWorkspaceId, setManagedWorkspaceId] = useState(shell.managedWorkspaceId);
  const [viewedFeatureId, setViewedFeatureId] = useState(shell.managedFeatureId);
  const [newManagedWorkspace, setNewManagedWorkspace] = useState<{ id: string; name: string }>();
  const [view, setView] = useState<AppView>(() => {
    const explicit = viewFromLocation(location);
    if (explicit) return explicit;
    if (location.hash) return 'overview';
    const startup = readStartup();
    return startup === 'last' ? (managedShell ? 'studio' : shell.view) : startup;
  });
  const [studioCommand, setStudioCommand] = useState<StudioShellCommand>();
  const [featureError, setFeatureError] = useState(false);
  const [preparationRequest, setPreparationRequest] = useState<FeaturePreparationRequest>();
  const showPreparation = useRef<(detail: unknown) => void>(() => {});
  useEffect(() => {
    const show = (event: Event) => showPreparation.current((event as CustomEvent).detail);
    window.addEventListener('orqst-show-preparation', show);
    return () => window.removeEventListener('orqst-show-preparation', show);
  }, []);
  const [status, setStatus] = useState(shell.status);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(
    () => location.pathname === '/' && !location.hash && needsOnboarding(),
  );
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
  const featureShell = useFeatureShell(view === 'communication');
  const liveSnapshot = featureShell.snapshot;
  const paneEvidence = useOwnedPaneEvidence();
  const [studioCanvas, setStudioCanvas] = useState<{
    workspaceId: string;
    canvas: FeatureCanvasEvidence;
  }>();
  const managedWorkspaces = featureShell.startup?.workspaces ?? [];
  const liveWorkspace = liveSnapshot?.workspace;
  const savedWorkspace =
    managedWorkspaces.find(({ id }) => id === shell.workspaceId) ?? managedWorkspaces[0];
  const activeWorkspace =
    managedWorkspaces.find(({ id }) => id === managedWorkspaceId) ??
    liveWorkspace ??
    newManagedWorkspace ??
    savedWorkspace;
  const activeSaved = managedWorkspaces.find(({ id }) => id === activeWorkspace?.id);
  const usingLiveWorkspace = liveWorkspace?.id === activeWorkspace?.id && !!liveSnapshot;
  const features = usingLiveWorkspace ? liveSnapshot.features : (activeSaved?.features ?? []);
  const defaultId = activeWorkspace && defaultFeatureId(activeWorkspace.id);
  const savedFeatureId = activeSaved?.view.featureId;
  const selectedSavedFeature = [viewedFeatureId, savedFeatureId, defaultId].find((id) =>
    features.some((feature) => feature.featureId === id && feature.status !== 'archived'),
  );
  const displayFeatureId = usingLiveWorkspace
    ? liveSnapshot.activeFeatureId
    : (selectedSavedFeature ?? null);
  const featureSnapshot = usingLiveWorkspace ? liveSnapshot : undefined;
  const managedStudio = !!managedShell && view === 'studio';
  const savedStudio =
    activeSaved && !usingLiveWorkspace
      ? {
          workspace: { id: activeSaved.id, name: activeSaved.name },
          features: activeSaved.features,
          view: activeSaved.view,
          activeFeatureId: displayFeatureId,
        }
      : undefined;
  const managedFeature = features.find((feature) => feature.featureId === displayFeatureId);
  const studioScope = activeWorkspace
    ? {
        workspace: activeWorkspace,
        featureId: usingLiveWorkspace
          ? liveSnapshot.activeFeatureId
          : (activeSaved?.view.featureId ?? null),
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
      localStorage.setItem(
        shellStorageKey,
        JSON.stringify({
          ...shell,
          view,
          workspaceId,
          managedWorkspaceId,
          managedFeatureId: viewedFeatureId,
          status,
        }),
      );
    } catch {
      // Disabled or full browser storage must not prevent observation.
    }
  }, [shell, view, workspaceId, managedWorkspaceId, viewedFeatureId, status]);
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
  const [ownedNotificationsOpen, setOwnedNotificationsOpen] = useState(false);
  const [ownedUnread, setOwnedUnread] = useState(0);
  const studioFocus = useRef<StudioFocus>(null);

  function openNotifications() {
    if (managedShell) setOwnedNotificationsOpen(true);
    else setNotificationOpen(true);
  }
  const [notificationFilter, setNotificationFilter] = useState('all');
  const [markingRead, setMarkingRead] = useState(false);
  const [markReadError, setMarkReadError] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
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
  const [prefsError, setPrefsError] = useState(false);
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
  const { snapshot, connection, error, refresh, reconnect } = useObservatory(onLive);
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
      setStatus('');
    } else if (page === 'overview') applySession(undefined);
    else if (page === 'studio' && managedShell) setWorkspaceId('');
    if (page !== 'overview') setArtifactRequest(undefined);
    if (page !== 'studio') setStudioCommand(undefined);
    setView(page);
    navigation.current?.replace(viewPath(page, id));
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
    if (page !== 'studio') setStudioCommand(undefined);
    setView(page);
    navigation.current?.push(viewPath(page, sessionId));
  }
  function navigate(page: AppView, focusContent = false) {
    if (page === view) return;
    requestNavigation(() => {
      if (page === 'studio' && managedShell) setWorkspaceId('');
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
      if (destination === 'notifications') openNotifications();
      else if (destination === 'search') setPaletteOpen(true);
      else
        requestNavigation(() => {
          applyView(destination, destination === 'overview' ? selected : undefined);
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
      setStatus('');
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
      setPrefsError(false);
    } catch {
      setPrefsError(true);
      if (snapshot) setLocalPrefs(snapshot.preferences);
    } finally {
      setPrefsSaving(false);
    }
  }
  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const { id } = await api<{ id: string }>('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: data.get('name'), path: data.get('path') }),
      });
      await refresh();
      openWorkspace(id, 'studio');
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
        <p className="notice" role="status" title={t('settings.notificationsUnavailable.detail')}>
          {t('settings.notificationsUnavailable.label')}
        </p>
      )}
      {prefsError && (
        <p className="notice" role="alert">
          {t('settings.notificationSaveUnconfirmed')}
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
  const unreadCount = managedShell ? ownedUnread : unread;
  const notificationControl = (
    <button
      type="button"
      role="button"
      className="shell-icon shell-bell"
      title={
        managedShell
          ? `${t('notifications')} · ${t('notificationCounts', { count: unreadCount })}`
          : t('notifications')
      }
      aria-label={t('notifications')}
      aria-description={
        snapshot || managedShell
          ? t(!managedShell && offline ? 'shell.notifications.staleCount' : 'notificationCounts', {
              count: unreadCount,
            })
          : undefined
      }
      aria-haspopup="dialog"
      onClick={openNotifications}
    >
      <Bell size={16} aria-hidden="true" />
      {unreadCount > 0 && (
        <span className="shell-unread" aria-hidden="true">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
  const studioTree: StudioTreeProps = {
    scope: studioScope,
    observedWorkspaces: snapshot?.workspaces ?? [],
    observedWorkspaceId: workspaceId,
    onObservedWorkspaceChange: (id) => openWorkspace(id),
  };
  const managedWorkspace = activeWorkspace;
  const shellWorkspaceId = managedShell ? (managedWorkspace?.id ?? '') : workspaceId;
  const shellWorkspace = managedShell ? managedWorkspace : currentWorkspace;
  const managedSelected = !!managedWorkspace;
  const coreConnection = offline ? 'offline' : connection;
  const featureWritable =
    usingLiveWorkspace && coreConnection !== 'offline' && !quitFence && !featureShell.busy;
  const openSlots = openFeatureTerminalIds(
    featureSnapshot,
    studioCanvas?.workspaceId === featureSnapshot?.workspace.id ? studioCanvas?.canvas : undefined,
    paneEvidence,
  );
  const managedFeatures = features.filter((feature) => feature.status !== 'archived');

  function selectWorkspace(id: string) {
    setFeatureError(false);
    if (!managedShell) {
      openWorkspace(id);
      return;
    }
    requestNavigation(() => {
      if (id !== shellWorkspaceId) setViewedFeatureId('');
      setManagedWorkspaceId(id);
      applySession(undefined);
      applyView('studio', '');
    });
  }
  function openFeature(id: string, terminalId?: string) {
    requestNavigation(() => {
      setFeatureError(false);
      void (async () => {
        if (terminalId) {
          if (!(await openStudioCard({ featureId: id, terminalId }))) setFeatureError(true);
          return;
        }
        if (!usingLiveWorkspace && features.some((feature) => feature.featureId === id)) {
          if (activeWorkspace) setManagedWorkspaceId(activeWorkspace.id);
          setViewedFeatureId(id);
          applyView('studio');
          return;
        }
        if (!(await featureShell.select(id))) {
          setFeatureError(true);
          return;
        }
        setViewedFeatureId('');
        setWorkspaceId('');
        applyView('studio');
      })();
    });
  }
  async function editFeature(
    { action, feature }: { action: FeatureOperation; feature?: WorkspaceFeature },
    name: string,
    description: string,
    featureStatus: WorkspaceFeature['status'],
  ) {
    if (!featureWritable || !featureSnapshot) return false;
    const input = { name, description, status: featureStatus };
    if (action === 'archive' || action === 'rename') {
      if (!feature) return false;
      const reply = await featureShell.request({
        action: 'update',
        featureId: feature.featureId,
        input:
          action === 'archive'
            ? { status: 'archived', expectedRevision: feature.revision }
            : { ...input, expectedRevision: feature.revision },
      });
      if (reply?.status !== 'ok') return false;
      if (action === 'archive' && feature.featureId === featureSnapshot.activeFeatureId)
        openFeature(defaultFeatureId(featureSnapshot.workspace.id));
      return true;
    }
    const reply = await featureShell.request({ action: 'create', input });
    if (reply?.status !== 'ok') return false;
    const existing = new Set(featureSnapshot.features.map((feature) => feature.featureId));
    const created = reply.snapshot?.features.filter(
      (candidate) =>
        !existing.has(candidate.featureId) &&
        candidate.name === name &&
        candidate.description === description &&
        candidate.status === featureStatus,
    );
    if (created?.length === 1) openFeature(created[0]!.featureId);
    return true;
  }
  async function openStudioCard(target: StudioCardTarget): Promise<boolean> {
    return (await studioFocus.current?.(target.featureId, target.terminalId)) ?? false;
  }

  async function startOnboarding(path: string | undefined) {
    if (path) {
      const name = path.split(/[\\/]/).filter(Boolean).at(-1)?.slice(0, 100) ?? path.slice(0, 100);
      const workspace = await api<{ id: string }>('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name, path }),
      });
      await refresh();
      setWorkspaceId(workspace.id);
      if (managedShell) setNewManagedWorkspace({ id: workspace.id, name });
    }
    navigate('studio', true);
  }
  function runStudioCommand(command: StudioShellCommand) {
    requestNavigation(() => {
      setFeatureError(false);
      setWorkspaceId('');
      applyView('studio');
      setStudioCommand(command);
    });
  }

  const catalogue = new Map(
    managedWorkspaces.map(({ id, name, features }) => [
      id,
      { id, name, count: features.filter(({ status }) => status !== 'archived').length },
    ]),
  );
  if (liveSnapshot)
    catalogue.set(liveSnapshot.workspace.id, {
      ...liveSnapshot.workspace,
      count: liveSnapshot.features.filter(({ status }) => status !== 'archived').length,
    });
  if (newManagedWorkspace && !catalogue.has(newManagedWorkspace.id))
    catalogue.set(newManagedWorkspace.id, { ...newManagedWorkspace, count: 0 });
  const workspaceRows = managedShell
    ? [...catalogue.values()]
    : (snapshot?.workspaces ?? []).map(({ id, name }) => ({ id, name, count: 0 }));
  const settingsRoute = view === 'settings' || view === 'agents';
  const routeTitle = t(`shell.views.${settingsRoute ? 'settings' : view}`);
  const featureName = managedSelected ? studioScope?.featureName : undefined;
  const breadcrumb = [shellWorkspace?.name ?? t('allWorkspaces'), featureName]
    .filter(Boolean)
    .join(' / ');
  const subtitle =
    view === 'studio' && managedSelected && managedFeature
      ? t(`features.status_${managedFeature.status}`).toLocaleLowerCase(i18n.resolvedLanguage)
      : routeTitle;
  const sidebar = (
    <ShellSidebar
      view={view}
      theme={appearance.resolvedTheme}
      workspaces={pinnedFirst(workspaceRows, workspacePins.pins).map((workspace) => ({
        ...workspace,
        pinned: workspacePins.pins.includes(workspace.id),
      }))}
      workspaceId={shellWorkspaceId}
      features={
        managedSelected
          ? managedFeatures.map((feature) => ({
              feature,
              count: feature.terminalIds.filter((id) => openSlots.has(id)).length,
            }))
          : []
      }
      featureId={displayFeatureId}
      featureWritable={featureWritable}
      onWorkspace={selectWorkspace}
      onFeature={openFeature}
      onEditFeature={editFeature}
      featureError={featureError}
      onNavigate={(page) => navigate(page, true)}
      onCreateWorkspace={() => {
        setSaveError(false);
        setWorkspaceOpen(true);
      }}
      onSearch={() => setPaletteOpen(true)}
      notificationControl={notificationControl}
      connection={coreConnection}
      onReconnect={reconnect}
    />
  );
  const headerActions = view === 'overview' && selectedSession && (
    <SessionTokenBadge
      state={headerMetrics?.sessionId === selectedSession.id ? headerMetrics.metrics : undefined}
      offline={connection !== 'connected' || error}
    />
  );
  const studioOutlet = managedShell && (
    <div className="studio-workspace" hidden={!managedStudio}>
      <StudioShellContext.Provider
        value={{
          tree: studioTree,
          active: managedStudio,
          command: studioCommand,
          onCommandHandled: (activated) => {
            setStudioCommand(undefined);
            if (!activated) setFeatureError(true);
          },
          navigate,
          openNotifications,
          openSearch: () => setPaletteOpen(true),
        }}
      >
        <FeatureStudio
          focusRef={studioFocus}
          notificationsOpen={ownedNotificationsOpen}
          onNotificationsOpen={setOwnedNotificationsOpen}
          onUnreadChange={setOwnedUnread}
          onRevealStudio={() => {
            if (liveWorkspace) setManagedWorkspaceId(liveWorkspace.id);
            setWorkspaceId('');
            applyView('studio');
          }}
          notificationPreferences={notificationPreferences()}
          onObservedNotifications={() => setNotificationOpen(true)}
          preparationRequest={preparationRequest}
          onPreparationHandled={() => setPreparationRequest(undefined)}
          savedStudio={savedStudio}
          onSavedMetadataChange={featureShell.retryStartup}
          onSnapshot={featureShell.observeSnapshot}
          onCanvas={setStudioCanvas}
          workspaces={managedWorkspace ? [managedWorkspace] : []}
          workspaceId={managedWorkspace?.id}
          liveWorkspaceId={liveWorkspace?.id}
          onWorkspace={studioTree.onObservedWorkspaceChange}
        />
      </StudioShellContext.Provider>
    </div>
  );
  const outlet = (
    <>
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
      {!managedStudio && notice && !notificationOpen && (
        <div className="notice" role="status">
          {t(notice)}
          <button className="icon-button" aria-label={t('close')} onClick={() => setNotice('')}>
            <X size={14} />
          </button>
        </div>
      )}

      {studioOutlet}
      {view === 'studio' ? (
        managedStudio ? (
          !featureSnapshot &&
          !featureShell.startupPending &&
          !featureShell.startup && (
            <div className="notice" role="alert">
              {t('features.creationUnavailable')}
              <button type="button" className="button" onClick={featureShell.retryStartup}>
                {t('paneLifecycle.retry')}
              </button>
            </div>
          )
        ) : (
          <FeatureStudio />
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
            studioScope && {
              workspaceId: studioScope.workspace.id,
              featureId: studioScope.featureId,
            }
          }
          defaultFolder={currentWorkspace?.path}
          snapshot={snapshot}
          snapshotStale={connection !== 'connected' || error}
        />
      ) : view === 'communication' ? (
        <CommunicationInspector snapshot={featureSnapshot} onOpenStudio={openStudioCard} />
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
            onLayout={(value) => setShell((previous) => ({ ...previous, workspaceLayout: value }))}
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
          workspaceId={workspaceId}
          onOpenObserved={openSession}
        />
      )}
    </>
  );
  const overlays = (
    <>
      {paletteOpen && (
        <CommandPalette
          snapshot={snapshot}
          studioScope={studioScope}
          onNavigate={(destination) => navigate(destination, true)}
          workspaces={workspaceRows}
          features={managedFeatures.map((feature) => ({
            id: feature.featureId,
            name: featureDisplayName(feature, t('features.defaultName')),
            description: feature.description,
            terminals: featureSnapshot
              ? studioTerminals(
                  { ...featureSnapshot, activeFeatureId: feature.featureId },
                  featureShell.panes,
                  undefined,
                  now,
                )
              : [],
          }))}
          onWorkspace={selectWorkspace}
          onFeature={openFeature}
          onStudioCommand={managedShell ? runStudioCommand : undefined}
          onSession={openSession}
          onNotifications={openNotifications}
          onCreate={() => {
            setSaveError(false);
            setWorkspaceOpen(true);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {guideOpen &&
        (managedShell
          ? featureShell.startup?.workspaces.length === 0 && !liveSnapshot && !featureShell.loading
          : !!snapshot) && (
          <ObservationGuide
            canCreateWorkspace={!!snapshot && connection === 'connected' && !error}
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
              <p>{t('shell.frame.workspaceEvidence')}</p>
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
    </>
  );
  return (
    <AppShell
      sidebar={sidebar}
      breadcrumb={breadcrumb}
      subtitle={subtitle}
      headerActions={headerActions}
      connection={coreConnection}
      onReconnect={reconnect}
      loading={
        !offline &&
        (managedStudio
          ? featureShell.loading || (!liveSnapshot && featureShell.startupPending)
          : !snapshot || Boolean(initialScan))
      }
      studio={managedStudio}
      overlays={overlays}
    >
      {outlet}
    </AppShell>
  );
}
