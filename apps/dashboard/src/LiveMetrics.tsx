import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LiveMetricsState } from './use-session-metrics';
import { TokenThresholdControl } from './TokenThresholdControl';

const usageKeys = ['input', 'output', 'cached', 'total'] as const;

export function LiveMetrics({
  state,
  announce = false,
  threshold,
  onThresholdChange,
}: {
  state: LiveMetricsState;
  announce?: boolean;
  threshold?: number;
  onThresholdChange?: (value: number | undefined) => void;
}) {
  const { t, i18n } = useTranslation();
  const metric = state.confirmed;
  const previous = useRef(metric);
  const [update, setUpdate] = useState<{
    sequence: number;
    fields: (typeof usageKeys)[number][];
  }>();
  const eligible = !state.stale && state.result?.availability === 'available';
  useEffect(() => {
    const prior = previous.current;
    previous.current = metric;
    if (!eligible) {
      setUpdate(undefined);
      return;
    }
    // The first reading (including a newly opened artifact) is a baseline, not an update.
    // Equal reads/reconnection never restart the cue; time and counts are never inferred.
    if (!metric || !prior || metric.evidence.sequence <= prior.evidence.sequence) return;
    const fields = usageKeys.filter((key) => metric.usage[key] !== prior.usage[key]);
    setUpdate(fields.length ? { sequence: metric.evidence.sequence, fields } : undefined);
  }, [metric, eligible]);
  useEffect(() => {
    if (!update) return;
    const timeout = setTimeout(() => setUpdate(undefined), 1600);
    return () => clearTimeout(timeout);
  }, [update]);
  const locale = i18n.resolvedLanguage ?? 'en-US';
  const number = new Intl.NumberFormat(locale);
  const thresholdStatus = (available: boolean) =>
    threshold === undefined
      ? ''
      : t('liveMetrics.threshold.value', { value: number.format(threshold) }) +
        ' ' +
        t(
          !available || !metric
            ? 'liveMetrics.threshold.unavailable'
            : metric.usage.total >= threshold
              ? 'liveMetrics.threshold.reached'
              : 'liveMetrics.threshold.below',
        );
  // Pending is visual only. Repeated snapshot reconciliation keeps this text stable;
  // only the session header announces meaningful state/count changes.
  const announcement = state.offline
    ? t('liveMetrics.offline')
    : state.failed
      ? t('liveMetrics.failed')
      : state.result?.availability === 'unavailable'
        ? `${t('liveMetrics.stale')} ${t(`liveMetrics.unavailable.${state.result.reason}`)}`
        : metric
          ? `${t('liveMetrics.confirmed')} ${t('liveMetrics.confirmedCounts', {
              input: number.format(metric.usage.input),
              output: number.format(metric.usage.output),
              cached: number.format(metric.usage.cached),
              total: number.format(metric.usage.total),
            })}`
          : '';
  return (
    <section
      className="live-metrics"
      aria-label={t('liveMetrics.title')}
      aria-busy={state.pending && !state.offline}
    >
      <p className="eyebrow">{t('liveMetrics.title')}</p>
      {announce && (
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}{' '}
          {thresholdStatus(
            !state.offline && !state.failed && state.result?.availability === 'available',
          )}
        </p>
      )}
      <p className="fine-print">
        {state.offline
          ? t('liveMetrics.offline')
          : state.failed
            ? t('liveMetrics.failed')
            : state.pending
              ? t('liveMetrics.loading')
              : state.stale
                ? t('liveMetrics.stale')
                : t('liveMetrics.confirmed')}
      </p>
      {state.result?.availability === 'unavailable' && (
        <p className="fine-print">{t(`liveMetrics.unavailable.${state.result.reason}`)}</p>
      )}
      {threshold !== undefined && (
        <p
          className={`fine-print live-token-threshold${eligible && metric && metric.usage.total >= threshold ? ' live-token-threshold-reached' : ''}`}
        >
          {thresholdStatus(eligible)}
        </p>
      )}
      {onThresholdChange && <TokenThresholdControl onChange={onThresholdChange} />}
      {metric ? (
        <>
          <dl className="live-metric-values" role="group" aria-label={t('usage')}>
            {usageKeys.map((key) => {
              const updated =
                eligible &&
                update?.sequence === metric.evidence.sequence &&
                update.fields.includes(key);
              return (
                <div key={key}>
                  <dt>{t(key === 'total' ? 'tokens' : key)}</dt>
                  <dd>
                    <strong
                      key={updated ? update.sequence : 'settled'}
                      className={updated ? 'live-metric-updated' : undefined}
                    >
                      {number.format(metric.usage[key])}
                    </strong>
                    <span className="live-metric-update-label">
                      {updated && t('liveMetrics.valueUpdated')}
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="fine-print">
            {t('liveMetrics.updated')}{' '}
            <time dateTime={metric.evidence.occurredAt} title={metric.evidence.occurredAt}>
              {new Intl.DateTimeFormat(locale, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'short',
              }).format(new Date(metric.evidence.occurredAt))}
            </time>
          </p>
          <p className="fine-print">{t('liveMetrics.snapshotNote')}</p>
          <details className="live-metric-provenance">
            <summary>{t('liveMetrics.provenance')}</summary>
            <p className="fine-print">{t('liveMetrics.provenanceNote')}</p>
            <p className="fine-print">{t('liveMetrics.normalizationNote')}</p>
            <div className="live-metric-evidence">
              <strong>{t('artifacts.project')}</strong>
              <span>{metric.identity.sourceWorkspaceId}</span>
              <strong>{t('artifacts.session')}</strong>
              <span>{metric.identity.sessionRef.nativeSessionId}</span>
              <strong>{t('artifacts.machine')}</strong>
              <span>{metric.identity.sessionRef.machineId}</span>
              <strong>{t('artifacts.agent')}</strong>
              <span>{metric.identity.agentId}</span>
              <strong>{t('artifacts.event')}</strong>
              <span>
                {metric.evidence.eventId} / {metric.evidence.sequence}
              </span>
              <strong>{t('source')}</strong>
              <span>
                {metric.evidence.source.file}:{metric.evidence.source.line} /{' '}
                {metric.evidence.source.offset} / {metric.evidence.source.recordType}
                <br />
                {metric.evidence.source.hash}
              </span>
              <strong>{t('correlation')}</strong>
              <span>
                {metric.evidence.turnId ?? t('unknown')} /{' '}
                {metric.evidence.responseId ?? t('unknown')}
              </span>
            </div>
          </details>
        </>
      ) : (
        <p className="fine-print">{t('liveMetrics.noConfirmed')}</p>
      )}
    </section>
  );
}
