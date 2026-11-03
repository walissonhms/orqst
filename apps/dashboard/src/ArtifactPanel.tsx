import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  artifactExtractionResultSchema,
  artifactTextLimit,
  type ArtifactExtractionRequest,
  type ArtifactExtractionResult,
  type ArtifactSaveResult,
} from '@orqst/protocol';
import { api } from './api';
import { artifactBlocks, readableArtifact } from './artifact-preview';
import { LiveMetrics } from './LiveMetrics';
import type { LiveMetricsState } from './use-session-metrics';

export function ArtifactPanel({
  request,
  metrics,
  tokenThreshold,
  onClose,
}: {
  request: ArtifactExtractionRequest;
  metrics: LiveMetricsState;
  tokenThreshold?: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const cancelRestoreButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreId = useId();
  const [result, setResult] = useState<ArtifactExtractionResult>();
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'source' | 'preview' | 'edit'>('source');
  const [copyState, setCopyState] = useState<'copied' | 'copyFailed'>();
  const copyGeneration = useRef(0);
  const [limitError, setLimitError] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<ArtifactSaveResult['status']>();
  const desktop = window.orqstArtifacts?.contractVersion === 1 ? window.orqstArtifacts : undefined;
  const mounted = useRef(true);
  useEffect(() => {
    if (restoring) cancelRestoreButton.current?.focus();
  }, [restoring]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
    const controller = new AbortController();
    void api<unknown>('/api/artifacts/extract', {
      method: 'POST',
      body: JSON.stringify(request),
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        const parsed = artifactExtractionResultSchema.parse(data);
        if (parsed.availability === 'available') {
          const { reference } = parsed.value;
          if (
            reference.evidence.eventId !== request.eventId ||
            reference.evidence.sequence !== request.sequence ||
            reference.evidence.source.hash !== request.sourceHash ||
            reference.identity.sessionRef.nativeSessionId !== request.sessionId ||
            reference.identity.sessionRef.machineId !== request.machineId ||
            reference.identity.sessionRef.adapterId !== request.adapter ||
            reference.identity.workspaceId !== request.workspaceId ||
            reference.identity.observedAgent.id !== request.agentId
          )
            throw new Error('Artifact identity mismatch');
          setDraft(parsed.value.original.text);
        }
        setResult(parsed);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [request]);

  async function copy(text: string) {
    const generation = ++copyGeneration.current;
    setCopyState(undefined);
    try {
      await navigator.clipboard.writeText(text);
      if (mounted.current && generation === copyGeneration.current) setCopyState('copied');
    } catch {
      if (mounted.current && generation === copyGeneration.current) setCopyState('copyFailed');
    }
  }
  async function save(openAfterSave: boolean) {
    if (!desktop || saving) return;
    setSaving(true);
    setSaveState(undefined);
    try {
      const response = await desktop.saveMarkdown(
        mode === 'source'
          ? { contractVersion: 1, selection: request, representation: 'original', openAfterSave }
          : {
              contractVersion: 1,
              selection: request,
              representation: 'draft',
              draft,
              openAfterSave,
            },
      );
      if (mounted.current) setSaveState(response.status);
    } catch {
      if (mounted.current) setSaveState('failed');
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  const artifact = result?.availability === 'available' ? result.value : undefined;
  const reference = artifact?.reference;
  const draftChanged = artifact !== undefined && draft !== artifact.original.text;
  function cancelRestore() {
    setRestoring(false);
    requestAnimationFrame(() => restoreButton.current?.focus());
  }
  return (
    <section className="artifact-panel" aria-labelledby="artifact-heading">
      <div className="panel-heading">
        <h3 id="artifact-heading" tabIndex={-1} ref={heading}>
          {t('artifacts.title')}
        </h3>
        <button className="button" disabled={saving} onClick={onClose}>
          {t('artifacts.close')}
        </button>
      </div>
      <LiveMetrics state={metrics} threshold={tokenThreshold} />
      <p className="fine-print">{t('artifacts.manualNote')}</p>
      {failed && <p role="alert">{t('artifacts.loadFailed')}</p>}
      {!failed && !result && <p role="status">{t('artifacts.loading')}</p>}
      {result?.availability === 'unavailable' && (
        <p role="status">{t(`artifacts.unavailable.${result.reason}`)}</p>
      )}
      {artifact && reference && (
        <>
          <dl className="artifact-provenance">
            <dt>{t('artifacts.project')}</dt>
            <dd>{reference.identity.workspaceId}</dd>
            <dt>{t('artifacts.session')}</dt>
            <dd>{reference.identity.sessionRef.nativeSessionId}</dd>
            <dt>{t('artifacts.agent')}</dt>
            <dd>{reference.identity.observedAgent.id}</dd>
            <dt>{t('artifacts.machine')}</dt>
            <dd>{reference.identity.sessionRef.machineId}</dd>
            <dt>{t('artifacts.provider')}</dt>
            <dd>
              {reference.identity.sessionRef.adapterId} / {reference.role}
            </dd>
            <dt>{t('artifacts.date')}</dt>
            <dd>
              <time>{reference.evidence.occurredAt}</time>
            </dd>
            <dt>{t('artifacts.event')}</dt>
            <dd>
              {reference.evidence.eventId} / {reference.evidence.sequence}
            </dd>
            <dt>{t('artifacts.version')}</dt>
            <dd>
              {artifact.contractVersion} / {artifact.eventSchemaVersion}
            </dd>
            <dt>{t('source')}</dt>
            <dd>
              {reference.evidence.source.file}:{reference.evidence.source.line} /{' '}
              {reference.evidence.source.offset} / {reference.evidence.source.recordType}
              <br />
              {reference.evidence.source.hash}
            </dd>
          </dl>
          <p className="fine-print">{t('artifacts.provenanceNote')}</p>
          <p className="notice">{t('artifacts.retainedNote')}</p>
          <p className="fine-print">
            {t(draftChanged ? 'artifacts.draftChanged' : 'artifacts.draftUnchanged')}
          </p>
          <div className="artifact-modes" role="group" aria-label={t('artifacts.views')}>
            {(['source', 'preview', 'edit'] as const).map((value) => (
              <button
                className="button"
                ref={value === 'edit' ? editButton : undefined}
                disabled={saving || restoring}
                key={value}
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  copyGeneration.current++;
                  setCopyState(undefined);
                }}
              >
                {t(`artifacts.${value}`)}
              </button>
            ))}
          </div>
          {mode === 'source' && <pre className="artifact-content">{artifact.original.text}</pre>}
          {mode === 'preview' && (
            <div className="artifact-content" aria-label={t('artifacts.preview')}>
              {artifactBlocks(draft).map((block, index) =>
                block.kind === 'heading' ? (
                  <h4 key={index}>{block.text}</h4>
                ) : block.kind === 'code' ? (
                  <pre key={index}>
                    <code>{block.text}</code>
                  </pre>
                ) : block.kind === 'list' ? (
                  <ul key={index}>
                    {block.items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p key={index}>{block.text}</p>
                ),
              )}
            </div>
          )}
          {mode === 'edit' && (
            <div className="artifact-editor">
              <label htmlFor="artifact-draft">{t('artifacts.draft')}</label>
              <textarea
                id="artifact-draft"
                value={draft}
                disabled={saving || restoring}
                onChange={(event) => {
                  const value = event.target.value;
                  const tooLarge = new TextEncoder().encode(value).byteLength > artifactTextLimit;
                  setLimitError(tooLarge);
                  if (!tooLarge) {
                    setDraft(value);
                    copyGeneration.current++;
                    setCopyState(undefined);
                    setSaveState(undefined);
                  }
                }}
              />
            </div>
          )}
          {limitError && <p role="alert">{t('artifacts.limit')}</p>}
          <p className="fine-print">{t('artifacts.draftNote')}</p>
          <div className="artifact-actions">
            <button
              className="button"
              ref={restoreButton}
              disabled={!draftChanged || saving || restoring}
              onClick={() => setRestoring(true)}
            >
              {t('artifacts.restoreDraft')}
            </button>
          </div>
          {restoring && (
            <div
              role="group"
              aria-labelledby={restoreId}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelRestore();
                }
              }}
            >
              <p className="notice" id={restoreId}>
                {t('artifacts.restoreWarning')}
              </p>
              <div className="artifact-actions">
                <button className="button" ref={cancelRestoreButton} onClick={cancelRestore}>
                  {t('cancel')}
                </button>
                <button
                  className="button"
                  onClick={() => {
                    setDraft(artifact.original.text);
                    setLimitError(false);
                    copyGeneration.current++;
                    setCopyState(undefined);
                    setSaveState(undefined);
                    setRestoring(false);
                    requestAnimationFrame(() => editButton.current?.focus());
                  }}
                >
                  {t('artifacts.confirmRestore')}
                </button>
              </div>
            </div>
          )}
          {desktop ? (
            <div className="artifact-actions">
              <button
                className="button"
                disabled={saving || restoring}
                onClick={() => void save(false)}
              >
                {t(mode === 'source' ? 'artifacts.saveOriginal' : 'artifacts.saveDraft')}
              </button>
              <button
                className="button"
                disabled={saving || restoring}
                onClick={() => void save(true)}
              >
                {t(mode === 'source' ? 'artifacts.saveOpenOriginal' : 'artifacts.saveOpenDraft')}
              </button>
            </div>
          ) : (
            <p className="fine-print">{t('artifacts.desktopOnly')}</p>
          )}
          {saving && <p role="status">{t('artifacts.saving')}</p>}
          {saveState && (
            <p
              role={
                ['failed', 'write_failed', 'saved_open_failed'].includes(saveState)
                  ? 'alert'
                  : 'status'
              }
            >
              {t(`artifacts.saveResult.${saveState}`)}
            </p>
          )}
          <div className="artifact-actions">
            <button
              className="button"
              onClick={() => {
                void copy(artifact.original.text);
              }}
            >
              {t('artifacts.copyOriginal')}
            </button>
            <button
              className="button"
              onClick={() => {
                void copy(draft);
              }}
            >
              {t('artifacts.copyMarkdown')}
            </button>
            <button
              className="button"
              onClick={() => {
                void copy(readableArtifact(draft));
              }}
            >
              {t('artifacts.copyReadable')}
            </button>
          </div>
          {copyState && (
            <p role={copyState === 'copyFailed' ? 'alert' : 'status'}>
              {t(`artifacts.${copyState}`)}
            </p>
          )}
        </>
      )}
      <p className="fine-print">{t('artifacts.fileNote')}</p>
    </section>
  );
}
