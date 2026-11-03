import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, RefreshCw, Search } from 'lucide-react';
import type {
  ArtifactExtractionRequest,
  SessionView,
  Snapshot,
  StoredEvent,
} from '@orqst/protocol';
import { api } from './api';
import { artifactLibraryLimits, artifactSelection, parseArtifactPage } from './artifact-library';

interface Reading {
  sources: StoredEvent[];
  scanned: number;
  before: number;
  cursor?: number;
  hasOlder: boolean;
  pending: boolean;
  failed: boolean;
}
const emptyReading: Reading = {
  sources: [],
  scanned: 0,
  before: Number.MAX_SAFE_INTEGER,
  hasOlder: true,
  pending: true,
  failed: false,
};

export function ArtifactLibrary({
  snapshot,
  workspaceId,
  online,
  onOpen,
}: {
  snapshot: Snapshot;
  workspaceId: string;
  online: boolean;
  onOpen: (selection: ArtifactExtractionRequest) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [sessionId, setSessionId] = useState('');
  const sessions = snapshot.sessions.filter(
    (session) => !workspaceId || session.workspaceId === workspaceId,
  );
  const selectedId = sessions.some((session) => session.id === sessionId) ? sessionId : '';
  return (
    <section className="artifact-library" aria-labelledby="artifact-library-heading">
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            <FileText size={12} />
            {t('readOnly')}
          </span>
          <h1 id="artifact-library-heading">{t('artifactLibrary.title')}</h1>
          <p>{t('artifactLibrary.description')}</p>
        </div>
      </div>
      <p className="fine-print">{t('artifactLibrary.scope')}</p>
      <div className="artifact-library-filters">
        <label className="search-box">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label={t('artifactLibrary.search')}
            placeholder={t('artifactLibrary.search')}
            maxLength={200}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          {t('artifactLibrary.session')}
          <select
            aria-label={t('artifactLibrary.session')}
            value={selectedId}
            onChange={(event) => setSessionId(event.target.value)}
          >
            <option value="">{t('artifactLibrary.allSessions')}</option>
            {sessions
              .filter((session) => session.id.length <= 200)
              .map((session) => (
                <option key={session.id} value={session.id}>
                  {session.agentName} · {session.id}
                </option>
              ))}
          </select>
        </label>
      </div>
      <ArtifactSources
        key={selectedId}
        snapshot={snapshot}
        sessions={sessions}
        sessionId={selectedId}
        query={query}
        online={online}
        onOpen={onOpen}
      />
    </section>
  );
}

function ArtifactSources({
  snapshot,
  sessions,
  sessionId,
  query,
  online,
  onOpen,
}: {
  snapshot: Snapshot;
  sessions: SessionView[];
  sessionId: string;
  query: string;
  online: boolean;
  onOpen: (selection: ArtifactExtractionRequest) => void;
}) {
  const { t, i18n } = useTranslation();
  const [reading, setReading] = useState<Reading>(emptyReading);
  const [revision, setRevision] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const load = useCallback(
    async (before: number, reset: boolean, scanned = 0, sourceCount = 0) => {
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      setReading((current) => ({
        ...(reset ? emptyReading : current),
        pending: true,
        failed: false,
      }));
      try {
        const params = new URLSearchParams({
          before: String(before),
          limit: String(artifactLibraryLimits.page),
        });
        if (sessionId) params.set('sessionId', sessionId);
        const data = await api<unknown>(`/api/events?${params}`, { signal: controller.signal });
        const events = parseArtifactPage(data, before, sessionId);
        const cursor = data && typeof data === 'object' ? Reflect.get(data, 'cursor') : undefined;
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid event cursor');
        if (controller.signal.aborted) return;
        const candidates = events.filter((event) => artifactSelection(event));
        setReading((current) => {
          const sources = [...(reset ? [] : current.sources), ...candidates]
            .sort((a, b) => b.sequence - a.sequence)
            .slice(0, artifactLibraryLimits.sources);
          return {
            sources,
            scanned: scanned + events.length,
            before: events[0]?.sequence ?? before,
            cursor: reset ? (cursor as number) : current.cursor,
            hasOlder: events.length === artifactLibraryLimits.page,
            pending: false,
            failed: false,
          };
        });
        if (
          !reset &&
          (events.length < artifactLibraryLimits.page ||
            scanned + events.length >= artifactLibraryLimits.observations ||
            sourceCount + candidates.length >= artifactLibraryLimits.sources)
        )
          requestAnimationFrame(() => refreshButton.current?.focus());
      } catch {
        if (!controller.signal.aborted)
          setReading((current) => ({ ...current, pending: false, failed: true }));
      }
    },
    [sessionId],
  );
  useEffect(() => {
    if (online) void load(Number.MAX_SAFE_INTEGER, true);
    return () => activeRequest.current?.abort();
    // A new reading is explicit; snapshot updates only disclose newer observations.
  }, [online, load, revision]);
  const capped =
    reading.scanned >= artifactLibraryLimits.observations ||
    reading.sources.length >= artifactLibraryLimits.sources;
  const term = query.trim().toLocaleLowerCase();
  const rows = reading.sources
    .flatMap((event) => {
      const session = sessions.find((value) => value.id === event.sessionId);
      if (!session) return [];
      const workspace = snapshot.workspaces.find((value) => value.id === session.workspaceId);
      return `${event.payload.text ?? ''} ${session.agentName} ${session.id} ${workspace?.name ?? ''} ${workspace?.path ?? ''}`
        .toLocaleLowerCase()
        .includes(term)
        ? [{ event, session, workspace }]
        : [];
    })
    .sort((a, b) => b.event.sequence - a.event.sequence);
  return (
    <>
      <div className="artifact-library-summary">
        <p role="status" aria-live="polite">
          {t('artifactLibrary.coverage', {
            count: rows.length,
            sources: reading.sources.length,
            scanned: reading.scanned,
          })}
        </p>
        <button
          ref={refreshButton}
          className="button"
          disabled={!online || reading.pending}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {t('artifactLibrary.refresh')}
        </button>
      </div>
      {!online && (
        <p className="notice" role="status">
          {t('artifactLibrary.offline')}
        </p>
      )}
      {online && reading.cursor !== undefined && snapshot.cursor > reading.cursor && (
        <p className="notice" role="status">
          {t('artifactLibrary.newer')}
        </p>
      )}
      {reading.failed && (
        <p className="notice" role="alert">
          {t('artifactLibrary.failed')}
        </p>
      )}
      {reading.pending && online && <p role="status">{t('artifactLibrary.loading')}</p>}
      {!reading.pending && !reading.failed && !rows.length && (
        <p className="empty-copy">{t('artifactLibrary.empty')}</p>
      )}
      <div className="artifact-source-list">
        {rows.map(({ event, session, workspace }) => (
          <article className="panel artifact-source-card" key={event.id}>
            <div className="panel-heading">
              <h2>{session.agentName}</h2>
              <time dateTime={event.timestamp}>
                {new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'en-US', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(event.timestamp))}
              </time>
            </div>
            <p className="fine-print">
              {workspace?.name ?? session.workspaceId} · {event.adapter} · <code>{session.id}</code>
            </p>
            <pre className="reading-content artifact-source-excerpt">
              {event.payload.text?.slice(0, 300)}
            </pre>
            <details className="source-detail">
              <summary>{t('source')}</summary>
              <code>
                {event.source.file}:{event.source.line} · {event.source.recordType}
                <br />
                {event.source.hash}
              </code>
            </details>
            <button
              className="button"
              disabled={!online || reading.failed}
              onClick={() => {
                const selection = artifactSelection(event);
                if (selection) onOpen(selection);
              }}
            >
              {t('artifactLibrary.open')}
            </button>
          </article>
        ))}
      </div>
      {capped && (
        <p className="notice" role="status">
          {t('artifactLibrary.limit', {
            observations: artifactLibraryLimits.observations,
            sources: artifactLibraryLimits.sources,
          })}
        </p>
      )}
      <button
        className="button history-button"
        disabled={!online || reading.pending || !reading.hasOlder || capped}
        onClick={() => void load(reading.before, false, reading.scanned, reading.sources.length)}
      >
        {t('artifactLibrary.older')}
      </button>
      {!reading.hasOlder && <p className="fine-print">{t('artifactLibrary.end')}</p>}
    </>
  );
}
