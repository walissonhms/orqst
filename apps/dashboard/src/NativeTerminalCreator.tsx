import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  TerminalBatchItem,
  TauriStudio,
  TauriStudioSnapshot,
  TerminalPreparationCatalog,
  TerminalPreparationFailure,
} from '@orqst/protocol';
import { NewTerminalDialog, type TerminalRequest } from './NewTerminalDialog.js';
import { Modal } from './Modal.js';
import { catalogModelId, dialogCatalog } from './native-terminal-catalog.js';

type Native = TauriStudio;
type Entry = TerminalPreparationCatalog['providers'][number];

/** Save the descriptive orchestrator label on the Feature (current revision only). */
async function labelOrchestrator(featureId: string, terminalId: string) {
  const features = window.orqstFeatures?.contractVersion === 1 ? window.orqstFeatures : undefined;
  if (!features) return;
  try {
    const reply = await features.request({ contractVersion: 1, generation: 0, action: 'snapshot' });
    const feature = reply.snapshot?.features.find((entry) => entry.featureId === featureId);
    if (!reply.snapshot || !feature?.terminalIds.includes(terminalId)) return;
    await features.request({
      contractVersion: 1,
      generation: reply.snapshot.generation,
      action: 'update',
      featureId,
      input: { expectedRevision: feature.revision, orchestratorTerminalId: terminalId },
    });
  } catch {
    // The label is optional; the terminals are already open.
  }
}

interface Props {
  native: Native;
  workspace: { id: string; name: string };
  featureId: string | null;
  /** Open the previous detailed form (MCP pair, path review). */
  onAdvanced?: () => void;
  onClose: () => void;
}

/**
 * Opens terminals through the existing reviewed native preparation flow. Several
 * terminals of one CLI and model are one `create-selected` request.
 */
