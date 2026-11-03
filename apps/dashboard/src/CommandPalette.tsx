import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Search, X } from 'lucide-react';
import type { Snapshot } from '@orqst/protocol';
import { Modal } from './Modal';
import { appViews, type AppView } from './shell-preferences';

export function CommandPalette({
  snapshot,
  onNavigate,
  onWorkspace,
  onSession,
  onNotifications,
  onCreate,
  onGuide,
  onClose,
}: {
  snapshot?: Snapshot;
  onNavigate: (view: AppView) => void;
  onWorkspace: (id: string) => void;
  onSession: (id: string) => void;
  onNotifications: () => void;
  onCreate: () => void;
  onGuide: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const entries = [
    ...appViews.map((view) => ({
      id: `view:${view}`,
      label: t(`shell.views.${view}`),
      detail: t('shell.palette.navigation'),
      action: () => onNavigate(view),
    })),
    {
      id: 'notifications',
      label: t('notifications'),
      detail: t('shell.palette.actions'),
      action: onNotifications,
    },
    {
      id: 'observation-guide',
      label: t('observationGuide.title'),
      detail: t('shell.palette.actions'),
      action: onGuide,
    },
    {
      id: 'create',
      label: t('createWorkspace'),
      detail: t('shell.palette.actions'),
      action: onCreate,
    },
    ...(snapshot?.workspaces ?? []).map((workspace) => ({
      id: `workspace:${workspace.id}`,
      label: workspace.name,
      detail: workspace.path,
      action: () => onWorkspace(workspace.id),
    })),
    ...(snapshot?.sessions ?? []).map((session) => ({
      id: `session:${session.id}`,
      label: session.agentName,
      detail: `${session.adapter} · ${session.model ?? t('modelObservation.notRecorded')} · ${session.task ?? session.id}`,
      action: () => onSession(session.id),
    })),
  ];
  const matches = entries.filter((entry) =>
    `${entry.label} ${entry.detail} ${entry.id}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const visible = matches.slice(0, 60);
  return (
    <Modal
      label={t('shell.palette.title')}
      className="command-palette panel shell-dialog"
      initialFocus="input"
      onClose={onClose}
    >
      <div className="panel-heading">
        <h2>
          <Search size={18} />
          {t('shell.palette.title')}
        </h2>
        <button className="icon-button" aria-label={t('close')} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="palette-search">
        <input
          aria-label={t('shell.palette.search')}
          placeholder={t('shell.palette.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              event.currentTarget
                .closest('dialog')
                ?.querySelector<HTMLButtonElement>('.palette-result')
                ?.focus();
            } else if (event.key === 'Enter' && visible[0]) {
              event.preventDefault();
              onClose();
              visible[0].action();
            }
          }}
        />
        <p className="fine-print">{t('shell.palette.help')}</p>
      </div>
      <div
        className="palette-results"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>('.palette-result'),
          ];
          const index = buttons.findIndex((button) => button === document.activeElement);
          if (index < 0) return;
          event.preventDefault();
          buttons[
            (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
          ]?.focus();
        }}
      >
        {visible.map((entry) => (
          <button
            className="palette-result"
            key={entry.id}
            onClick={() => {
              onClose();
              entry.action();
            }}
          >
            <span>
              <strong>{entry.label}</strong>
              <small>{entry.detail}</small>
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
        {!matches.length && <p className="empty-copy">{t('shell.palette.empty')}</p>}
      </div>
      <p className="panel-footer" aria-live="polite">
        {t('shell.palette.count', { count: matches.length, shown: visible.length })}
      </p>
    </Modal>
  );
}
