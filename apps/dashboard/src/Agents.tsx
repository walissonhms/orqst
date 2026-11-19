import { CliReviewStatus, reviewTerminalCli } from './CliReviewStatus';
import { loadTerminalCatalog } from './terminal-catalog-cache';
import { RouteHeaderActions } from './AppShell';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import {
  cliDiscoverySchema,
  terminalPreparationCatalogSchema,
  type TerminalPreparationCatalog,
} from '@orqst/protocol';

const installDocs = {
  codex: 'https://learn.chatgpt.com/docs/codex/cli',
  opencode: 'https://opencode.ai/docs/',
  claude: 'https://code.claude.com/docs/en/setup#install-claude-code',
  antigravity: 'https://antigravity.google/docs/getting-started?tab=cli',
};
const providers = ['codex', 'opencode', 'claude', 'antigravity'] as const;
export interface CatalogScope {
  workspaceId: string;
  featureId: string | null;
}

function useCatalog(scope?: CatalogScope) {
  const native =
    window.orqstTauriStudio?.contractVersion === 1 ? window.orqstTauriStudio : undefined;
  const workspaceId = scope?.workspaceId;
  const featureId = scope?.featureId;
  const key = JSON.stringify([workspaceId, featureId]);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<{
    key: string;
    revision: number;
    catalog?: TerminalPreparationCatalog;
    generation?: number;
  }>();
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const available = !!native && !!workspaceId && featureId !== undefined;
  useEffect(() => {
    if (!native || !workspaceId || featureId === undefined) return;
    let active = true;
    void loadTerminalCatalog(native, { workspaceId, featureId }, revision > 0)
      .then((reply) => {
        if (!active) return;
        if (reply.status !== 'catalog') throw new Error('Catalog unavailable');
        const catalog = terminalPreparationCatalogSchema.parse(reply.catalog);
        if (catalog.workspaceId !== workspaceId || catalog.featureId !== featureId)
          throw new Error('Catalog scope mismatch');
        setStatus({ key, revision, catalog, generation: reply.snapshot?.generation });
      })
      .catch(() => {
        if (active) setStatus({ key, revision });
      });
    return () => {
      active = false;
    };
  }, [native, workspaceId, featureId, key, revision]);
  const current = status?.key === key && status.revision === revision ? status : undefined;
  return {
    catalog: available ? current?.catalog : undefined,
    native,
    generation: current?.generation,
    pending: available && !current,
    failed: !!current && !current.catalog,
    available,
    refresh,
  };
}

function CatalogFailure({ retry }: { retry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="spec-actions">
      <p role="alert">{t('screens.agents.failed')}</p>
      {retry && (
        <button className="button" type="button" onClick={retry}>
          {t('paneLifecycle.retry')}
        </button>
      )}
    </div>
  );
}

