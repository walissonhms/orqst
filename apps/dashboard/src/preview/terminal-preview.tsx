/**
 * Development-only design preview of the Studio terminal workspace.
 * Every terminal and message here is SYNTHETIC; it is served by the Vite dev server
 * from `preview/terminals.html` and is never part of the production build.
 */
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import '../i18n';
import '../styles.css';
import {
  TerminalStudio,
  type AccountSuggestion,
  type StudioMessage,
  type StudioTerminal,
  type TerminalProvider,
} from '../TerminalStudio';
import {
  NewTerminalDialog,
  type ProviderCatalog,
  type TerminalRequest,
} from '../NewTerminalDialog';
import type { AccountOption } from '../PaneMenu';
import './terminal-preview.css';

const start = Date.now();
/** Synthetic workspaces; the app lists the user's real workspaces. */
const syntheticWorkspaces = [
  { id: 'ws-synthetic-a', name: 'Synthetic API', detail: '/synthetic/api' },
  { id: 'ws-synthetic-b', name: 'Synthetic Web', detail: '/synthetic/web' },
  { id: 'ws-synthetic-c', name: 'Synthetic Docs', detail: '/synthetic/docs' },
];
/** Synthetic account profiles; real ones are ORQST profile folders the user logs into via the CLI. */
const syntheticAccounts: AccountOption[] = [
  { id: 'acc-codex-1', provider: 'codex', label: 'Codex · Synthetic A', state: 'ready' },
  { id: 'acc-codex-2', provider: 'codex', label: 'Codex · Synthetic B', state: 'ready' },
  { id: 'acc-claude-1', provider: 'claude', label: 'Claude · Synthetic A', state: 'ready' },
  { id: 'acc-claude-2', provider: 'claude', label: 'Claude · Synthetic B', state: 'ready' },
  { id: 'acc-opencode-1', provider: 'opencode', label: 'OpenCode · Synthetic A', state: 'ready' },
];
const firstAccount = (provider: TerminalProvider) =>
  syntheticAccounts.find((account) => account.provider === provider);
const accountsFor = (provider: TerminalProvider) =>
  syntheticAccounts
    .filter((account) => account.provider === provider)
    .map(({ id, label, state }) => ({ id, label, state }));
const workspaceOf = (id: string) =>
  syntheticWorkspaces.find((workspace) => workspace.id === id) ?? syntheticWorkspaces[0]!;
const providers: TerminalProvider[] = ['codex', 'claude', 'opencode', 'claude', 'codex', 'shell'];
const models: (string | null)[] = [
  'gpt-5.5',
  'claude-opus-5-5',
  null,
  'claude-sonnet-5-5',
  'gpt-5.5',
  null,
];
const statuses: StudioTerminal['status'][] = [
  'running',
  'running',
  'waiting_for_user',
  'completed',
  'running',
  'unknown',
];

function synthetic(index: number): StudioTerminal {
  const n = index + 1;
  return {
    id: `synthetic-${n}`,
    label: `T-${String(n).padStart(3, '0')}`,
    name: `Synthetic ${n}`,
    provider: providers[index % providers.length]!,
    model: models[index % models.length],
    status: statuses[index % statuses.length]!,
    startedAt: start - (index + 1) * 97_000,
    lastActivity: 'Synthetic activity line',
    workspace: syntheticWorkspaces[index % 2]!,
    uuid: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    tokens: { total: 1_310_000 + n * 9_000, input: 1_200_000, output: 70_000 + n, cached: 707_000 },
    account: firstAccount(providers[index % providers.length]!),
  };
}

/** Synthetic catalog for the preview; the app uses the native catalog of confirmed models. */
const syntheticCatalog: ProviderCatalog[] = [
  {
    provider: 'codex',
    available: true,
    models: [{ id: 'gpt-5.5' }, { id: 'gpt-5.5-mini' }],
    accounts: accountsFor('codex'),
  },
  {
    provider: 'claude',
    available: true,
    models: [{ id: 'claude-opus-5-5' }, { id: 'claude-sonnet-5-5' }, { id: 'claude-haiku-5-5' }],
    accounts: accountsFor('claude'),
  },
  { provider: 'opencode', available: true, models: [{ id: 'opencode/default' }] },
  { provider: 'shell', available: true, models: [] },
];

