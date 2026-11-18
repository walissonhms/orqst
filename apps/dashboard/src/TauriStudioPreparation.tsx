import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Terminal } from 'lucide-react';
import type {
  TauriStudio,
  TauriStudioRequest,
  TauriStudioSnapshot,
  TerminalPreparationCatalog,
  TerminalPreparationFailure,
} from '@orqst/protocol';
import { terminalCatalogReason } from './native-terminal-catalog.js';

type Scope = { workspaceId: string; featureId: string | null };
type Provider = TerminalPreparationCatalog['providers'][number]['provider'];

/** Core catalog + native review. The renderer never supplies executable or project paths. */
const pairModelKey = {
  codex: 'codexModelId',
  opencode: 'openCodeModelId',
  claude: 'claudeModelId',
} as const;
type McpPairProvider = keyof typeof pairModelKey;

export function TauriStudioPreparation({
  native,
  context,
  onReviewPending,
}: {
  native?: TauriStudio;
  context?: Scope;
  onReviewPending?: (pending: boolean) => void;
}) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<TauriStudioSnapshot>();
  const [catalog, setCatalog] = useState<TerminalPreparationCatalog>();
  const [catalogGeneration, setCatalogGeneration] = useState<number>();
  const [provider, setProvider] = useState<Provider>('codex');
  const [modelId, setModelId] = useState('');
  const [mcpPair, setMcpPair] = useState(false);
  const [companionModelId, setCompanionModelId] = useState('');
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState<TerminalPreparationFailure>();
  const sequence = useRef(0);
  const active = useRef(false);
  const inFlight = useRef<{ token: number; reviewing: boolean } | undefined>(undefined);
  const reviewPending = useRef(onReviewPending);
  reviewPending.current = onReviewPending;
  const chosen = catalog?.providers.find((entry) => entry.provider === provider);
  const model = chosen?.models.find((entry) => entry.id === modelId);
  // The pair worker is any other reviewed MCP-capable CLI; Codex/OpenCode keep their original pairing.
  const [workerChoice, setWorkerChoice] = useState<McpPairProvider | ''>('');
  const workerOptions = (['codex', 'opencode', 'claude'] as const).filter(
    (entry) => entry !== provider,
  );
  const companionProvider: McpPairProvider =
    workerChoice && workerChoice !== provider
      ? workerChoice
      : provider === 'codex'
        ? 'opencode'
        : 'codex';
  const companion = catalog?.providers.find((entry) => entry.provider === companionProvider);
  const companionModel = companion?.models.find((entry) => entry.id === companionModelId);
  const workspaceId = context?.workspaceId ?? '';
  const featureId = context?.featureId ?? null;
  const request = useCallback(
    async (input: TauriStudioRequest) => {
      if (!native || inFlight.current) return;
      const token = ++sequence.current;
      const reviewing = input.action !== 'snapshot' && input.action !== 'catalog';
      inFlight.current = { token, reviewing };
      setBusy(true);
      setNotice('');
      if (reviewing) {
        reviewPending.current?.(true);
        setFailure(undefined);
        setCatalogGeneration(undefined);
      }
      if (input.action === 'catalog') {
        setCatalog(undefined);
        setCatalogGeneration(undefined);
      }
      try {
        const reply = await native.request(input);
        if (!active.current || sequence.current !== token) return;
        if (reply.status === 'catalog') {
          if (reply.catalog.workspaceId !== workspaceId || reply.catalog.featureId !== featureId) {
            setNotice('denied');
            setCatalog(undefined);
            return;
          }
          if (reply.snapshot) {
            setSnapshot(reply.snapshot);
            setCatalogGeneration(reply.snapshot.generation);
          } else {
            setNotice('catalog_unverified');
          }
          setCatalog(reply.catalog);
          setModelId(''); // A refreshed catalog always needs a current explicit choice.
          setMcpPair(false);
          setCompanionModelId('');
        } else {
          if (reply.failure) setFailure(reply.failure);
          // Opening may move focus/generation. Inspect once; never repeat a mutation.
          const current =
            input.action !== 'snapshot' && !reply.snapshot
              ? await native.request({ action: 'snapshot' })
              : reply;
          if (!active.current || sequence.current !== token) return;
          if (current.status !== 'catalog') setSnapshot(current.snapshot);
          setNotice(reply.status === 'ok' ? '' : reply.status);
        }
      } catch {
        if (active.current && sequence.current === token) setNotice('unavailable');
      } finally {
        if (reviewing) reviewPending.current?.(false);
        if (inFlight.current?.token === token) inFlight.current = undefined;
        if (active.current && sequence.current === token) setBusy(false);
      }
    },
    [native, workspaceId, featureId],
  );
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const token = sequence.current + 1;
    await request({ action: 'snapshot' });
    if (active.current && sequence.current === token && workspaceId)
      await request({ action: 'catalog', workspaceId, featureId });
  }, [request, workspaceId, featureId]);
  useEffect(() => {
    active.current = true;
    setFailure(undefined);
    setCatalog(undefined);
    setCatalogGeneration(undefined);
    setModelId('');
    setMcpPair(false);
    setCompanionModelId('');
    void refresh();
    const inspect = () => void refresh();
    window.addEventListener('focus', inspect);
    return () => {
      window.removeEventListener('focus', inspect);
      active.current = false;
      // StrictMode and scope changes must be able to restart passive reads.
      if (!inFlight.current?.reviewing) inFlight.current = undefined;
      sequence.current++;
    };
  }, [refresh]);
  const disabled = busy || !snapshot || snapshot.busy;
  const stage = !snapshot
    ? 'unavailable'
    : snapshot.selectionLocked
      ? 'locked'
      : snapshot.canReview
        ? 'prepared'
        : snapshot.canCreate
          ? 'empty'
          : 'blocked';
  const scopeMatches =
    catalog?.workspaceId === workspaceId &&
    catalog.featureId === featureId &&
    catalogGeneration !== undefined &&
    catalogGeneration === snapshot?.generation;
  return (
    <>
      <span id="studio-setup-title" className="sr-only">
        {t('studio.tauri.openTitle')}
      </span>
      {stage !== 'empty' && <p className="studio-state">{t(`studio.tauri.state_${stage}`)}</p>}
      {failure && (
        <div className="notice" role="alert">
          <p>{t(`tauriPreparation.code_${failure.code}`)}.</p>
          <p>{t(`tauriPreparation.failure_${failure.effects}`)}</p>
          <details>
            <summary>{t('tauriPreparation.failureDetails')}</summary>
            {t('tauriPreparation.failureStage')}: {t(`tauriPreparation.stage_${failure.stage}`)}.
          </details>
        </div>
      )}
      {!!catalog?.pendingOwnedExits?.length && (
        <p className="notice" role="status">
          {t('tauriPreparation.code_owned_exit_pending')}
        </p>
      )}
      {!workspaceId && (
        <p className="notice" role="status">
          {t('studio.tauri.chooseWorkspace')}
        </p>
      )}
      {notice && !failure && (
        <p className="notice" role="status">
          {t(
            notice === 'catalog_unverified'
              ? 'studio.create.catalogUnverified'
              : notice === 'denied'
                ? 'studio.tauri.denied'
                : `studio.${notice}`,
          )}
        </p>
      )}
      <div className="studio-members studio-terminal-choice">
        <label>
          {t('studio.tauri.provider')}
          <select
            aria-label={t('studio.tauri.provider')}
            disabled={disabled || !snapshot?.canCreate}
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value as Provider);
              setModelId('');
              setMcpPair(false);
              setCompanionModelId('');
            }}
          >
            {(['codex', 'claude', 'opencode', 'antigravity'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`shell.adapters.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('studio.tauri.model')}
          <select
            aria-label={t('studio.tauri.model')}
            disabled={disabled || !snapshot?.canCreate || chosen?.status !== 'available'}
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
          >
            <option value="">{t('studio.tauri.chooseModel')}</option>
            {chosen?.models.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.source === 'cli-default'
                  ? t('studio.tauri.cliDefault')
                  : entry.isDefault
                    ? t('studio.tauri.defaultModel', { model: entry.label })
                    : entry.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {chosen && chosen.reason !== 'ready' && (
        <p className="studio-next" role="status">
          {t(`studio.tauri.catalog_${terminalCatalogReason(chosen)}`)}
        </p>
      )}
      {model && <p className="studio-next">{t('studio.tauri.modelUnverified')}</p>}
      {
        <div className="studio-members">
          <label>
            <input
              type="checkbox"
              checked={mcpPair}
              disabled={
                disabled ||
                !snapshot?.canCreate ||
                snapshot.liveEnrollment ||
                provider === 'antigravity'
              }
              onChange={(event) => {
                setMcpPair(event.target.checked);
                setCompanionModelId('');
              }}
            />
            {t('studio.tauri.mcpPairOptIn')}
          </label>
          {provider === 'antigravity' && (
            <p className="studio-next" role="status">
              {t('studio.tauri.mcpUnavailableAntigravity')}
            </p>
          )}
          {mcpPair && provider !== 'antigravity' && (
            <>
              <p className="studio-next">
                {t('studio.tauri.mcpPairHelp', {
                  source: t(`shell.adapters.${provider}`),
                  worker: t(`shell.adapters.${companionProvider}`),
                })}
              </p>
              <label>
                {t('studio.tauri.mcpWorkerProvider')}
                <select
                  aria-label={t('studio.tauri.mcpWorkerProvider')}
                  disabled={disabled || !snapshot?.canCreate}
                  value={companionProvider}
                  onChange={(event) => {
                    setWorkerChoice(event.target.value as McpPairProvider);
                    setCompanionModelId('');
                  }}
                >
                  {workerOptions.map((entry) => (
                    <option key={entry} value={entry}>
                      {t(`shell.adapters.${entry}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('studio.tauri.mcpWorkerModel', {
                  provider: t(`shell.adapters.${companionProvider}`),
                })}
                <select
                  aria-label={t('studio.tauri.mcpWorkerModel', {
                    provider: t(`shell.adapters.${companionProvider}`),
                  })}
                  disabled={disabled || !snapshot?.canCreate || companion?.status !== 'available'}
                  value={companionModelId}
                  onChange={(event) => setCompanionModelId(event.target.value)}
                >
                  <option value="">{t('studio.tauri.chooseModel')}</option>
                  {companion?.models.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.source === 'cli-default'
                        ? t('studio.tauri.cliDefault')
                        : entry.isDefault
                          ? t('studio.tauri.defaultModel', { model: entry.label })
                          : entry.label}
                    </option>
                  ))}
                </select>
              </label>
              {companion && companion.reason !== 'ready' && (
                <p className="studio-next" role="status">
                  {t(`studio.tauri.catalog_${terminalCatalogReason(companion)}`)}
                </p>
              )}
            </>
          )}
          {snapshot?.liveEnrollment && (
            <p className="studio-next">{t('studio.tauri.mcpInitialOnly')}</p>
          )}
        </div>
      }
      <div className="studio-actions">
        <button
          className="button primary"
          disabled={
            disabled ||
            !snapshot?.canCreate ||
            !scopeMatches ||
            chosen?.status !== 'available' ||
            !model ||
            (mcpPair &&
              (snapshot.liveEnrollment || companion?.status !== 'available' || !companionModel))
          }
          onClick={() =>
            snapshot &&
            scopeMatches &&
            catalog &&
            model &&
            void request(
              mcpPair && provider !== 'antigravity' && companionModel
                ? {
                    action: 'create-mcp-pair',
                    generation: catalogGeneration,
                    workspaceId,
                    featureId: catalog.restoredFeature?.featureId ?? featureId,
                    catalogId: catalog.catalogId,
                    sourceProvider: provider,
                    workerProvider: companionProvider,
                    [pairModelKey[provider]]: model.id,
                    [pairModelKey[companionProvider]]: companionModel.id,
                  }
                : {
                    action: 'create-selected',
                    generation: catalogGeneration,
                    workspaceId,
                    featureId: catalog.restoredFeature?.featureId ?? featureId,
                    catalogId: catalog.catalogId,
                    provider,
                    modelId: model.id,
                    count: 1,
                  },
            )
          }
        >
          <Terminal size={16} />
          {t(mcpPair ? 'studio.tauri.openMcpPair' : 'studio.tauri.open')}
        </button>
        <button className="button" disabled={!native || busy} onClick={() => void refresh()}>
          {t('studio.refresh')}
        </button>
      </div>
      <details className="studio-advanced">
        <summary>{t('studio.tauri.advanced')}</summary>
        <p>{t('studio.tauri.openHelp')}</p>
        <p>{t('studio.tauri.enrollmentLimit')}</p>
        <p>{t('studio.tauri.reviewFile')}</p>
        {model && <p>{t(`studio.tauri.source_${model.source}`)}</p>}
        <p>
          {t(
            snapshot?.liveEnrollment
              ? 'studio.tauri.advancedInitialOnly'
              : 'studio.tauri.advancedHelp',
          )}
        </p>
        <label>
          {t('studio.tauri.count')}
          <select
            aria-label={t('studio.tauri.count')}
            disabled={disabled || !snapshot?.canCreate || snapshot.liveEnrollment}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          >
            {Array.from({ length: 8 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <div className="studio-actions">
          <button
            className="button"
            disabled={
              disabled ||
              !snapshot?.canCreate ||
              snapshot.liveEnrollment ||
              provider === 'opencode' ||
              provider === 'antigravity'
            }
            onClick={() =>
              snapshot &&
              (provider === 'codex' || provider === 'claude') &&
              void request({ action: 'create', generation: snapshot.generation, provider, count })
            }
          >
            <FolderOpen size={16} />
            {t('studio.tauri.choosePaths')}
          </button>
          <button
            className="button"
            disabled={disabled || !snapshot?.canReview}
            onClick={() =>
              snapshot && void request({ action: 'review', generation: snapshot.generation })
            }
          >
            {t('studio.continueReview')}
          </button>
        </div>
      </details>
      {(busy || stage !== 'empty') && (
        <p className="studio-next" role="status" aria-busy={busy || snapshot?.busy}>
          {busy
            ? t('studio.reviewing')
            : t(`studio.tauri.next_${stage}`, { count: snapshot?.count ?? 0 })}
        </p>
      )}
    </>
  );
}
