import { RouteHeaderActions } from './AppShell';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { terminalPreparationCatalogSchema, type TerminalPreparationCatalog } from '@orqst/protocol';

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
const catalogCache = new Map<string, TerminalPreparationCatalog>();

function useCatalog(scope?: CatalogScope) {
  const native =
    window.orqstTauriStudio?.contractVersion === 1 ? window.orqstTauriStudio : undefined;
  const workspaceId = scope?.workspaceId;
  const featureId = scope?.featureId;
  const key = JSON.stringify([workspaceId, featureId]);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<{ key: string; revision: number; failed: boolean }>();
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const available = !!native && !!workspaceId && featureId !== undefined;
  useEffect(() => {
    if (!native || !workspaceId || featureId === undefined) return;
    let active = true;
    void native
      .request({ action: 'catalog', workspaceId, featureId })
      .then((reply) => {
        if (!active) return;
        if (reply.status !== 'catalog') throw new Error('Catalog unavailable');
        const catalog = terminalPreparationCatalogSchema.parse(reply.catalog);
        if (catalog.workspaceId !== workspaceId || catalog.featureId !== featureId)
          throw new Error('Catalog scope mismatch');
        catalogCache.set(key, catalog);
        setStatus({ key, revision, failed: false });
      })
      .catch(() => {
        if (active) setStatus({ key, revision, failed: true });
      });
    return () => {
      active = false;
    };
  }, [native, workspaceId, featureId, key, revision]);
  const current = status?.key === key && status.revision === revision ? status : undefined;
  return {
    catalog: available && !current?.failed ? catalogCache.get(key) : undefined,
    pending: available && !current,
    failed: current?.failed,
    available,
    refresh,
  };
}

export function Agents({ scope, compact = false }: { scope?: CatalogScope; compact?: boolean }) {
  const { t } = useTranslation();
  const { catalog, pending, failed, available, refresh } = useCatalog(scope);
  const rows = providers.map((provider) => ({
    provider,
    entry: catalog?.providers.find((candidate) => candidate.provider === provider),
  }));
  function status(entry?: TerminalPreparationCatalog['providers'][number]) {
    if (!entry) return '—';
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
            disabled={!available || pending}
          >
            <RefreshCw size={13} />
            {t('analytics.refresh')}
          </button>
        </RouteHeaderActions>
      )}
      {!compact && failed && <p role="alert">{t('screens.agents.failed')}</p>}
      {pending && <p role="status">{t('screens.agents.checking')}</p>}
      {compact ? (
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
      )}
    </div>
  );
}
