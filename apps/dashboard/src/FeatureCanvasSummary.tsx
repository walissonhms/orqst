import { useTranslation } from 'react-i18next';
import type { CanvasAgent } from './feature-canvas.js';

export function CanvasSessionList({
  agents,
  query,
  busy,
  onOpen,
}: {
  agents: CanvasAgent[];
  query: string;
  busy: boolean;
  onOpen: (agent: CanvasAgent) => void;
}) {
  const { t } = useTranslation();
  const matching = agents.filter((agent) =>
    agent.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const sections = [
    {
      key: 'needsSection',
      members: matching.filter((agent) => agent.session?.status === 'waiting_for_user'),
    },
    {
      key: 'runningSection',
      members: matching.filter((agent) => agent.session?.status === 'running'),
    },
    {
      key: 'recentSection',
      members: matching
        .filter(
          (agent) =>
            agent.session && !['running', 'waiting_for_user'].includes(agent.session.status),
        )
        .sort((a, b) => Date.parse(b.session!.lastActivity) - Date.parse(a.session!.lastActivity)),
    },
    { key: 'terminalsSection', members: matching.filter((agent) => !agent.session) },
  ];
  return (
    <nav className="canvas-session-list" aria-label={t('canvas.sessions')}>
      {sections.map((section) => (
        <details key={section.key} open>
          <summary>
            {t(`canvas.${section.key}`)}
            <small>{section.members.length}</small>
          </summary>
          {section.members.map((agent) => (
            <button
              key={agent.id}
              disabled={busy}
              onClick={() => onOpen(agent)}
              data-status={agent.session?.status ?? 'unknown'}
            >
              <span className="canvas-session-marker" />
              <span>{agent.title}</span>
              {agent.session?.status === 'waiting_for_user' && (
                <span className="canvas-attention-dot" />
              )}
            </button>
          ))}
        </details>
      ))}
    </nav>
  );
}

export function CanvasStatusBar({
  agents,
  connected,
}: {
  agents: CanvasAgent[];
  connected: boolean;
}) {
  const { t, i18n } = useTranslation();
  const running = agents.filter((agent) => agent.session?.status === 'running').length;
  const needs = agents.filter((agent) => agent.session?.status === 'waiting_for_user').length;
  const unknown = agents.filter(
    (agent) => !agent.session || agent.session.status === 'unknown',
  ).length;
  return (
    <div className="canvas-status-bar" role="status">
      <span>
        {t('canvas.running', { count: running })}{' '}
        <span className="canvas-needs"> · {t('canvas.needs', { count: needs })}</span>
        {unknown > 0 && <span> · {t('canvas.unknown', { count: unknown })}</span>}
      </span>
      <span className={connected ? 'canvas-core-connected' : ''}>
        {t(connected ? 'canvas.metadataConnected' : 'canvas.metadataUnavailable')}{' '}
        <span> · v0.1.0 · {i18n.resolvedLanguage === 'pt-BR' ? 'pt' : 'en'}</span>
      </span>
    </div>
  );
}
