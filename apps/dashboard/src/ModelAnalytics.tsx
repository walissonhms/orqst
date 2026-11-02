import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, RefreshCw } from 'lucide-react';
import {
  modelAnalyticsExportSourceSchema,
  type ModelAnalyticsSummary,
  type Snapshot,
} from '@orqst/protocol';
import {
  analyticsRequestQuery,
  downloadModelAnalytics,
  rankModelAnalytics,
  readAnalyticsJSON,
  readModelAnalyticsResponse,
  serializeModelAnalytics,
  type AnalyticsExportFormat,
} from './analytics-export';

type Period = 'today' | 'week' | 'month' | 'custom' | 'all';

// Presets include today and the preceding local calendar days, never rolling hours.
function calendarBounds(period: Period, start: string, end: string): Record<string, string> | null {
  if (period === 'all') return {};
  const now = new Date();
  let from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (period === 'custom') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
    from = new Date(`${start}T00:00:00`);
    to = new Date(`${end}T00:00:00`);
    if (!Number.isFinite(+from) || !Number.isFinite(+to) || from > to) return null;
    to.setDate(to.getDate() + 1);
  } else from.setDate(from.getDate() - (period === 'week' ? 6 : period === 'month' ? 29 : 0));
  return { from: from.toISOString(), to: to.toISOString() };
}