function fromRequest(request: TerminalRequest, n: number): StudioTerminal {
  return {
    id: `synthetic-${n}`,
    label: `T-${String(n).padStart(3, '0')}`,
    name: request.name || `Synthetic ${n}`,
    provider: request.provider,
    model: request.model,
    status: 'running',
    startedAt: Date.now(),
    lastActivity: 'Synthetic activity line',
    workspace: workspaceOf(request.workspaceId),
    orchestrator: request.orchestrator,
    uuid: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    account: syntheticAccounts.find((account) => account.id === request.accountId),
  };
}

function SyntheticBody({ terminal }: { terminal: StudioTerminal }) {
  return (
    <pre className="tp-body">
      <span className="tp-tag">SYNTHETIC PREVIEW · not a real terminal</span>
      {'\n'}
      <span className="tp-dim">
        {terminal.provider} · {terminal.model ?? 'default model'}
      </span>
      {'\n\n'}
      {'› synthetic prompt line\n'}
      {'  synthetic output line 1\n'}
      {'  synthetic output line 2\n'}
      {'  synthetic output line 3\n\n'}
      <span className="tp-cursor">█</span>
    </pre>
  );
}

function Preview() {
  const { t, i18n } = useTranslation();
  const [terminals, setTerminals] = useState(() => [0, 1, 2, 3].map(synthetic));
  const [messages, setMessages] = useState<StudioMessage[]>([]);
  const [count, setCount] = useState(4);
  const [creating, setCreating] = useState(false);
  const [suggestions, setSuggestions] = useState<AccountSuggestion[]>([]);
  const ids = useMemo(() => terminals.map((terminal) => terminal.id), [terminals]);

  const send = (kind: StudioMessage['kind']) => {
    if (ids.length < 2) return;
    const from = ids[Math.floor(Math.random() * ids.length)]!;
    const others = ids.filter((id) => id !== from);
    const to = others[Math.floor(Math.random() * others.length)]!;
    setMessages((current) => [
      ...current.slice(-20),
      { id: `${Date.now()}-${from}`, from, to, kind },
    ]);
  };

  const setStatus = (from: StudioTerminal['status'][], to: StudioTerminal['status']) =>
    setTerminals((current) => {
      const candidates = current.filter((terminal) => from.includes(terminal.status));
      const chosen = candidates[Math.floor(Math.random() * candidates.length)];
      return chosen
        ? current.map((terminal) => (terminal === chosen ? { ...terminal, status: to } : terminal))
        : current;
    });

  return (
    <div className="tp-shell">
      <div className="tp-banner" role="note">
        <strong>{t('terminalStudio.preview.banner')}</strong>
        <span>{t('terminalStudio.preview.explain')}</span>
        <span className="tp-controls">
          <button type="button" onClick={() => send('message')}>
            {t('terminalStudio.preview.simulateMessage')}
          </button>
          <button type="button" onClick={() => send('delegation')}>
            {t('terminalStudio.preview.simulateDelegation')}
          </button>
          <button type="button" onClick={() => send('result')}>
            {t('terminalStudio.preview.simulateResult')}
          </button>
          <button
            type="button"
            onClick={() =>
              setStatus(['completed', 'unknown', 'waiting_for_user', 'failed'], 'running')
            }
          >
            {t('terminalStudio.preview.simulateStart')}
          </button>
          <button type="button" onClick={() => setStatus(['running'], 'completed')}>
            {t('terminalStudio.preview.simulateFinish')}
          </button>
          <button type="button" onClick={() => setStatus(['running'], 'waiting_for_user')}>
            {t('terminalStudio.preview.simulateAsk')}
          </button>
          <button
            type="button"
            onClick={() => {
              const target = terminals.find((terminal) => {
                const other = syntheticAccounts.find(
                  (account) =>
                    account.provider === terminal.provider && account.id !== terminal.account?.id,
                );
                return other && terminal.account;
              });
              if (!target) return;
              const other = syntheticAccounts.find(
                (account) =>
                  account.provider === target.provider && account.id !== target.account?.id,
              )!;
              setSuggestions((current) => [
                ...current.filter((entry) => entry.terminalId !== target.id),
                { terminalId: target.id, toAccountId: other.id, reason: 'limit_reached' },
              ]);
            }}
          >
            {t('terminalStudio.preview.simulateLimit')}
          </button>
          <button
            type="button"
            onClick={() => void i18n.changeLanguage(i18n.language === 'pt-BR' ? 'en-US' : 'pt-BR')}
          >
            {i18n.language === 'pt-BR' ? 'EN' : 'PT'}
          </button>
        </span>
      </div>
      <TerminalStudio
        storageKey="orqst.preview.terminalStudio"
        terminals={terminals}
        messages={messages}
        renderBody={(terminal) => <SyntheticBody terminal={terminal} />}
        onNewTerminal={() => setCreating(true)}
        accounts={syntheticAccounts}
        supportedActions={['refresh', 'copy-conversation', 'migrate']}
        accountSuggestions={suggestions}
        onTerminalAction={(id, action) => {
          if (action.type === 'copy-conversation')
            void navigator.clipboard?.writeText(
              action.withTools ? 'SYNTHETIC conversation with tools' : 'SYNTHETIC conversation',
            );
          if (action.type === 'migrate') {
            const account = syntheticAccounts.find((entry) => entry.id === action.accountId);
            setSuggestions((current) => current.filter((entry) => entry.terminalId !== id));
            setTerminals((current) => {
              const source = current.find((terminal) => terminal.id === id);
              if (!source || !account) return current;
              if (action.mode === 'move')
                return current.map((terminal) =>
                  terminal.id === id ? { ...terminal, account } : terminal,
                );
              const n = count + 1;
              setCount(n);
              return [
                ...current,
                {
                  ...source,
                  id: `synthetic-${n}`,
                  label: `T-${String(n).padStart(3, '0')}`,
                  name: `${source.name} (copy)`,
                  account,
                  orchestrator: false,
                  startedAt: Date.now(),
                },
              ];
            });
          }
        }}
        onOrchestratorChange={(id) =>
          setTerminals((current) =>
            current.map((terminal) => ({ ...terminal, orchestrator: terminal.id === id })),
          )
        }
        onMention={async ({ from, to }) => {
          // Synthetic delivery: accepted, then each recipient works and returns a result.
          await new Promise((resolve) => setTimeout(resolve, 350));
          const sender = from ?? null;
          setMessages((current) => [
            ...current.slice(-20),
            ...to.map((target) => ({
              id: `${Date.now()}-${target}-m`,
              from: sender ?? target,
              to: target,
              kind: 'delegation' as const,
            })),
          ]);
          setTerminals((current) =>
            current.map((terminal) =>
              to.includes(terminal.id) ? { ...terminal, status: 'running' } : terminal,
            ),
          );
          window.setTimeout(() => {
            setTerminals((current) =>
              current.map((terminal) =>
                to.includes(terminal.id) ? { ...terminal, status: 'completed' } : terminal,
              ),
            );
            if (sender)
              setMessages((current) => [
                ...current.slice(-20),
                ...to.map((target) => ({
                  id: `${Date.now()}-${target}-r`,
                  from: target,
                  to: sender,
                  kind: 'result' as const,
                })),
              ]);
          }, 3200);
          return 'accepted';
        }}
        onStatusEvent={(event, terminal) => {
          // The app sends a native OS notification; the preview uses the browser one.
          if (typeof Notification === 'undefined') return;
          const show = () =>
            new Notification(`${terminal.label} ${terminal.name}`, {
              body: `${t(`terminalStudio.notice.${event.status}`)} · ${terminal.workspace.name}`,
              tag: event.id,
            });
          if (Notification.permission === 'granted') show();
          else if (Notification.permission === 'default')
            void Notification.requestPermission().then((p) => p === 'granted' && show());
        }}
        onClose={(id) =>
          setTerminals((current) => current.filter((terminal) => terminal.id !== id))
        }
      />
      {creating && (
        <NewTerminalDialog
          catalog={syntheticCatalog}
          workspaces={syntheticWorkspaces}
          initialWorkspaceId={syntheticWorkspaces[0]!.id}
          max={Math.max(0, 12 - terminals.length)}
          onCancel={() => setCreating(false)}
          onConfirm={(requests) => {
            setTerminals((current) => [
              ...current,
              ...requests.map((request, index) => fromRequest(request, count + index + 1)),
            ]);
            setCount((value) => value + requests.length);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
