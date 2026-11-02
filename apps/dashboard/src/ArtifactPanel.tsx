import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  artifactExtractionResultSchema,
  artifactTextLimit,
  type ArtifactExtractionRequest,
  type ArtifactExtractionResult,
} from '@orqst/protocol';
import { api } from './api';
import { artifactBlocks, readableArtifact } from './artifact-preview';

export function ArtifactPanel({
  request,
  onClose,
}: {
  request: ArtifactExtractionRequest;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const [result, setResult] = useState<ArtifactExtractionResult>();
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'source' | 'preview' | 'edit'>('source');
  const [copyState, setCopyState] = useState<'copied' | 'copyFailed'>();
  const [limitError, setLimitError] = useState(false);
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
    setCopyState(undefined);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('copyFailed');
    }
  }
  const artifact = result?.availability === 'available' ? result.value : undefined;
  const reference = artifact?.reference;
  return (
    <section className="artifact-panel" aria-labelledby="artifact-heading">
      <div className="panel-heading">
        <h3 id="artifact-heading" tabIndex={-1} ref={heading}>
          {t('artifacts.title')}
        </h3>
        <button className="button" onClick={onClose}>
          {t('artifacts.close')}
        </button>
      </div>
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
          <div className="artifact-modes" role="group" aria-label={t('artifacts.views')}>
            {(['source', 'preview', 'edit'] as const).map((value) => (
              <button
                className="button"
                key={value}
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
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
                onChange={(event) => {
                  const value = event.target.value;
                  const tooLarge = new TextEncoder().encode(value).byteLength > artifactTextLimit;
                  setLimitError(tooLarge);
                  if (!tooLarge) {
                    setDraft(value);
                    setCopyState(undefined);
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
      <p className="fine-print">{t('artifacts.pending')}</p>
    </section>
  );
}
