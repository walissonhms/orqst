import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  TauriStudio,
  TauriStudioSnapshot,
  TerminalPreparationCatalog,
  TerminalPreparationFailure,
} from '@orqst/protocol';
import { NewTerminalDialog, type TerminalRequest } from './NewTerminalDialog.js';
import { Modal } from './Modal.js';
import { catalogModelId, dialogCatalog, groupRequests } from './native-terminal-catalog.js';

type Native = TauriStudio;
type Entry = TerminalPreparationCatalog['providers'][number];

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
  const [state, setState] = useState<'loading' | 'ready' | 'opening' | 'error'>('loading');
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

  const open = async (requests: TerminalRequest[]) => {
    if (!catalog || !snapshot) return;
    setState('opening');
    setFailure(undefined);
    let generation = snapshot.generation;
    for (const group of groupRequests(requests)) {
      const entry = catalog.providers.find((p) => p.provider === group.provider);
      const modelId = catalogModelId(entry, group.model);
      if (!entry || !modelId) {
        setState('error');
        setMessage(t('terminalStudio.create.unavailable'));
        return;
      }
      try {
        const reply = await native.request({
          action: 'create-selected',
          generation,
          workspaceId: workspace.id,
          featureId,
          catalogId: catalog.catalogId,
          provider: group.provider as Entry['provider'],
          modelId,
          count: group.count,
        });
        if (reply.status !== 'ok') {
          setState('error');
          if (reply.status !== 'catalog' && reply.failure) setFailure(reply.failure);
          setMessage(
            t(reply.status === 'denied' ? 'studio.tauri.denied' : `studio.${reply.status}`),
          );
          return;
        }
        generation = reply.snapshot?.generation ?? generation;
      } catch {
        setState('error');
        setMessage(t('studio.unavailable'));
        return;
      }
    }
    onClose();
  };

  if (state === 'ready' || state === 'opening')
    return (
      <NewTerminalDialog
        catalog={dialogCatalog(catalog!)}
        workspaces={[workspace]}
        initialWorkspaceId={workspace.id}
        max={Math.max(0, (snapshot?.limit ?? 8) - (snapshot?.count ?? 0))}
        allowOrchestrator={false}
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
            <p>{state === 'loading' ? t('terminalStudio.create.loading') : message}</p>
          </div>
        </header>
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
