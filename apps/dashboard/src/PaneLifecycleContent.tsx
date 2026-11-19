import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaneLifecycle } from './terminal-lifecycle.js';
import './pane-lifecycle.css';

export function PaneLifecycleStatus({ lifecycle }: { lifecycle: PaneLifecycle }) {
  const { t } = useTranslation();
  return (
    <span className="pane-lifecycle" data-state={lifecycle.state} role="status">
      <span className="pane-lifecycle-dot" aria-hidden="true" />
      {t(`paneLifecycle.state.${lifecycle.state}`)}
    </span>
  );
}

/** Use inside an existing PaneCard, for opening or failed state only. */
export function PaneLifecycleContent({
  lifecycle,
  onRetry,
  onChangeCli,
  onViewLogs,
  onCancel,
  onReconnect,
  details,
}: {
  lifecycle: PaneLifecycle;
  onRetry?: () => void;
  onChangeCli?: () => void;
  onViewLogs?: () => void;
  onCancel?: () => void;
  onReconnect?: () => void;
  details?: ReactNode;
}) {
  const { t } = useTranslation();
  if (lifecycle.state === 'starting')
    return (
      <div className="pane-lifecycle-content">
        <PaneLifecycleStatus lifecycle={lifecycle} />
        {onCancel && (
          <button className="button" type="button" onClick={onCancel}>
            {t('features.cancel')}
          </button>
        )}
      </div>
    );
  if (lifecycle.state === 'disconnected')
    return (
      <div className="pane-lifecycle-content">
        <PaneLifecycleStatus lifecycle={lifecycle} />
        {onReconnect && (
          <button className="button" type="button" onClick={onReconnect}>
            {t('paneLifecycle.reconnect')}
          </button>
        )}
      </div>
    );
  const failure = lifecycle.failure;
  if (lifecycle.state !== 'failed' || !failure) return null;
  return (
    <div className="pane-lifecycle-content" role="alert">
      <PaneLifecycleStatus lifecycle={lifecycle} />
      <p>{t(`paneLifecycle.failure.${failure.reason}`, { exitCode: failure.exitCode })}</p>
      <div className="pane-lifecycle-actions">
        {onRetry && (
          <button className="button" type="button" disabled={!failure.retryable} onClick={onRetry}>
            {t(
              failure.reason === 'cli_review_required'
                ? 'studio.cliReview.action'
                : 'paneLifecycle.retry',
            )}
          </button>
        )}
        {onChangeCli && failure.reason !== 'cli_review_required' && (
          <button
            className="button"
            type="button"
            disabled={!failure.retryable}
            onClick={onChangeCli}
          >
            {t('paneLifecycle.changeCli')}
          </button>
        )}
        {onViewLogs && (
          <button className="button" type="button" onClick={onViewLogs}>
            {t('paneLifecycle.viewLogs')}
          </button>
        )}
      </div>
      {details}
    </div>
  );
}
