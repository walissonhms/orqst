import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PaneLifecycleContent } from './PaneLifecycleContent.js';
import type { TerminalOpenCard } from './terminal-lifecycle.js';

export function TerminalOpeningCard({
  card,
  onRetry,
  onLocateReservation,
}: {
  card: TerminalOpenCard;
  onRetry?: () => void;
  onLocateReservation?: () => void;
}) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState(false);
  const reserved = card.failure?.reason === 'capacity_reserved';
  return (
    <PaneLifecycleContent
      lifecycle={card}
      onRetry={reserved ? undefined : onRetry}
      onChangeCli={reserved ? undefined : onRetry}
      onViewLogs={reserved ? undefined : () => setLogs((open) => !open)}
      onLocateReservation={reserved ? onLocateReservation : undefined}
      details={
        !reserved &&
        logs &&
        card.failure && (
          <section aria-label={t('paneLifecycle.viewLogs')}>
            <code>{card.failure.evidence}</code>
          </section>
        )
      }
    />
  );
}
