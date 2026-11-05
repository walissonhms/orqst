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
  type StudioMessage,
  type StudioTerminal,
  type TerminalProvider,
} from '../TerminalStudio';
import './terminal-preview.css';

const start = Date.now();
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
        onNewTerminal={() => {
          setTerminals((current) => [...current, synthetic(count)]);
          setCount((value) => value + 1);
        }}
        onClose={(id) =>
          setTerminals((current) => current.filter((terminal) => terminal.id !== id))
        }
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
