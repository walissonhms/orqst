import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TauriStudio, TerminalPreparationCatalog } from '@orqst/protocol';
import { CliReviewStatus, reviewTerminalCli } from './CliReviewStatus.js';
import { loadTerminalCatalog } from './terminal-catalog-cache.js';

type Entry = TerminalPreparationCatalog['providers'][number];
type CatalogReply = Extract<Awaited<ReturnType<TauriStudio['request']>>, { status: 'catalog' }>;

export function SettingsCliReviews({
  native,
  workspaceId,
  featureId,
}: {
  native: TauriStudio;
  workspaceId: string;
  featureId: string | null;
}) {
  const { t } = useTranslation();
  const [reply, setReply] = useState<CatalogReply>();
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const refresh = useCallback(
    async (force = false) => {
      const token = ++version.current;
      setBusy(true);
      try {
        const result = await loadTerminalCatalog(native, { workspaceId, featureId }, force);
        if (version.current === token) setReply(result.status === 'catalog' ? result : undefined);
      } catch {
        if (version.current === token) setReply(undefined);
      } finally {
        if (version.current === token) setBusy(false);
      }
    },
    [native, workspaceId, featureId],
  );
  useEffect(() => {
    void refresh();
    return () => {
      version.current++;
    };
  }, [refresh]);

  const review = async (entry: Entry) => {
    if (
      !reply?.snapshot ||
      busy ||
      reply.catalog.workspaceId !== workspaceId ||
      reply.catalog.featureId !== featureId
    )
      return;
    setBusy(true);
    const token = ++version.current;
    try {
      await reviewTerminalCli(native, reply.catalog, reply.snapshot.generation, entry);
    } finally {
      if (version.current === token) await refresh(true);
    }
  };

  return (
    <section className="panel settings-group" aria-labelledby="settings-agents">
      <h2 id="settings-agents">{t('shell.views.agents')}</h2>
      {reply?.catalog.providers.map((entry) => (
        <CliReviewStatus
          key={entry.provider}
          entry={entry}
          busy={busy}
          onReview={(entry) => {
            void review(entry).catch(() => undefined);
          }}
        />
      ))}
      <button type="button" className="button" disabled={busy} onClick={() => void refresh(true)}>
        {t('studio.cliReview.refresh')}
      </button>
    </section>
  );
}
