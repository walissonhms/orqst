import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  defaultFeatureId,
  terminalDisplayNameSchema,
  type TerminalBatchItem,
  type TauriStudio,
  type TauriStudioSnapshot,
  type TerminalPreparationCatalog,
  type TerminalPreparationFailure,
} from '@orqst/protocol';
import {
  CompactTerminalForm,
  NewTerminalDialog,
  type TerminalRequest,
} from './NewTerminalDialog.js';
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
  featureName?: string;
  /** Open the previous detailed form (MCP pair, path review). */
  onAdvanced?: () => void;
  /** A possible native start owns presentation when the dialog closes. */
  onClose: (opened?: boolean) => void;
}

/**
 * Uses one reviewed native batch gesture for either a single terminal or multiple terminals.
 */
export function NativeTerminalCreator({
  native,
  workspace,
  featureId,
  featureName,
  onAdvanced,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<{
    catalog: TerminalPreparationCatalog;
    snapshot: TauriStudioSnapshot;
  }>();
  const [state, setState] = useState<'loading' | 'ready' | 'opening' | 'done' | 'error'>('loading');
  const [batch, setBatch] = useState(false);
  const [results, setResults] = useState<(TerminalBatchItem & { name: string })[]>([]);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState<TerminalPreparationFailure>();
  const opening = useRef(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (opening.current) return;
    const current = ++requestId.current;
    setSelection(undefined);
    setFailure(undefined);
    setState('loading');
    try {
      const reply = await native.request({
        action: 'catalog',
        workspaceId: workspace.id,
        featureId,
      });
      if (current !== requestId.current) return;
      if (
        reply.status === 'catalog' &&
        reply.catalog.workspaceId === workspace.id &&
        reply.catalog.featureId === featureId &&
        reply.snapshot
      ) {
        // Catalog and snapshot are one native admission generation.
        setSelection({ catalog: reply.catalog, snapshot: reply.snapshot });
        setState('ready');
        return;
      }
      setMessage(
        t(
          reply.status === 'catalog'
            ? 'studio.create.catalogUnverified'
            : reply.status === 'denied' || reply.status === 'ok'
              ? 'studio.tauri.denied'
              : reply.status === 'batch'
                ? 'studio.unavailable'
                : `studio.${reply.status}`,
        ),
      );
    } catch {
      if (current !== requestId.current) return;
      setMessage(t('studio.unavailable'));
    }
    setState('error');
  }, [native, workspace.id, featureId, t]);

  useEffect(() => {
    void load();
    return () => {
      requestId.current++;
    };
  }, [load]);

  const catalog = selection?.catalog;
  const snapshot = selection?.snapshot;
  const capacity =
    snapshot?.canCreate && !snapshot.busy ? Math.max(0, snapshot.limit - snapshot.count) : 0;

  const open = async (requests: TerminalRequest[]) => {
    if (
      opening.current ||
      state !== 'ready' ||
      !catalog ||
      !snapshot ||
      catalog.workspaceId !== workspace.id ||
      catalog.featureId !== featureId ||
      requests.length === 0 ||
      requests.length > capacity
    )
      return;
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
        entry,
        modelId: request.model === null ? null : catalogModelId(entry, request.model),
        name: request.name || `${t(`terminalStudio.providers.${request.provider}`)} ${n}`,
      };
    });
    if (
      items.some(
        (item) =>
          item.workspaceId !== workspace.id ||
          item.entry?.status !== 'available' ||
          !terminalDisplayNameSchema.safeParse(item.name).success ||
          (item.request.model === null
            ? item.entry.models.filter((model) => model.source === 'cli-default').length !== 1
            : item.modelId === null),
      )
    )
      return;
    opening.current = true;
    setState('opening');
    const unknownItem = (id: string): TerminalBatchItem => ({
      id,
      status: 'unknown',
      reason: 'opening_uncertain',
      effects: 'possible',
    });
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
        const details = reply.status === 'catalog' ? undefined : reply.failure;
        if (
          reply.status === 'catalog' ||
          reply.status === 'ok' ||
          (reply.status === 'unavailable' && !details)
        ) {
          // The client also reports invalid or lost acknowledgments as unavailable.
          setResults(items.map(({ id, name }) => ({ ...unknownItem(id), name })));
          setState('done');
          return;
        }
        setFailure(details);
        setMessage(t(reply.status === 'denied' ? 'studio.tauri.denied' : `studio.${reply.status}`));
        setState('error');
        return;
      }
      const outcomes = items.map(({ id, name }) => ({
        ...(reply.items.find((result) => result.id === id) ?? unknownItem(id)),
        name,
      }));
      setResults(outcomes);
      // The orchestrator label needs the new terminal ID; it grants nothing.
      const lead = outcomes.find(
        (result) =>
          result.status === 'accepted' &&
          result.terminalId &&
          items.find((item) => item.id === result.id)?.request.orchestrator,
      );
      if (lead?.terminalId)
        void labelOrchestrator(featureId ?? defaultFeatureId(workspace.id), lead.terminalId);
      setState('done');
      // Every terminal opened: go back to the live terminal views. Refusals keep the dialog
      // open with their reasons.
      if (outcomes.every((result) => result.status === 'accepted')) onClose(true);
    } catch {
      setResults(items.map(({ id, name }) => ({ ...unknownItem(id), name })));
      setState('done');
    } finally {
      opening.current = false;
    }
  };

  const cancel = () => {
    if (!opening.current) {
      onClose(
        results.some((result) => result.effects === 'possible') || failure?.effects === 'possible',
      );
    }
  };
  const form = (state === 'ready' || state === 'opening') && catalog;
  const choices = catalog
    ? dialogCatalog(catalog, (reason) => t(`terminalStudio.create.reason_${reason}`))
    : [];
  const title = t('terminalStudio.create.title');
  return (
    <Modal label={title} className={batch && form ? 'ntd' : 'ntd ntd-compact'} onClose={cancel}>
      {form ? (
        batch ? (
          <NewTerminalDialog
            inline
            catalog={choices}
            workspaces={[workspace]}
            initialWorkspaceId={workspace.id}
            max={capacity}
            allowOrchestrator={window.orqstFeatures?.contractVersion === 1}
            busy={state === 'opening'}
            onCancel={cancel}
            onSingle={() => setBatch(false)}
            onAdvanced={onAdvanced}
            onConfirm={(requests) => void open(requests)}
          />
        ) : (
          <CompactTerminalForm
            catalog={choices}
            workspace={workspace}
            featureName={
              featureName ?? (featureId === null ? t('features.defaultName') : undefined)
            }
            max={capacity}
            busy={state === 'opening'}
            onCancel={cancel}
            onBatch={() => setBatch(true)}
            onAdvanced={onAdvanced}
            onConfirm={(request) => void open([request])}
          />
        )
      ) : (
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
            {onAdvanced && state === 'error' && failure?.effects !== 'possible' && (
              <button type="button" className="ntd-secondary" onClick={onAdvanced}>
                {t('terminalStudio.create.advanced')}
              </button>
            )}
            {state === 'error' && failure?.effects !== 'possible' && (
              <button type="button" className="ntd-secondary" onClick={() => void load()}>
                {t('studio.refresh')}
              </button>
            )}
            <button type="button" className="ntd-primary" onClick={cancel}>
              {t('terminalStudio.mention.close')}
            </button>
          </footer>
        </div>
      )}
    </Modal>
  );
}
