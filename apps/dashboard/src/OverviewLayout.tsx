import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import {
  featureDisplayName,
  type FeatureNativeReply,
  type FeatureNativeSnapshot,
  type Snapshot,
} from '@orqst/protocol';
import { useOverviewPeriod } from './overview-preferences';
import { permissionTerminals } from './feature-permissions-matrix';
import { STALE_MS } from './shell-sections';
import './spec-screens.css';

export interface StudioCardTarget {
  featureId: string;
  terminalId: string;
}

export function useOverviewReading(scope?: FeatureNativeSnapshot) {
  const native = window.orqstFeatures?.contractVersion === 1 ? window.orqstFeatures : undefined;
  const workspaceId = scope?.workspace.id;
  const generation = scope?.generation;
  const featureId = scope?.activeFeatureId;
  const [revision, setRevision] = useState(0);
  const [reading, setReading] = useState<{ key: string; reply?: FeatureNativeReply }>();
  const key = JSON.stringify([workspaceId, generation, featureId, revision]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!native || generation === undefined) return;
    let active = true;
    void native
      .request({ action: 'snapshot', contractVersion: 1, generation })
      .then((reply) => {
        if (!active) return;
        const current = reply.snapshot;
        setReading({
          key,
          reply:
            reply.status === 'ok' &&
            current?.workspace.id === workspaceId &&
            current?.generation === generation &&
            current?.activeFeatureId === featureId
              ? reply
              : undefined,
        });
      })
      .catch(() => {
        if (active) setReading({ key });
      });
    return () => {
      active = false;
    };
  }, [native, generation, workspaceId, featureId, key]);
  return { reply: reading?.key === key ? reading.reply : undefined, refresh };
}

