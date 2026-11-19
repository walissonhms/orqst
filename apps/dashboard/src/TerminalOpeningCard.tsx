import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PaneLifecycleContent } from './PaneLifecycleContent.js';
import type { TerminalOpenCard } from './terminal-lifecycle.js';

export function TerminalOpeningCard({
  card,
  onRetry,
}: {
  card: TerminalOpenCard;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState(false);
  return (
    <PaneLifecycleContent
      lifecycle={card}
      onRetry={onRetry}
      onChangeCli={onRetry}
      onViewLogs={() => setLogs((open) => !open)}
      details={
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
