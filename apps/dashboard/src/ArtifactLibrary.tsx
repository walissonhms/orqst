import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Search } from 'lucide-react';
import type {
  FeatureNativeSnapshot,
  ArtifactExtractionRequest,
  SessionView,
  Snapshot,
  StoredEvent,
} from '@orqst/protocol';
import { featureDisplayName } from '@orqst/protocol';
import { api } from './api';
import { ArtifactPanel, type ArtifactCloseGuard } from './ArtifactPanel';
import type { RefObject } from 'react';
import './spec-screens.css';
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
  scope,
  workspaceId,
  online,
  selection,
  closeGuard,
  onOpen,
  onClose,
}: {
  snapshot?: Snapshot;
  scope?: FeatureNativeSnapshot;
  workspaceId: string;
  online: boolean;
  selection?: ArtifactExtractionRequest;
  closeGuard: RefObject<ArtifactCloseGuard | null>;
  onOpen: (selection: ArtifactExtractionRequest) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [featureId, setFeatureId] = useState('');
  const sessions =
    snapshot?.sessions.filter((session) => !workspaceId || session.workspaceId === workspaceId) ??
    [];
  // Retained Codex artifacts currently carry workspace/session identity only.
  const features = scope?.features.filter((feature) => feature.status !== 'archived') ?? [];
  const selectedFeature = features.find((feature) => feature.featureId === featureId);
  return (
    <section className="spec-screen" aria-labelledby="artifact-library-heading">
      <div className="spec-head">
        <h1 id="artifact-library-heading">{t('screens.artifacts.title')}</h1>
      </div>
      <div className="spec-artifact-layout">
        <section
          className="spec-panel spec-artifact-list"
          aria-label={t('screens.artifacts.title')}
        >
          <div className="spec-actions">
            <label className="spec-search">
              <Search size={13} aria-hidden="true" />
              <input
                type="search"
                aria-label={t('artifactLibrary.search')}
                placeholder={t('artifactLibrary.search')}
                maxLength={200}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select
              aria-label={t('screens.feature')}
              value={selectedFeature?.featureId ?? ''}
              onChange={(event) => {
                const next = event.target.value;
                const apply = () => {
                  onClose();
                  setFeatureId(next);
                };
                if (closeGuard.current) closeGuard.current(apply);
                else apply();
              }}
            >
              <option value="">{t('screens.allFeatures')}</option>
              {features.map((feature) => (
                <option value={feature.featureId} key={feature.featureId}>
                  {featureDisplayName(feature, t('features.defaultName'))}
                </option>
              ))}
            </select>
          </div>
          {selectedFeature ? (
            <p>{t('screens.artifacts.noAttribution')}</p>
          ) : snapshot ? (
            <ArtifactSources
              snapshot={snapshot}
              sessions={sessions}
              query={query}
              online={online}
              selection={selection}
              onOpen={onOpen}
            />
          ) : (
            <p>—</p>
          )}
        </section>
        <section className="spec-panel spec-artifact-preview" aria-label={t('artifacts.preview')}>
          {selection && !selectedFeature ? (
            <ArtifactPanel
              key={selection.eventId}
              request={selection}
              closeGuard={closeGuard}
              onClose={onClose}
              library
            />
          ) : (
            <p>{t('screens.artifacts.choose')}</p>
          )}
        </section>
      </div>
    </section>
  );
}

function ArtifactSources({
  snapshot,
  sessions,
  query,
  online,
  selection,
  onOpen,
}: {
  snapshot: Snapshot;
  sessions: SessionView[];
  query: string;
  online: boolean;
  selection?: ArtifactExtractionRequest;
  onOpen: (selection: ArtifactExtractionRequest) => void;
}) {
  const { t, i18n } = useTranslation();
  const [reading, setReading] = useState<Reading>(emptyReading);
  const [revision, setRevision] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const load = useCallback(async (before: number, reset: boolean, scanned = 0, sourceCount = 0) => {
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
      const data = await api<unknown>(`/api/events?${params}`, { signal: controller.signal });
      const events = parseArtifactPage(data, before, '');
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
  }, []);
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
      <div className="spec-row-heading">
        <span
          title={t('artifactLibrary.coverage', {
            count: rows.length,
            sources: reading.sources.length,
            scanned: reading.scanned,
          })}
        >
          {t('screens.artifacts.count', { count: rows.length })}
        </span>
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
      {!online && <p role="status">{t('screens.offline')}</p>}
      {online && reading.cursor !== undefined && snapshot.cursor > reading.cursor && (
        <p className="notice" role="status">
          {t('screens.artifacts.newer')}
        </p>
      )}
      {reading.failed && (
        <p className="notice" role="alert">
          {t('screens.artifacts.loadFailed')}
        </p>
      )}
      {reading.pending && online && <p role="status">{t('artifactLibrary.loading')}</p>}
      {!reading.pending && !reading.failed && !rows.length && (
        <p className="empty-copy">{t('artifactLibrary.empty')}</p>
      )}
      <ul className="spec-artifact-items">
        {rows.map(({ event, session, workspace }) => (
          <li key={event.id}>
            <button
              type="button"
              className="spec-artifact-item"
              aria-pressed={selection?.eventId === event.id}
              disabled={!online || reading.failed}
              onClick={() => {
                const request = artifactSelection(event);
                if (request) onOpen(request);
              }}
            >
              <strong>{event.payload.text?.trim().split('\n')[0]?.slice(0, 100)}</strong>
              <span>
                {workspace?.name ?? session.agentName} ·{' '}
                <time dateTime={event.timestamp}>
                  {new Intl.DateTimeFormat(i18n.resolvedLanguage, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(event.timestamp))}
                </time>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {capped && (
        <p title={t('artifactLibrary.limit', artifactLibraryLimits)}>
          {t('screens.artifacts.limited')}
        </p>
      )}
      <button
        className="button history-button"
        disabled={!online || reading.pending || !reading.hasOlder || capped}
        onClick={() => void load(reading.before, false, reading.scanned, reading.sources.length)}
      >
        {t('artifactLibrary.older')}
      </button>
    </>
  );
}
