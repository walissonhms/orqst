import { RouteHeaderActions } from './AppShell';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ArrowUpRight, Copy, RotateCw } from 'lucide-react';
import {
  featureDisplayName,
  type FeatureNativeSnapshot,
  type InspectorCommand,
  type InspectorReply,
  type InspectorRow,
} from '@orqst/protocol';
import { DelegateDialog, providerLabels } from './DelegateDialog';
import { FeaturePermissions } from './FeaturePermissions';
import { MentionComposer } from './MentionComposer';
import type { StudioTerminal } from './FeatureStudioStage';
import './mention-composer.css';

const tabs = ['messages', 'queue', 'delegations', 'audit', 'permissions'] as const;
type Tab = (typeof tabs)[number];
const states = [
  'queued',
  'delivered',
  'dequeued',
  'done',
  'failed',
  'target_ended',
  'blocked',
  'unknown',
];
type Projection = Extract<InspectorReply, { status: 'ok' }>;

export function CommunicationInspector({
  snapshot,
  onOpenStudio,
}: {
  snapshot?: FeatureNativeSnapshot;
  onOpenStudio: (target: { featureId: string; terminalId: string }) => Promise<boolean>;
}) {
  const { t, i18n } = useTranslation();
  const key = useId();
  const [tab, setTab] = useState<Tab>('messages');
  const [selected, setSelected] = useState<string>();
  const [terminal, setTerminal] = useState('');
  const [state, setState] = useState('');
  const [period, setPeriod] = useState('');
  const [projection, setProjection] = useState<Projection>();
  const [readFailed, setReadFailed] = useState(false);
  const [delegate, setDelegate] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [acting, setActing] = useState(false);
  const [checkedAt, setCheckedAt] = useState(Date.now);
  const action = useRef(false);
  const native = window.orqstFeatures;
  const features = snapshot?.features.filter(({ status }) => status !== 'archived') ?? [];
  const feature = features.find(
    ({ featureId }) => featureId === (selected ?? snapshot?.activeFeatureId),
  );
  const featureId = feature?.featureId;
  const generation = snapshot?.generation;
  const active = featureId !== undefined && featureId === snapshot?.activeFeatureId;
  const current = projection?.featureId === featureId ? projection : undefined;
  const language = i18n.resolvedLanguage;
  const time = new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' });
  const date = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
  const slots = snapshot?.slots ?? [];
  const label = (slot: number) => 'T-' + String(slot + 1).padStart(3, '0');
  const terminalName = (id: string) => {
    if (id === 'owner') return t('communication.owner');
    const slot = slots.find(({ terminalId }) => terminalId === id);
    return slot ? label(slot.slot) + ' ' + providerLabels[slot.provider] : id;
  };
  const members: StudioTerminal[] = snapshot
    ? slots
        .filter(
          (slot) =>
            !slot.closed &&
            feature?.terminalIds.includes(slot.terminalId) &&
            (current?.recipients.includes(slot.terminalId) || slot.provider === 'antigravity'),
        )
        .map((slot) => ({
          id: slot.terminalId,
          label: label(slot.slot),
          name: slot.displayName ?? providerLabels[slot.provider],
          provider: slot.provider,
          model: slot.selectedModel,
          status: 'unknown',
          workspace: snapshot.workspace,
        }))
    : [];
  const eligible = members.filter(({ provider }) => provider !== 'antigravity');
  const available = active && eligible.length > 0 && !readFailed;
  const mayDelegateFrom = [
    feature?.orchestratorTerminalId,
    slots.find(({ focused }) => focused)?.terminalId,
  ];
  const defaultSender = mayDelegateFrom.find((id) => id && current?.senders.includes(id)) ?? null;

  useEffect(() => {
    if (!native || !featureId || generation === undefined) return;
    let mounted = true;
    let pending = false;
    const refresh = async () => {
      if (action.current || pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const reply = await native.request({
          contractVersion: 1,
          generation,
          action: 'inspector',
          command: { kind: 'read', featureId },
        });
        if (!mounted || reply.status === 'busy') return;
        const result = reply.inspector;
        if (reply.status === 'ok' && result?.status === 'ok' && result.featureId === featureId) {
          setProjection(result);
          setCheckedAt(Date.now());
          setReadFailed(false);
        } else setReadFailed(true);
      } catch {
        if (mounted) setReadFailed(true);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const poll = window.setInterval(() => void refresh(), 2500);
    return () => {
      mounted = false;
      window.clearInterval(poll);
    };
  }, [native, featureId, generation]);

  async function operate(command: InspectorCommand, target: string): Promise<string | undefined> {
    if (action.current || !native || !snapshot || !active)
      return t('communication.refused.unavailable');
    action.current = true;
    setActing(true);
    try {
      const reply = await native.request({
        contractVersion: 1,
        generation: snapshot.generation,
        action: 'inspector',
        command,
      });
      if (reply.inspector?.status === 'refused')
        return t('communication.refused.' + reply.inspector.code, { target });
      if (reply.status !== 'ok' || reply.inspector?.status !== 'queued')
        return t('communication.refused.unavailable');
      setNotice(t('communication.states.queued'));
    } catch {
      return t('communication.refused.unavailable');
    } finally {
      action.current = false;
      setActing(false);
    }
  }

  async function openDestination(row: InspectorRow) {
    if (
      !slots.some((slot) => slot.terminalId === row.to && !slot.closed) ||
      !featureId ||
      action.current
    )
      return;
    action.current = true;
    setActing(true);
    try {
      if (!(await onOpenStudio({ featureId, terminalId: row.to })))
        setNotice(t('communication.refused.unavailable'));
    } catch {
      setNotice(t('communication.refused.unavailable'));
    } finally {
      action.current = false;
      setActing(false);
    }
  }

  const rows = (current?.rows ?? []).filter(
    (row) =>
      (tab !== 'queue' || row.delivery === 'queued') &&
      (tab !== 'delegations' || row.kind !== 'message') &&
      (!terminal || row.from === terminal || row.to === terminal) &&
      (!state || row.delivery === state || row.task === state) &&
      (!period || row.at >= checkedAt - Number(period)),
  );

  return (
    <section className="communication-inspector" aria-labelledby={key + '-title'}>
      <header className="communication-head">
        <h1 id={key + '-title'}>{t('shell.views.comunicacao')}</h1>
        <RouteHeaderActions>
          <button
            className="button primary"
            type="button"
            aria-haspopup="dialog"
            disabled={!available || acting}
            onClick={() => {
              setNotice('');
              setDelegate(true);
            }}
          >
            <ArrowUpRight size={14} aria-hidden="true" /> {t('mention.delegate')}
          </button>
        </RouteHeaderActions>
      </header>
      <div className="communication-tabs" role="tablist" aria-label={t('shell.views.comunicacao')}>
        {tabs.map((entry, index) => (
          <button
            key={entry}
            id={key + '-' + entry}
            role="tab"
            aria-selected={tab === entry}
            aria-controls={key + '-panel'}
            tabIndex={tab === entry ? 0 : -1}
            type="button"
            onClick={() => setTab(entry)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              const id = tabs[next]!;
              setTab(id);
              document.getElementById(key + '-' + id)?.focus();
            }}
          >
            {t('communication.tabs.' + entry)}
          </button>
        ))}
      </div>
      <div
        className="communication-panel"
        id={key + '-panel'}
        role="tabpanel"
        aria-labelledby={key + '-' + tab}
        tabIndex={0}
      >
        <div className="communication-filters">
          <label>
            Feature
            <select
              value={featureId ?? ''}
              onChange={(event) => {
                setSelected(event.target.value);
                setTerminal('');
                setFrom(null);
                setNotice('');
                setReadFailed(false);
              }}
            >
              {!featureId && <option value="">{t('communication.selectFeature')}</option>}
              {features.map((entry) => (
                <option key={entry.featureId} value={entry.featureId}>
                  {featureDisplayName(entry, t('features.defaultName'))}
                </option>
              ))}
            </select>
          </label>
          {tab !== 'permissions' && (
            <>
              <label>
                {t('communication.terminal')}
                <select value={terminal} onChange={(event) => setTerminal(event.target.value)}>
                  <option value="">{t('communication.all')}</option>
                  {slots
                    .filter(
                      (slot) =>
                        feature?.terminalIds.includes(slot.terminalId) ||
                        current?.rows.some(
                          (row) => row.from === slot.terminalId || row.to === slot.terminalId,
                        ),
                    )
                    .map(({ terminalId }) => (
                      <option key={terminalId} value={terminalId}>
                        {terminalName(terminalId)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t('communication.state')}
                <select value={state} onChange={(event) => setState(event.target.value)}>
                  <option value="">{t('communication.all')}</option>
                  {states.map((value) => (
                    <option key={value} value={value}>
                      {t('communication.states.' + value)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('communication.time')}
                <select value={period} onChange={(event) => setPeriod(event.target.value)}>
                  <option value="">{t('communication.allTime')}</option>
                  <option value="3600000">{t('communication.lastHour')}</option>
                  <option value="86400000">{t('communication.lastDay')}</option>
                </select>
              </label>
            </>
          )}
        </div>
        {notice && (
          <p role="status" className="communication-feedback">
            {notice}
          </p>
        )}
        {tab === 'permissions' ? (
          active ? (
            <FeaturePermissions snapshot={snapshot} feature={feature} />
          ) : (
            <p className="communication-empty">{t('communication.activePermissions')}</p>
          )
        ) : (
          <>
            {tab === 'messages' && available && (
              <MentionComposer
                key={featureId}
                terminals={eligible}
                featureScoped
                recipientLimit={3}
                from={from}
                onFromChange={setFrom}
                onSend={async (message) => {
                  setNotice('');
                  if (!featureId) return 'denied';
                  const refusal = await operate(
                    {
                      kind: 'send',
                      featureId,
                      targetFeatureId: featureId,
                      from: message.from ?? 'owner',
                      to: message.to,
                      text: message.text,
                      task: false,
                    },
                    '@' + (eligible.find((entry) => entry.id === message.to[0])?.label ?? ''),
                  );
                  if (refusal) setNotice(refusal);
                  return refusal ? 'denied' : 'queued';
                }}
              />
            )}
            {!native || readFailed ? (
              <p className="communication-empty">{t('communication.refused.unavailable')}</p>
            ) : !featureId ? (
              <p className="communication-empty">{t('communication.selectFeature')}</p>
            ) : !current ? (
              <p className="communication-empty" role="status">
                {t('shell.loading')}
              </p>
            ) : !rows.length ? (
              <p className="communication-empty">{t('communication.empty.' + tab)}</p>
            ) : (
              <ol className="communication-rows">
                {rows.map((row) => (
                  <li key={row.id}>
                    <div className="communication-row-main">
                      <span className="communication-path">
                        <strong>{terminalName(row.from)}</strong>
                        <ArrowRight size={13} aria-label={t('communication.to')} />
                        <strong>{terminalName(row.to)}</strong>
                      </span>
                      <time dateTime={new Date(row.at).toISOString()} title={date.format(row.at)}>
                        {time.format(row.at)}
                      </time>
                      <span
                        className={'communication-badge delivery-' + row.delivery}
                        aria-label={t('communication.deliveryStatus', {
                          state: t('communication.states.' + row.delivery),
                        })}
                      >
                        {t('communication.states.' + row.delivery)}
                      </span>
                      {row.taskId && (
                        <span
                          className={'communication-badge task-' + row.task}
                          aria-label={t('communication.taskStatus', {
                            state: t('communication.states.' + (row.task ?? 'unknown')),
                          })}
                        >
                          {t('communication.states.' + (row.task ?? 'unknown'))}
                        </span>
                      )}
                    </div>
                    {tab === 'audit' ? (
                      <p className="communication-audit">
                        {t('communication.kind.' + row.kind)} · <code>{row.taskId ?? row.id}</code>
                      </p>
                    ) : (
                      <details className="communication-preview">
                        <summary>{row.text.replace(/\s+/g, ' ')}</summary>
                        <p>
                          {row.text}
                          {row.truncated && '…'}
                        </p>
                      </details>
                    )}
                    <div className="communication-actions">
                      <button
                        className="button"
                        type="button"
                        disabled={
                          acting ||
                          !feature?.terminalIds.includes(row.to) ||
                          !slots.some((slot) => slot.terminalId === row.to && !slot.closed)
                        }
                        onClick={() => void openDestination(row)}
                      >
                        <ArrowUpRight size={13} aria-hidden="true" /> {t('communication.open')}
                      </button>
                      <button
                        className="button"
                        type="button"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(tab === 'audit' ? (row.taskId ?? row.id) : row.text)
                            .then(
                              () => setNotice(t('communication.copied')),
                              () => setNotice(t('communication.copyFailed')),
                            );
                        }}
                      >
                        <Copy size={13} aria-hidden="true" /> {t('communication.copy')}
                      </button>
                      {row.retryable && active && (
                        <button
                          className="button"
                          type="button"
                          disabled={acting}
                          onClick={() =>
                            void operate(
                              { kind: 'retry', featureId, id: row.id },
                              terminalName(row.to),
                            ).then((refusal) => {
                              if (refusal) setNotice(refusal);
                            })
                          }
                        >
                          <RotateCw size={13} aria-hidden="true" /> {t('communication.retry')}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
      {delegate && available && featureId && (
        <DelegateDialog
          terminals={members}
          from={defaultSender}
          otherFeatures={features.length > 1}
          senders={current?.senders ?? []}
          onClose={() => setDelegate(false)}
          onSend={(sender, target, text) =>
            operate(
              {
                kind: 'send',
                featureId,
                targetFeatureId: featureId,
                from: sender ?? 'owner',
                to: [target],
                text,
                task: sender !== null,
              },
              '@' + (members.find(({ id }) => id === target)?.label ?? ''),
            )
          }
        />
      )}
    </section>
  );
}
