import { useTranslation } from 'react-i18next';
import type { TauriStudio, TerminalPreparationCatalog } from '@orqst/protocol';

type Entry = TerminalPreparationCatalog['providers'][number];

export function reviewTerminalCli(
  native: TauriStudio,
  catalog: TerminalPreparationCatalog,
  generation: number,
  entry: Entry,
) {
  if (!entry.reviewId) return;
  return native.request({
    action: 'review-cli',
    workspaceId: catalog.workspaceId,
    featureId: catalog.featureId,
    catalogId: catalog.catalogId,
    generation,
    provider: entry.provider,
    reviewId: entry.reviewId,
  });
}

export function CliReviewStatus({
  entry,
  busy,
  onReview,
}: {
  entry: Entry;
  busy?: boolean;
  onReview: (entry: Entry) => void;
}) {
  const { t } = useTranslation();
  const name = t(`terminalStudio.providers.${entry.provider}`);
  if (entry.verifiedUpdate)
    return (
      <p className="fine-print" role="status">
        {t('studio.cliReview.verified', { name, version: entry.verifiedUpdate })}
      </p>
    );
  if (!entry.reviewId) return null;
  return (
    <p className="fine-print">
      {name} · {t('studio.cliReview.required')}{' '}
      <button type="button" className="ntd-link" disabled={busy} onClick={() => onReview(entry)}>
        {t('studio.cliReview.action')}
      </button>
    </p>
  );
}
