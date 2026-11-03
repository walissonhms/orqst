import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  modelAnalyticsEvolutionSchema,
  modelAnalyticsSummarySchema,
  type ModelAnalyticsEvolution,
  type ModelAnalyticsSummary,
} from '@orqst/protocol';
import { readAnalyticsJSON } from './analytics-export';

/** Mounted only for a current ranking reading; parent key changes revoke pending requests. */
export function ModelEvolution({
  request,
  summary,
}: {
  request: string;
  summary: ModelAnalyticsSummary;
}) {
  const { t, i18n } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [reading, setReading] = useState<{ data: ModelAnalyticsEvolution; at: Date }>();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!attempt) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setReading(undefined);
    setFailed(false);
    const deadline = setTimeout(() => controller.abort(), 12000);
    void fetch(request.replace('/models?', '/models/evolution?'), {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error('Evolution unavailable');
        }
        const data = modelAnalyticsEvolutionSchema.parse(await readAnalyticsJSON(response));
        if (
          JSON.stringify(data.summary) !==
          JSON.stringify(modelAnalyticsSummarySchema.parse(summary))
        )
          throw new Error('Evolution reading differs from ranking');
        if (active && !controller.signal.aborted) setReading({ data, at: new Date() });
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        clearTimeout(deadline);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearTimeout(deadline);
      controller.abort();
    };
  }, [attempt, request, summary]);
  const number = (value: number | undefined) =>
    value === undefined ? t('unknown') : new Intl.NumberFormat(i18n.resolvedLanguage).format(value);
  const date = (value: string) =>
    new Intl.DateTimeFormat(i18n.resolvedLanguage, {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(value));
  const data = reading?.data;
  const maximum = Math.max(0, ...(data?.buckets.map((bucket) => bucket.usage?.total ?? 0) ?? []));
  return (
    <section className="panel analytics-evolution" aria-labelledby="evolution-title">
      <div className="panel-heading">
        <h2 id="evolution-title">{t('analytics.evolution.title')}</h2>
        <button
          className="button"
          disabled={loading}
          onClick={() => setAttempt((value) => value + 1)}
        >
          {t(attempt ? 'analytics.evolution.retry' : 'analytics.evolution.show')}
        </button>
      </div>
      <p className="fine-print">{t('analytics.evolution.basis')}</p>
      <p className="fine-print">{t('analytics.evolution.filters')}</p>
      {loading && <p role="status">{t('analytics.loading')}</p>}
      {failed && <p role="alert">{t('analytics.evolution.failed')}</p>}
      {data && (
        <>
          <p className="notice">{t('analytics.evolution.windows', { days: data.bucketDays })}</p>
          <dl className="analytics-evolution-totals">
            <dt>{t('analytics.evolution.coveredTotal')}</dt>
            <dd>{number(data.summary.usage?.total)}</dd>
            <dt>{t('analytics.evolution.undistributed')}</dt>
            <dd>{number(data.undistributedUsage?.total)}</dd>
          </dl>
          <p className="fine-print">{t('analytics.evolution.reconciliation')}</p>
          {!data.buckets.length ? (
            <p>{t('analytics.evolution.empty')}</p>
          ) : (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label={t('analytics.evolution.title')}
            >
              <table className="analytics-table">
                <caption>{t('analytics.evolution.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('analytics.evolution.from')}</th>
                    <th scope="col">{t('analytics.evolution.to')}</th>
                    <th scope="col">{t('analytics.reportedTokens')}</th>
                    <th scope="col">{t('input')}</th>
                    <th scope="col">{t('output')}</th>
                    <th scope="col">{t('cached')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.buckets.map((bucket) => (
                    <tr key={bucket.from}>
                      <th scope="row">
                        <time dateTime={bucket.from}>{date(bucket.from)}</time>
                      </th>
                      <td>
                        <time dateTime={bucket.to}>{date(bucket.to)}</time>
                      </td>
                      <td>
                        {number(bucket.usage?.total)}
                        {bucket.usage && (
                          <span className="analytics-bar" aria-hidden="true">
                            <i
                              style={{
                                width: `${maximum ? (bucket.usage.total / maximum) * 100 : 0}%`,
                              }}
                            />
                          </span>
                        )}
                      </td>
                      <td>{number(bucket.usage?.input)}</td>
                      <td>{number(bucket.usage?.output)}</td>
                      <td>{number(bucket.usage?.cached)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="fine-print">{t('analytics.evolution.missing')}</p>
          <p className="fine-print">
            {t('analytics.updated', { time: reading.at.toLocaleTimeString(i18n.resolvedLanguage) })}
          </p>
        </>
      )}
    </section>
  );
}