export function CliDiscovery() {
  const { t } = useTranslation();
  const native = window.orqstTauriStudio;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    attempt: number;
    data?: ReturnType<typeof cliDiscoverySchema.parse>;
  }>();
  useEffect(() => {
    if (!native) return;
    let active = true;
    void native.request({ action: 'discovery' }).then(
      (reply) => {
        if (!active) return;
        const parsed = cliDiscoverySchema.safeParse(
          reply.status === 'discovery' ? reply.clis : undefined,
        );
        setResult({ attempt, data: parsed.success ? parsed.data : undefined });
      },
      () => {
        if (active) setResult({ attempt });
      },
    );
    return () => {
      active = false;
    };
  }, [native, attempt]);
  if (!native) return <p>{t('screens.agents.failed')}</p>;
  if (result?.attempt !== attempt) return <p role="status">{t('screens.agents.checking')}</p>;
  if (!result.data) return <CatalogFailure retry={() => setAttempt(attempt + 1)} />;
  return (
    <ul className="spec-rows">
      {result.data.map(({ provider, lookup }) => (
        <li key={provider}>
          <strong>{t(`screens.cli.${provider}`)}</strong>
          <span>
            {t(
              `screens.agents.${lookup === 'candidate_found' ? 'installed' : lookup === 'not_found' ? 'missing' : 'checkNeeded'}`,
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Agents({ scope, compact = false }: { scope?: CatalogScope; compact?: boolean }) {
  const { t } = useTranslation();
  const { catalog, native, generation, pending, failed, available, refresh } = useCatalog(scope);
  const [reviewing, setReviewing] = useState(false);
  async function review(entry: TerminalPreparationCatalog['providers'][number]) {
    if (!catalog || !native || generation === undefined || reviewing) return;
    setReviewing(true);
    try {
      await reviewTerminalCli(native, catalog, generation, entry);
    } finally {
      setReviewing(false);
      refresh();
    }
  }
  if (!available) return <CliDiscovery />;

  const rows = providers.map((provider) => ({
    provider,
    entry: catalog?.providers.find((candidate) => candidate.provider === provider),
  }));
  function status(entry?: TerminalPreparationCatalog['providers'][number]) {
    if (!entry) return t('screens.agents.checkNeeded');
    if (entry.status === 'available' || entry.path) return t('screens.agents.installed');
    if (entry.reason === 'executable_not_found') return t('screens.agents.missing');
    return t('screens.agents.checkNeeded');
  }
  return (
    <div className="spec-cli">
      {!compact && (
        <RouteHeaderActions>
          <button
            className="button"
            type="button"
            onClick={refresh}
            disabled={!available || pending || reviewing}
          >
            <RefreshCw size={13} />
            {t('analytics.refresh')}
          </button>
        </RouteHeaderActions>
      )}
      {failed && <CatalogFailure retry={refresh} />}
      {pending && <p role="status">{t('screens.agents.checking')}</p>}
      {catalog &&
        (compact ? (
          <ul className="spec-rows">
            {rows.map(({ provider, entry }) => (
              <li key={provider}>
                <strong>{t(`screens.cli.${provider}`)}</strong>
                <span>{status(entry)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label={t('screens.agents.matrix')}
          >
            <table className="spec-table spec-cli-matrix">
              <thead>
                <tr>
                  <th scope="col">{t('screens.cliLabel')}</th>
                  {rows.map(({ provider }) => (
                    <th scope="col" key={provider}>
                      {t(`screens.cli.${provider}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">{t('status')}</th>
                  {rows.map(({ provider, entry }) => (
                    <td
                      key={provider}
                      title={entry ? t(`studio.tauri.catalog_${entry.reason}`) : undefined}
                    >
                      {status(entry)}
                      {entry && (
                        <CliReviewStatus
                          entry={entry}
                          busy={reviewing || pending || generation === undefined}
                          onReview={(entry) => void review(entry).catch(() => undefined)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
                {(['path', 'version', 'login', 'terminal', 'messages', 'tokens'] as const).map(
                  (key) => (
                    <tr key={key}>
                      <th scope="row">{t(`screens.agents.${key}`)}</th>
                      {rows.map(({ provider, entry }) => (
                        <td key={provider}>
                          {key === 'path' || key === 'version'
                            ? (entry?.[key] ?? '—')
                            : key === 'terminal'
                              ? t('screens.agents.pty')
                              : key === 'messages'
                                ? t(
                                    `screens.agents.${provider === 'antigravity' ? 'noRelay' : provider === 'claude' ? 'mcpRelay' : 'autoRelay'}`,
                                  )
                                : key === 'tokens' && provider !== 'antigravity'
                                  ? t('screens.agents.whenReported')
                                  : '—'}
                        </td>
                      ))}
                    </tr>
                  ),
                )}
                <tr>
                  <th scope="row">{t('screens.agents.models')}</th>
                  {rows.map(({ provider, entry }) => (
                    <td key={provider}>
                      {entry?.models.length ? (
                        <details>
                          <summary>
                            {t('screens.agents.modelCount', { count: entry.models.length })}
                          </summary>
                          <ul>
                            {entry.models.map((model) => (
                              <li key={model.id}>{model.label}</li>
                            ))}
                          </ul>
                        </details>
                      ) : (
                        '—'
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">{t('screens.agents.installation')}</th>
                  {rows.map(({ provider, entry }) => (
                    <td key={provider}>
                      {entry?.reason === 'executable_not_found' ? (
                        <a
                          className="button"
                          href={installDocs[provider]}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={t('screens.agents.installProvider', {
                            provider: t(`screens.cli.${provider}`),
                          })}
                        >
                          {t('screens.agents.install')}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