export function ModelAnalytics({
  workspaceId,
  snapshot,
  connection,
  snapshotError,
}: {
  workspaceId: string;
  snapshot?: Snapshot;
  connection: 'connecting' | 'connected' | 'offline';
  snapshotError: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState<Period>('week');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [agent, setAgent] = useState('');
  const [adapter, setAdapter] = useState('');
  const [model, setModel] = useState('');
  const [unidentified, setUnidentified] = useState(false);
  const [ranking, setRanking] = useState<'tokens' | 'sessions'>('tokens');
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data: ModelAnalyticsSummary; at: Date }>();
  const [failure, setFailure] = useState<{ key: string; reason: string }>();
  const [loading, setLoading] = useState(true);
  const [exportFailure, setExportFailure] = useState(false);
  const [transport, setTransport] = useState({ connection, snapshotError, generation: 0 });
  // Adjust during render so no committed button can use a pre-disconnection response.
  // Recovery needs a new generation even if the cursor and query are unchanged.
  if (transport.connection !== connection || transport.snapshotError !== snapshotError) {
    setTransport({ connection, snapshotError, generation: transport.generation + 1 });
  }
  const available = connection === 'connected' && !snapshotError;
  // UX detection only: older Desktop windows predate the Artifacts preload capability.
  const desktop = !!window.orqstArtifacts || navigator.userAgent.includes(' ORQSTDesktop/0.1');
  const cursor = snapshot?.cursor;
  const request = useMemo(() => {
    const bounds = calendarBounds(period, start, end);
    if (!bounds) return null;
    const params = new URLSearchParams(bounds);
    if (workspaceId) params.set('workspaceId', workspaceId);
    if (agent.trim()) params.set('agentId', agent.trim());
    if (adapter) params.set('adapter', adapter);
    if (unidentified) params.set('unidentified', 'true');
    else if (model.trim()) params.set('model', model.trim());
    return `/api/analytics/models?${params}`;
    // Re-evaluate calendar bounds only on a query change, refresh or observed event.
  }, [period, start, end, workspaceId, agent, adapter, model, unidentified, revision, cursor]);
  const key = `${request}:${revision}:${cursor}:${transport.generation}`;
  useEffect(() => {
    setExportFailure(false);
    if (!request) {
      setLoading(false);
      return;
    }
    if (cursor === undefined || !available) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setFailure(undefined);
    const timer = setTimeout(() => {
      void fetch(request, { credentials: 'same-origin', signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            const body = await readAnalyticsJSON(response);
            const code =
              body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
                ? body.error
                : '';
            const reasons: Record<string, string> = {
              analytics_capacity_exceeded: 'capacity',
              analytics_busy: 'busy',
              analytics_timeout: 'timeout',
              analytics_cancelled: 'workerUnavailable',
              analytics_unavailable: 'workerUnavailable',
            };
            throw new Error(response.status === 400 ? 'invalidQuery' : (reasons[code] ?? 'error'));
          }
          const data = await readModelAnalyticsResponse(response);
          if (active) setResult({ key, data, at: new Date() });
        })
        .catch((error: unknown) => {
          if (active)
            setFailure({
              key,
              reason:
                error instanceof Error &&
                ['capacity', 'invalidQuery', 'busy', 'timeout', 'workerUnavailable'].includes(
                  error.message,
                )
                  ? error.message
                  : 'error',
            });
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [request, key, cursor, available]);
  const data =
    request && result?.key === key && !failure && !loading && available ? result.data : undefined;
  const exportable = useMemo(
    () => !!data && modelAnalyticsExportSourceSchema.safeParse(data).success,
    [data],
  );
  const number = (value: number | undefined | null) =>
    value == null ? t('unknown') : new Intl.NumberFormat(i18n.resolvedLanguage).format(value);
  const rows = useMemo(() => (data ? rankModelAnalytics(data, ranking) : []), [data, ranking]);
  const lead = rows[0];
  const leader =
    lead && (ranking === 'sessions' || lead.usage !== null)
      ? (lead.model ?? t('analytics.unidentified'))
      : t('unknown');
  const adapters = snapshot?.adapters.filter((item) => item.implemented) ?? [];
  const exportReport = (format: AnalyticsExportFormat) => {
    if (desktop || !data || !exportable || !result || !request || !available || loading) return;
    try {
      downloadModelAnalytics(
        serializeModelAnalytics(data, {
          format,
          ranking,
          obtainedAt: result.at.toISOString(),
          query: analyticsRequestQuery(request),
        }),
      );
      setExportFailure(false);
    } catch {
      setExportFailure(true);
    }
  };
  return (
    <section className="analytics" aria-labelledby="analytics-title">
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            <BarChart3 size={12} />
            {t('readOnly')}
          </span>
          <h1 id="analytics-title">{t('analytics.title')}</h1>
          <p>{t('analytics.description')}</p>
        </div>
        <button className="button" onClick={() => setRevision((value) => value + 1)}>
          <RefreshCw size={14} />
          {t('analytics.refresh')}
        </button>
      </div>
      <div className="panel analytics-filter-panel">
        <div className="analytics-filters">
          <label>
            {t('analytics.period')}
            <select
              aria-label={t('analytics.period')}
              value={period}
              onChange={(event) => setPeriod(event.target.value as Period)}
            >
              {(['today', 'week', 'month', 'custom', 'all'] as const).map((value) => (
                <option value={value} key={value}>
                  {t(`analytics.periods.${value}`)}
                </option>
              ))}
            </select>
          </label>
          {period === 'custom' && (
            <>
              <label>
                {t('analytics.start')}
                <input
                  type="date"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </label>
              <label>
                {t('analytics.end')}
                <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
              </label>
            </>
          )}
          <label>
            {t('analytics.agent')}
            <input
              value={agent}
              placeholder={t('analytics.allAgents')}
              onChange={(event) => setAgent(event.target.value)}
            />
          </label>
          <label>
            {t('analytics.adapter')}
            <select
              aria-label={t('analytics.adapter')}
              value={adapter}
              onChange={(event) => setAdapter(event.target.value)}
            >
              <option value="">{t('analytics.allAdapters')}</option>
              {adapters.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('analytics.model')}
            <input
              value={model}
              disabled={unidentified}
              placeholder={t('analytics.allModels')}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
          <label className="analytics-checkbox">
            <input
              type="checkbox"
              checked={unidentified}
              onChange={(event) => setUnidentified(event.target.checked)}
            />
            {t('analytics.unidentifiedOnly')}
          </label>
        </div>
        <p className="fine-print">
          {t('analytics.calendar', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
        </p>
        <p className="fine-print">{t('analytics.identifiers')}</p>
        {!request && (
          <p className="notice" role="alert">
            {t('analytics.invalidCustom')}
          </p>
        )}
      </div>
      <p className="notice analytics-coverage">{t('analytics.incomplete')}</p>
      <section className="panel analytics-export" aria-label={t('analytics.export.title')}>
        <h2>{t('analytics.export.title')}</h2>
        <p className="fine-print">{t('analytics.export.privacy')}</p>
        {desktop ? (
          <p className="notice">{t('analytics.export.desktop')}</p>
        ) : (
          <>
            <button className="button" disabled={!exportable} onClick={() => exportReport('csv')}>
              {t('analytics.export.csv')}
            </button>{' '}
            <button
              className="button"
              disabled={!exportable}
              onClick={() => exportReport('markdown')}
            >
              {t('analytics.export.markdown')}
            </button>
            <p className="fine-print">{t('analytics.export.download')}</p>
            {!data && <p className="notice">{t('analytics.export.blocked')}</p>}
            {data && !exportable && <p className="notice">{t('analytics.export.limits')}</p>}
          </>
        )}
        {exportFailure && <p role="alert">{t('analytics.export.failed')}</p>}
      </section>
      {failure?.key === key && (
        <div className="notice" role="alert">
          {t(`analytics.${failure.reason}`)}
        </div>
      )}
      {request && loading && (
        <p role="status" className="empty-copy">
          {t('analytics.loading')}
        </p>
      )}
      {data && (
        <>
          <section className="stats analytics-stats" aria-label={t('analytics.summary')}>
            <div className="stat">
              <span>{t('analytics.leader')}</span>
              <strong className="analytics-leader">{leader}</strong>
              <small>
                {t(ranking === 'tokens' ? 'analytics.byTokens' : 'analytics.bySessions')}
              </small>
            </div>
            <div className="stat">
              <span>{t('analytics.reportedTokens')}</span>
              <strong>{number(data.usage?.total)}</strong>
              <small>{t('analytics.coveredOnly')}</small>
            </div>
            <div className="stat">
              <span>{t('sessions')}</span>
              <strong>{number(data.sessions)}</strong>
              <small>{t('analytics.nonAdditive')}</small>
            </div>
          </section>
          <section className="panel" aria-label={t('analytics.ranking')}>
            <div className="panel-heading">
              <h2>{t('analytics.ranking')}</h2>
              <label>
                {t('analytics.order')}{' '}
                <select
                  aria-label={t('analytics.order')}
                  value={ranking}
                  onChange={(event) => setRanking(event.target.value as 'tokens' | 'sessions')}
                >
                  <option value="tokens">{t('analytics.byTokens')}</option>
                  <option value="sessions">{t('analytics.bySessions')}</option>
                </select>
              </label>
            </div>
            <p className="fine-print analytics-note">
              {t('analytics.denominator', { tokens: number(data.usage?.total) })}
            </p>
            <p className="fine-print analytics-note">{t('analytics.nonAdditive')}</p>
            {!rows.length ? (
              <p className="empty-copy">{t('analytics.empty')}</p>
            ) : (
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label={t('analytics.ranking')}
              >
                <table className="analytics-table">
                  <caption className="sr-only">{t('analytics.ranking')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('model')}</th>
                      <th scope="col">{t('analytics.adapter')}</th>
                      <th scope="col">{t('analytics.reportedTokens')}</th>
                      <th scope="col">{t('analytics.share')}</th>
                      <th scope="col">{t('sessions')}</th>
                      <th scope="col">{t('input')}</th>
                      <th scope="col">{t('output')}</th>
                      <th scope="col">{t('cached')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const share =
                        row.usage && data.usage && data.usage.total > 0
                          ? row.usage.total / data.usage.total
                          : null;
                      return (
                        <tr key={JSON.stringify([row.adapter, row.model])}>
                          <th scope="row">
                            <span className="analytics-model">
                              {row.model ?? t('analytics.unidentified')}
                            </span>
                            <small className="analytics-provider">
                              {t('analytics.providerUnavailable')}
                            </small>
                          </th>
                          <td>{row.adapter}</td>
                          <td className="mono">{number(row.usage?.total)}</td>
                          <td>
                            <span>
                              {share === null
                                ? t('unknown')
                                : new Intl.NumberFormat(i18n.resolvedLanguage, {
                                    style: 'percent',
                                    maximumFractionDigits: 1,
                                  }).format(share)}
                            </span>
                            {share !== null && (
                              <span className="analytics-bar" aria-hidden="true">
                                <i
                                  style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }}
                                />
                              </span>
                            )}
                          </td>
                          <td>{number(row.sessions)}</td>
                          <td>{number(row.usage?.input)}</td>
                          <td>{number(row.usage?.output)}</td>
                          <td>{number(row.usage?.cached)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="fine-print analytics-note">{t('analytics.cache')}</p>
          </section>
          <section className="panel analytics-evidence" aria-label={t('analytics.coverage')}>
            <h2>{t('analytics.coverage')}</h2>
            <p>
              {t('analytics.coverageCounts', {
                sessions: number(data.coverage.sessions),
                measured: number(data.coverage.sessionsWithCanonicalUsage),
                unidentified: number(data.coverage.unidentifiedContributions),
              })}
            </p>
            <p className="fine-print">{t('analytics.coverageScope')}</p>
            {data.coverage.gaps.length > 0 && (
              <ul>
                {data.coverage.gaps.map((gap) => (
                  <li key={gap.reason}>
                    {t(`analytics.gaps.${gap.reason}`)}: {number(gap.count)}
                  </li>
                ))}
              </ul>
            )}
            <p className="fine-print">{t('analytics.basis')}</p>
            <p className="fine-print">
              {t('analytics.updated', {
                time: result?.at.toLocaleTimeString(i18n.resolvedLanguage),
              })}
            </p>
          </section>
        </>
      )}
      <p className="fine-print analytics-note">{t('analytics.unavailable')}</p>
    </section>
  );
}
