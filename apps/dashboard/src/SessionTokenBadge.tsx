import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import type { LiveMetricsState } from './use-session-metrics';

/** Reuses the open inspector's confirmed query; never falls back to summary zeros. */
export function SessionTokenBadge({
  state,
  offline,
}: {
  state?: LiveMetricsState;
  offline: boolean;
}) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.resolvedLanguage ?? 'en-US');
  const metric = state?.confirmed;
  const stale = offline || !state || state.stale;
  return (
    <details className="session-token-badge">
      <summary>
        <Zap size={14} aria-hidden="true" />
        <span>
          {t('tokens')}: <strong>{metric ? number.format(metric.usage.total) : '—'}</strong>
        </span>
        <small>
          {t(metric ? (stale ? 'shell.metrics.outdated' : 'shell.metrics.confirmed') : 'unknown')}
        </small>
      </summary>
      <div className="token-badge-popover">
        <h2>{t('liveMetrics.title')}</h2>
        <p>
          {t(
            offline
              ? 'liveMetrics.offline'
              : !state
                ? 'liveMetrics.loading'
                : state.failed
                  ? 'liveMetrics.failed'
                  : state.pending
                    ? 'liveMetrics.loading'
                    : state.stale
                      ? 'liveMetrics.stale'
                      : 'liveMetrics.confirmed',
          )}
        </p>
        {metric ? (
          <>
            <dl>
              {(['input', 'output', 'cached'] as const).map((key) => (
                <div key={key}>
                  <dt>{t(key)}</dt>
                  <dd>{number.format(metric.usage[key])}</dd>
                </div>
              ))}
            </dl>
            <p>
              {t('liveMetrics.updated')}{' '}
              <time dateTime={metric.evidence.occurredAt}>
                {new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'en-US', {
                  dateStyle: 'short',
                  timeStyle: 'medium',
                }).format(new Date(metric.evidence.occurredAt))}
              </time>
            </p>
            <p>{t('liveMetrics.snapshotNote')}</p>
          </>
        ) : (
          <p>{t('liveMetrics.noConfirmed')}</p>
        )}
      </div>
    </details>
  );
}