export function NativeTerminalCreator({
  native,
  workspace,
  featureId,
  onAdvanced,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<TerminalPreparationCatalog>();
  const [snapshot, setSnapshot] = useState<TauriStudioSnapshot>();
  const [state, setState] = useState<'loading' | 'ready' | 'opening' | 'done' | 'error'>('loading');
  const [results, setResults] = useState<
    (TerminalBatchItem & { name: string; orchestrator: boolean })[]
  >([]);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState<TerminalPreparationFailure>();

  const load = useCallback(async () => {
    setState('loading');
    try {
      const first = await native.request({ action: 'snapshot' });
      if (first.status !== 'catalog' && first.snapshot) setSnapshot(first.snapshot);
      const reply = await native.request({
        action: 'catalog',
        workspaceId: workspace.id,
        featureId,
      });
      if (
        reply.status === 'catalog' &&
        reply.catalog.workspaceId === workspace.id &&
        reply.catalog.featureId === featureId
      ) {
        setCatalog(reply.catalog);
        setState('ready');
      } else {
        setState('error');
        setMessage(t('studio.tauri.denied'));
      }
    } catch {
      setState('error');
      setMessage(t('studio.unavailable'));
    }
  }, [native, workspace.id, featureId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** One native batch: every terminal gets its own accepted/refused/unknown result. */
  const open = async (requests: TerminalRequest[]) => {
    if (!catalog || !snapshot) return;
    setState('opening');
    setFailure(undefined);
    const counts = new Map<string, number>();
    const items = requests.map((request) => {
      const entry = catalog.providers.find((p) => p.provider === request.provider);
      const n = (counts.get(request.provider) ?? 0) + 1;
      counts.set(request.provider, n);
      return {
        request,
        id: crypto.randomUUID(),
        workspaceId: request.workspaceId,
        provider: request.provider as Entry['provider'],
        // `null` keeps the CLI's own default model; explicit ids must be in the catalog.
        modelId: request.model === null ? null : catalogModelId(entry, request.model),
        name: request.name || `${t(`terminalStudio.providers.${request.provider}`)} ${n}`,
      };
    });
    if (items.some((item) => item.request.model !== null && !item.modelId)) {
      setState('error');
      setMessage(t('terminalStudio.create.unavailable'));
      return;
    }
    try {
      const reply = await native.request({
        action: 'create-batch',
        generation: snapshot.generation,
        workspaceId: workspace.id,
        featureId,
        catalogId: catalog.catalogId,
        requests: items.map(({ id, workspaceId, provider, modelId, name }) => ({
          id,
          workspaceId,
          provider,
          modelId,
          name,
        })),
      });
      if (reply.status !== 'batch') {
        setState('error');
        if (reply.status !== 'catalog' && 'failure' in reply && reply.failure)
          setFailure(reply.failure);
        setMessage(t(reply.status === 'denied' ? 'studio.tauri.denied' : `studio.${reply.status}`));
        return;
      }
      setResults(
        reply.items.map((result) => ({
          ...result,
          name: items.find((item) => item.id === result.id)?.name ?? '?',
          orchestrator: items.find((item) => item.id === result.id)?.request.orchestrator === true,
        })),
      );
      // The orchestrator label needs the new terminal ID; it grants nothing.
      const lead = reply.items.find(
        (result) =>
          result.status === 'accepted' &&
          result.terminalId &&
          items.find((item) => item.id === result.id)?.request.orchestrator,
      );
      if (lead?.terminalId && featureId) void labelOrchestrator(featureId, lead.terminalId);
      setState('done');
    } catch {
      setState('error');
      setMessage(t('studio.unavailable'));
    }
  };

  if (state === 'ready' || state === 'opening')
    return (
      <NewTerminalDialog
        catalog={dialogCatalog(catalog!)}
        workspaces={[workspace]}
        initialWorkspaceId={workspace.id}
        max={Math.max(0, (snapshot?.limit ?? 8) - (snapshot?.count ?? 0))}
        allowOrchestrator={featureId !== null && !!window.orqstFeatures}
        busy={state === 'opening'}
        onCancel={onClose}
        onAdvanced={onAdvanced}
        onConfirm={(requests) => void open(requests)}
      />
    );
  return (
    <Modal label={t('terminalStudio.create.title')} className="ntd" onClose={onClose}>
      <div className="ntd-form ntd-status">
        <header className="ntd-head">
          <div>
            <h2>{t('terminalStudio.create.title')}</h2>
            <p>
              {state === 'loading'
                ? t('terminalStudio.create.loading')
                : state === 'done'
                  ? t('terminalStudio.batch.summary', {
                      accepted: results.filter((r) => r.status === 'accepted').length,
                      total: results.length,
                    })
                  : message}
            </p>
          </div>
        </header>
        {state === 'done' && (
          <ul className="ntd-results">
            {results.map((result) => (
              <li key={result.id} className={`ntd-result ntd-result-${result.status}`}>
                <span className="ntd-result-dot" aria-hidden="true" />
                <strong>{result.name}</strong>
                <span>{t(`terminalStudio.batch.status.${result.status}`)}</span>
                {result.status !== 'accepted' && (
                  <small>{t(`terminalStudio.batch.reason.${result.reason}`)}</small>
                )}
                {result.status === 'unknown' && (
                  <small>{t('terminalStudio.batch.possibleEffects')}</small>
                )}
              </li>
            ))}
          </ul>
        )}
        {failure && (
          <p className="ntd-hint ntd-over">
            {t(`tauriPreparation.code_${failure.code}`)}.{' '}
            {t(`tauriPreparation.failure_${failure.effects}`)}
          </p>
        )}
        <footer className="ntd-foot">
          <span className="ntd-summary" />
          {onAdvanced && (
            <button type="button" className="ntd-secondary" onClick={onAdvanced}>
              {t('terminalStudio.create.advanced')}
            </button>
          )}
          {state === 'error' && (
            <button type="button" className="ntd-secondary" onClick={() => void load()}>
              {t('studio.refresh')}
            </button>
          )}
          <button type="button" className="ntd-primary" onClick={onClose}>
            {t('terminalStudio.mention.close')}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