export function OverviewLayout({
  scope,
  snapshot,
  online,
  onRefresh,
  onOpen,
}: {
  scope?: FeatureNativeSnapshot;
  snapshot?: Snapshot;
  online: boolean;
  onRefresh: () => Promise<unknown>;
  onOpen: (target: StudioCardTarget) => Promise<boolean>;
}) {
  const { t, i18n } = useTranslation();
  const { period, setPeriod } = useOverviewPeriod();
  const { reply, refresh } = useOverviewReading(scope);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<'openFailed' | 'refreshFailed'>();
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const since = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - Number(period),
  ).getTime();
  const slots = new Map(scope?.slots.map((slot) => [slot.terminalId, slot]));
  const evidence = new Map(reply?.canvas?.entries.map((entry) => [entry.terminalId, entry]));
  const rows =
    scope?.features.flatMap((feature) => {
      if (feature.status === 'archived') return [];
      return permissionTerminals(scope, feature.featureId).flatMap(({ terminalId, label }) => {
        const slot = slots.get(terminalId);
        if (!slot || slot.closed) return [];
        const reading = evidence.get(terminalId);
        const state =
          reading?.state === 'exited'
            ? 'ended'
            : reading?.agentState && reading.agentState !== 'unknown'
              ? reading.agentState
              : reading?.state === 'running'
                ? 'running'
                : 'unknown';
        return [
          {
            featureId: feature.featureId,
            feature: featureDisplayName(feature, t('features.defaultName')),
            terminalId,
            label,
            slot,
            reading,
            state,
            lastActivity: Math.max(0, ...(reading?.activities ?? []).map((event) => event.at)),
          },
        ];
      });
    }) ?? [];
  const attention = rows.filter(
    (row) => row.state === 'waiting_for_user' || row.state === 'failed',
  );
  const messages = reply?.communication?.events ?? [];
  const messageWindowCovered = messages.length < 50 || messages.some(({ at }) => at < today);
  const hasTurnEvidence =
    !!reply?.canvas &&
    (rows.every(({ reading }) => reading?.state === 'exited') ||
      rows.some(({ reading }) => reading?.agentState && reading.agentState !== 'unknown'));
  const measuredToday = rows.filter(
    ({ reading }) =>
      reading?.usage && reading.startedAt !== undefined && reading.startedAt >= today,
  );
  const counters = [
    [
      'active',
      reply?.canvas ? rows.filter(({ reading }) => reading?.state === 'running').length : undefined,
    ],
    [
      'waiting',
      hasTurnEvidence
        ? attention.filter(({ state }) => state === 'waiting_for_user').length
        : undefined,
    ],
    [
      'failures',
      hasTurnEvidence ? attention.filter(({ state }) => state === 'failed').length : undefined,
    ],
    [
      'messagesToday',
      reply?.communication && !!scope?.activeFeatureId && messageWindowCovered
        ? messages.filter(({ at, kind }) => at >= today && kind === 'message').length
        : undefined,
    ],
    [
      'tokensToday',
      measuredToday.length
        ? measuredToday.reduce((sum, { reading }) => sum + (reading?.usage?.total ?? 0), 0)
        : undefined,
    ],
  ] as const;
  const activity = rows.flatMap((row) =>
    (row.reading?.activities ?? []).map(({ at, label }) => ({
      key: JSON.stringify([row.terminalId, at, label]),
      featureId: row.featureId,
      at,
      label,
    })),
  );
  for (const event of messages) {
    const from = rows.find((row) => row.terminalId === event.from);
    const to = rows.find((row) => row.terminalId === event.to);
    if (!from || !to || from.featureId !== to.featureId) continue;
    activity.push({
      key: event.id,
      featureId: from.featureId,
      at: event.at,
      label: t(`screens.overview.event.${event.kind}`, {
        from: t(`screens.cli.${from.slot.provider}`),
        to: t(`screens.cli.${to.slot.provider}`),
      }),
    });
  }
  const recent = activity
    .filter(({ at }) => at >= since)
    .sort((a, b) => b.at - a.at)
    .slice(0, 25);
  const groups = new Map<string, typeof recent>();
  for (const event of recent) {
    const group = groups.get(event.featureId) ?? [];
    group.push(event);
    groups.set(event.featureId, group);
  }
  const owned = new Set(
    reply?.canvas?.entries.flatMap(({ session }) => (session ? [session.sessionId] : [])),
  );
  function stateLabel(state: string) {
    if (state === 'unknown') return '—';
    if (state === 'ended' || state === 'waiting_for_user')
      return t(state === 'ended' ? 'screens.overview.ended' : 'screens.overview.waiting');
    return t(`statusLabels.${state}`);
  }
  const observed = snapshot?.sessions.filter((session) => !owned.has(session.id)) ?? [];
  const formatDate = (at: number) => (at ? date.format(at) : '—');
  function open(target: StudioCardTarget) {
    setFailure(undefined);
    setBusy(true);
    void onOpen(target)
      .then((opened) => {
        if (!opened) setFailure('openFailed');
      })
      .catch(() => setFailure('openFailed'))
      .finally(() => setBusy(false));
  }
  const tools = (
    <>
      <label>
        {t('analytics.period')}{' '}
        <select
          value={period}
          onChange={(event) => setPeriod(event.target.value === '0' ? '0' : '6')}
        >
          <option value="0">{t('analytics.periods.today')}</option>
          <option value="6">{t('analytics.periods.week')}</option>
        </select>
      </label>
      <button
        className="button"
        disabled={busy}
        onClick={() => {
          setFailure(undefined);
          refresh();
          if (online) void onRefresh().catch(() => setFailure('refreshFailed'));
        }}
      >
        <RefreshCw size={13} />
        {t('analytics.refresh')}
      </button>
    </>
  );
  return (
    <section className="spec-screen" aria-labelledby="overview-title">
      <div className="spec-head">
        <h1 id="overview-title">{t('overviewPage.title')}</h1>
        <div className="spec-actions">{tools}</div>
      </div>
      {failure && <p role="alert">{t(`screens.overview.${failure}`)}</p>}
      <dl className="spec-counters">
        {counters.map(([key, value]) => (
          <div
            key={key}
            title={
              key === 'messagesToday' || key === 'tokensToday'
                ? t(`screens.overview.${key}Help`)
                : undefined
            }
          >
            <dt>{t(`screens.overview.${key}`)}</dt>
            <dd>{value === undefined ? '—' : number.format(value)}</dd>
          </div>
        ))}
      </dl>
      <section className="spec-panel">
        <h2>{t('screens.overview.attention')}</h2>
        {attention.length ? (
          <ul className="spec-rows">
            {attention.map((row) => (
              <li key={row.terminalId}>
                <span>
                  {row.feature} · {row.label} · {t(`screens.cli.${row.slot.provider}`)} ·{' '}
                  {stateLabel(row.state)}
                </span>
                <button className="button" disabled={busy} onClick={() => open(row)}>
                  {t('screens.open')}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>{hasTurnEvidence ? t('attentionEmpty') : '—'}</p>
        )}
      </section>
      <section className="spec-panel">
        <h2>{t('screens.overview.terminals')}</h2>
        <div className="table-scroll">
          <table className="spec-table">
            <thead>
              <tr>
                {[
                  'screens.feature',
                  'screens.overview.terminal',
                  'screens.cliLabel',
                  'model',
                  'status',
                  'lastActivity',
                ].map((label) => (
                  <th key={label} scope="col">
                    {t(label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.terminalId}>
                  <td>
                    <button className="button spec-link" disabled={busy} onClick={() => open(row)}>
                      {row.feature}
                    </button>
                  </td>
                  <td title={row.terminalId}>{row.label}</td>
                  <td>{t(`screens.cli.${row.slot.provider}`)}</td>
                  <td>{row.slot.selectedModel ?? '—'}</td>
                  <td>{stateLabel(row.state)}</td>
                  <td>{formatDate(row.lastActivity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <p>{scope ? t('screens.overview.noTerminals') : '—'}</p>}
      </section>
      <section className="spec-panel">
        <h2>{t('screens.overview.recent')}</h2>
        {!groups.size && (
          <p>{reply?.canvas || reply?.communication ? t('screens.overview.noEvents') : '—'}</p>
        )}
        {[...groups].map(([featureId, events]) => (
          <div className="spec-event-group" key={featureId}>
            <h3>{rows.find((row) => row.featureId === featureId)?.feature}</h3>
            <ul className="spec-rows">
              {events.map((event, index) => (
                <li key={`${event.key}:${index}`}>
                  <span>{event.label}</span>
                  <time dateTime={new Date(event.at).toISOString()}>{formatDate(event.at)}</time>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      <details className="spec-panel">
        <summary>{t('screens.overview.observed')}</summary>
        <div className="table-scroll">
          <table className="spec-table">
            <thead>
              <tr>
                {[
                  'screens.overview.session',
                  'screens.cliLabel',
                  'model',
                  'status',
                  'lastActivity',
                ].map((label) => (
                  <th key={label} scope="col">
                    {t(label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {observed.map((session) => (
                <tr key={session.id}>
                  <td>{session.agentName}</td>
                  <td>{t(`screens.cli.${session.adapter}`, { defaultValue: session.adapter })}</td>
                  <td>{session.model ?? '—'}</td>
                  <td>
                    {t(
                      `statusLabels.${session.status === 'running' && Date.now() - Date.parse(session.lastActivity) > STALE_MS ? 'stale' : session.status}`,
                    )}
                  </td>
                  <td>{formatDate(Date.parse(session.lastActivity))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!observed.length && <p>{online ? t('screens.overview.noObserved') : '—'}</p>}
      </details>
    </section>
  );
}
