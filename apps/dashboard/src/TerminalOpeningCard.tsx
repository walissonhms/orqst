import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PaneLifecycleContent, PaneLifecycleStatus } from './PaneLifecycleContent.js';
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
    <>
      {card.state === 'failed' && <PaneLifecycleStatus lifecycle={card} />}
      <PaneLifecycleContent
        lifecycle={card}
        onRetry={onRetry}
        onChangeCli={onRetry}
        onViewLogs={() => setLogs((open) => !open)}
      />
      {logs && card.failure && (
        <section aria-label={t('paneLifecycle.viewLogs')}>
          <code>{card.failure.evidence}</code>
        </section>
      )}
    </>
  );
}
