import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  structuredAgentsLimits as limits,
  type DesktopStructuredAgents,
  type StructuredAgentsReply,
  type StructuredAgentsRequest,
  type StructuredAgentsScope,
  type StructuredAgentsSnapshot,
  type StructuredProvider,
  structuredProviderSchema,
} from '@orqst/protocol';
import { Modal } from './Modal.js';

interface Props {
  client: DesktopStructuredAgents;
  scope: StructuredAgentsScope;
  featureName: string;
  onClose(): void;
}

export function StructuredAgents({ client, scope, featureName, onClose }: Props) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<StructuredAgentsSnapshot>();
  const [sessionId, setSessionId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [label, setLabel] = useState('');
  const [provider, setProvider] = useState<StructuredProvider>('codex');
  const [text, setText] = useState('');
  const [task, setTask] = useState('');
  const [notice, setNotice] = useState<StructuredAgentsReply['status']>();
  const [readStatus, setReadStatus] = useState<StructuredAgentsReply['status']>();
  const [busy, setBusy] = useState(false);
  const { workspaceId, featureId } = scope;

  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const reply = await client
        .request({ workspaceId, featureId }, { action: 'snapshot' })
        .catch(() => ({ status: 'unavailable' as const }));
      if (!current) return;
      setReadStatus(reply.status);
      if (reply.status === 'ok' && reply.snapshot) {
        setSnapshot(reply.snapshot);
        setSessionId((selected) =>
          reply.snapshot!.sessions.some(({ sessionId }) => sessionId === selected)
            ? selected
            : (reply.snapshot!.sessions.at(-1)?.sessionId ?? ''),
        );
      } else setSnapshot(undefined);
      timer = setTimeout(() => void refresh(), 850);
    }
    void refresh();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, featureId, workspaceId]);

  async function submit(request: StructuredAgentsRequest) {
    if (busy) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const response = await client.request(scope, request);
      setNotice(response.status);
      if (response.status === 'ok' && request.action === 'start') setLabel('');
      if (response.status === 'ok' && request.action === 'turn') setText('');
      if (response.status === 'ok' && request.action === 'grant') {
        setText(
          t(
            session?.provider === 'opencode'
              ? 'structuredAgents.openCodeDelegatePrompt'
              : 'structuredAgents.delegatePrompt',
            {
              target: request.targetSessionId,
              task: request.task,
              interpolation: { escapeValue: false },
            },
          ),
        );
        setTask('');
      }
    } catch {
      setNotice('unavailable');
    } finally {
      setBusy(false);
    }
  }

  const session = snapshot?.sessions.find((entry) => entry.sessionId === sessionId);
  const workers =
    snapshot?.sessions.filter(
      (entry) => entry.sessionId !== sessionId && entry.lifecycle === 'ready' && !entry.busy,
    ) ?? [];
  const workerReady = workers.some((entry) => entry.sessionId === workerId);
  const ready = session?.lifecycle === 'ready';
  const waiting = session?.approvals.some(({ state }) => state === 'pending');

  return (
    <Modal label={t('structuredAgents.title')} className="structured-agents" onClose={onClose}>
      <header>
        <h2>
          {t('structuredAgents.title')} · {featureName}
        </h2>
        <button type="button" onClick={onClose}>
          {t('structuredAgents.close')}
        </button>
      </header>
      <p role="status">
        {notice && notice !== 'ok'
          ? t(`structuredAgents.reply_${notice}`)
          : !readStatus
            ? t('features.loading')
            : readStatus !== 'ok'
              ? t(`structuredAgents.reply_${readStatus}`)
              : busy
                ? t('structuredAgents.reviewPending')
                : ''}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit({ action: 'start', label: label.trim(), provider });
        }}
      >
        <label>
          {t('structuredAgents.provider')}
          <select
            value={provider}
            onChange={(event) => setProvider(structuredProviderSchema.parse(event.target.value))}
          >
            {structuredProviderSchema.options.map((entry) => (
              <option value={entry} key={entry}>
                {t(`structuredAgents.provider_${entry}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('structuredAgents.sessionName')}
          <input
            value={label}
            maxLength={limits.label}
            onChange={(event) => setLabel(event.target.value)}
            required
          />
        </label>
        <button disabled={busy || !snapshot || !label.trim()}>{t('structuredAgents.start')}</button>
      </form>
      {session && (
        <>
          <section className="structured-agents-actions">
            <label>
              {t('structuredAgents.session')}
              <select
                value={sessionId}
                onChange={(event) => {
                  setSessionId(event.target.value);
                  setWorkerId('');
                  setText('');
                  setTask('');
                }}
              >
                {snapshot?.sessions.map((entry) => (
                  <option key={entry.sessionId} value={entry.sessionId}>
                    {entry.label} · {t(`structuredAgents.provider_${entry.provider}`)}
                  </option>
                ))}
              </select>
            </label>
            <span>
              {t(
                `structuredAgents.state_${!ready ? session.lifecycle : waiting ? 'waiting' : (session.turn?.state ?? session.lifecycle)}`,
              )}
              {session.reportedModel ? ` · ${session.reportedModel}` : ''}
            </span>
            <button
              type="button"
              disabled={busy || !ready || !session.busy || !session.turn}
              onClick={() => void submit({ action: 'interrupt', sessionId })}
            >
              {t('structuredAgents.interrupt')}
            </button>
            <button
              type="button"
              disabled={busy || !ready}
              onClick={() => void submit({ action: 'stop', sessionId })}
            >
              {t('structuredAgents.stop')}
            </button>
          </section>
          {session.approvals
            .filter(({ state }) => state === 'pending')
            .map((approval) => (
              <section key={approval.approvalId} className="structured-agents-approval">
                <h3>{t(`structuredAgents.approval_${approval.kind}`)}</h3>
                <pre>{approval.detail}</pre>
                {approval.decisions.map((decision) => (
                  <button
                    key={decision}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void submit({
                        action: 'approval',
                        sessionId,
                        approvalId: approval.approvalId,
                        decision,
                      })
                    }
                  >
                    {t(`structuredAgents.decision_${decision}`)}
                  </button>
                ))}
              </section>
            ))}
          <ol className="structured-agents-history" aria-label={t('structuredAgents.history')}>
            {session.items.map((item) => (
              <li key={JSON.stringify([item.turnId, item.id])}>
                <strong>
                  {t(`structuredAgents.item_${item.kind}`)}
                  {item.status ? ` · ${t(`structuredAgents.state_${item.status}`)}` : ''}
                </strong>
                <pre>{item.text}</pre>
              </li>
            ))}
          </ol>
          {session.droppedItems > 0 && <p>{t('structuredAgents.historyLimit')}</p>}
          {snapshot?.delegations
            .filter(
              (entry) => entry.sourceSessionId === sessionId || entry.targetSessionId === sessionId,
            )
            .map((entry) => (
              <p key={entry.delegationId}>
                {t('structuredAgents.delegationState', {
                  source: snapshot.sessions.find(
                    (candidate) => candidate.sessionId === entry.sourceSessionId,
                  )?.label,
                  target: snapshot.sessions.find(
                    (candidate) => candidate.sessionId === entry.targetSessionId,
                  )?.label,
                  state: t(`structuredAgents.state_${entry.state}`),
                })}
              </p>
            ))}
          {ready && (
            <>
              {workers.length > 0 && (
                <details>
                  <summary>{t('structuredAgents.delegate')}</summary>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submit({
                        action: 'grant',
                        sourceSessionId: sessionId,
                        targetSessionId: workerId,
                        task: task.trim(),
                      });
                    }}
                  >
                    <label>
                      {t('structuredAgents.worker')}
                      <select
                        value={workerId}
                        onChange={(event) => setWorkerId(event.target.value)}
                      >
                        <option value="">{t('features.choose')}</option>
                        {workers.map((entry) => (
                          <option key={entry.sessionId} value={entry.sessionId}>
                            {entry.label} · {t(`structuredAgents.provider_${entry.provider}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t('structuredAgents.task')}
                      <textarea
                        value={task}
                        maxLength={limits.delegationTask}
                        onChange={(event) => setTask(event.target.value)}
                        required
                      />
                    </label>
                    <button disabled={busy || session.busy || !workerReady || !task.trim()}>
                      {t('structuredAgents.grant')}
                    </button>
                  </form>
                </details>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit({ action: 'turn', sessionId, text: text.trim() });
                }}
              >
                <label>
                  {t('structuredAgents.message')}
                  <textarea
                    value={text}
                    maxLength={limits.turnText}
                    onChange={(event) => setText(event.target.value)}
                    required
                  />
                </label>
                <button disabled={busy || session.busy || !text.trim()}>
                  {t('structuredAgents.send')}
                </button>
              </form>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
