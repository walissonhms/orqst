import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Command,
  ExternalLink,
  Folder,
  GitBranch,
  Globe2,
  Layers3,
  Menu,
  Plus,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
import type {
  AgentStatus,
  Preferences,
  SessionView,
  Snapshot,
  StoredEvent,
  Usage,
} from '@orqst/protocol';
import { api } from './api';
import { useObservatory } from './use-observatory';

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
function Timeline({ events }: { events: StoredEvent[] }) {
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
                <pre>{event.payload.text ?? event.payload.result}</pre>
              </details>
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
  onClose,
  onSave,
}: {
  session: SessionView;
  snapshot: Snapshot;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const f = useFormatting();
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [hasOlder, setHasOlder] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<'activity' | 'results' | 'usage'>('activity');
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
          <h2>
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
        <span>{session.model ?? t('unknown')}</span>
        <span>{f.duration(session)}</span>
      </div>
      {session.status === 'waiting_for_user' && <p className="notice">{t('interventionNote')}</p>}
      {error && (
        <p role="alert" className="notice">
          {t('savedError')}
        </p>
      )}
      <p className="session-task">{session.task ?? t('noTask')}</p>
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
        {(['activity', 'results', 'usage'] as const).map((value) => (
          <button
            key={value}
            className={tab === value ? 'selected' : ''}
            onClick={() => setTab(value)}
          >
            {t(value)}
          </button>
        ))}
      </div>
      {tab === 'activity' && (
        <>
          <p className="fine-print detail-intro">{t('originalText')}</p>
          <Timeline events={events} />
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
      {tab === 'results' && (
        <div className="result-content">
          <span className="eyebrow">{t('resultTitle')}</span>
          <pre>{session.result ?? t('noResult')}</pre>
        </div>
      )}
      {tab === 'usage' && (
        <div className="usage-content">
          <TokenSummary usage={session.usage} />
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
  const [workspaceId, setWorkspaceId] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string>();
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
    [sound, t],
  );
  const { snapshot, connection, error, refresh } = useObservatory(onLive);
  useEffect(() => {
    if (snapshot && !prefsSaving) setLocalPrefs(snapshot.preferences);
  }, [snapshot, prefsSaving]);
  useEffect(() => {
    prefsRef.current = localPrefs;
  }, [localPrefs]);
  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? 'en-US';
  }, [i18n.resolvedLanguage]);
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
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'mobile-open' : ''}`}>
        <a className="brand" href="/" aria-label={t('brand')}>
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>{t('brand')}</span>
        </a>
        <p className="brand-tagline">{t('tagline')}</p>
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
            className={`workspace-link ${!workspaceId ? 'active' : ''}`}
            onClick={() => {
              setWorkspaceId('');
              setMenuOpen(false);
            }}
          >
            <Layers3 size={16} />
            <span>{t('allWorkspaces')}</span>
            <small>{snapshot?.sessions.length ?? 0}</small>
          </button>
          {snapshot?.workspaces.map((workspace) => (
            <button
              key={workspace.id}
              className={`workspace-link ${workspaceId === workspace.id ? 'active' : ''}`}
              title={workspace.path}
              onClick={() => {
                setWorkspaceId(workspace.id);
                setMenuOpen(false);
              }}
            >
              <Folder size={16} />
              <span>{workspace.name}</span>
              <small>{workspace.sessions}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="integration-heading">{t('integration')}</div>
          {snapshot?.adapters.map((adapter) => (
            <div className="integration-item" key={adapter.id}>
              <span className={`tiny-dot ${adapter.implemented ? 'green' : ''}`} />
              <span>
                {adapter.id === 'codex'
                  ? 'Codex CLI'
                  : adapter.id === 'claude'
                    ? 'Claude Code'
                    : 'OpenCode'}
              </span>
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
              className="icon-button menu-toggle"
              aria-label={t('workspaceNav')}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Menu size={18} />
            </button>
            <Command size={15} />
            <span>{currentWorkspace?.name ?? t('allWorkspaces')}</span>
            <ChevronRight size={14} />
            <strong>{t('overview')}</strong>
          </div>
          <div className="topbar-actions">
            <span className={`connection connection-${connection}`} role="status">
              <span className="tiny-dot" />
              {t(connection)}
            </span>
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
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                <Radio size={12} />
                {t('readOnly')}
              </span>
              <h1>{t('heading')}</h1>
              <p>{t('description')}</p>
            </div>
            <div className="heading-decoration">
              <Activity size={40} />
            </div>
          </div>
          {(error || saveError) && (
            <p className="notice" role="alert">
              {t(saveError ? 'savedError' : 'error')}
            </p>
          )}
          {notice && (
            <div className="notice" role="status">
              {t(notice)}
              <button className="icon-button" aria-label={t('close')} onClick={() => setNotice('')}>
                <X size={14} />
              </button>
            </div>
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
                <i className="stat-live" />
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
                <ChevronDown size={12} />
              </label>
            </div>
            {!sessions.length ? (
              <div className="empty-state">
                <span className="empty-icon">
                  <Sparkles size={27} />
                </span>
                <h3>{t('emptyTitle')}</h3>
                <p>{t('emptyBody')}</p>
                {snapshot?.diagnostics.scanning && (
                  <span className="connection">{t('syncing')}</span>
                )}
              </div>
            ) : (
              <div className="table-scroll">
                <table>
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
                          <button className="agent-cell" onClick={() => setSelected(session.id)}>
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
                        <td>
                          <Status status={session.status} />
                        </td>
                        <td className="mono muted">{f.duration(session)}</td>
                        <td className="mono muted">{f.date(session.lastActivity)}</td>
                        <td className="mono token-cell">{f.compact(session.usage.total)}</td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`${t('viewSession')} ${session.agentName}`}
                            onClick={() => setSelected(session.id)}
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
              onClose={() => setSelected(undefined)}
              onSave={() => {
                void refresh();
              }}
            />
          ) : (
            <div className="lower-grid">
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
              <div className="right-column">
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
                        <button onClick={() => setSelected(session.id)} key={session.id}>
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
              </div>
            </div>
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
      {notificationOpen && (
        <div className="drawer-backdrop" onClick={() => setNotificationOpen(false)}>
          <aside
            className="notification-drawer"
            aria-label={t('notifications')}
            onClick={(event) => event.stopPropagation()}
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
              <div className="drawer-subheading">
                <span>{t('notificationCounts', { count: unread })}</span>
                <button
                  className="text-button"
                  onClick={() => {
                    void api('/api/notifications/read', { method: 'POST' })
                      .then(() => refresh())
                      .catch(() => setSaveError(true));
                  }}
                >
                  {t('markRead')}
                </button>
              </div>
              {snapshot?.notifications.length ? (
                snapshot.notifications.map((item) => (
                  <button
                    className={`notification-item ${item.read ? 'read' : ''}`}
                    key={item.id}
                    onClick={() => {
                      setSelected(item.sessionId);
                      setNotificationOpen(false);
                    }}
                  >
                    <span className="tiny-dot green" />
                    <span>
                      <strong>{t(`events.${item.type}`)}</strong>
                      <small>
                        {snapshot.sessions.find((session) => session.id === item.sessionId)
                          ?.agentName ?? item.sessionId.slice(0, 8)}
                      </small>
                      <time>{f.date(item.timestamp)}</time>
                    </span>
                    <ExternalLink size={14} />
                  </button>
                ))
              ) : (
                <p className="empty-copy">{t('notificationEmpty')}</p>
              )}
              <div className="preferences">
                <h3>{t('preferences')}</h3>
                {(['completed', 'failed', 'intervention', 'sound'] as const).map((key) => (
                  <label className="preference" key={key}>
                    <span>
                      {t(
                        key === 'completed'
                          ? 'notificationCompleted'
                          : key === 'failed'
                            ? 'notificationFailed'
                            : key === 'intervention'
                              ? 'notificationIntervention'
                              : 'sound',
                      )}
                    </span>
                    <input
                      type="checkbox"
                      checked={localPrefs[key]}
                      disabled={prefsSaving}
                      onChange={(event) => {
                        if (snapshot) {
                          void preferences({ ...localPrefs, [key]: event.target.checked });
                          if (key === 'sound' && event.target.checked) void sound(true);
                        }
                      }}
                    />
                  </label>
                ))}
                <button
                  className="button"
                  onClick={() => {
                    void sound(true);
                  }}
                >
                  <Volume2 size={14} />
                  {t('audioTest')}
                </button>
                <button
                  className="button"
                  onClick={() => {
                    void desktop();
                  }}
                >
                  <Bell size={14} />
                  {t('desktop')}
                </button>
                <p className="fine-print">{t('notificationsPermission')}</p>
              </div>
            </div>
          </aside>
        </div>
      )}
      {workspaceOpen && (
        <div className="modal-backdrop">
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
        </div>
      )}
    </div>
  );
}
