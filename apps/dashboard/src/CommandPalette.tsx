import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Search, X } from 'lucide-react';
import type { Snapshot } from '@orqst/protocol';
import { Modal } from './Modal';
import type { StudioScope, StudioShellCommand } from './navigation';
import type { StudioTerminal } from './TerminalStudio';
import type { ShellWorkspace } from './ShellSidebar';
import { appViews, type AppView } from './shell-preferences';

export function CommandPalette({
  snapshot,
  studioScope,
  workspaces,
  features,
  onNavigate,
  onWorkspace,
  onSession,
  onNotifications,
  onCreate,
  onFeature,
  onStudioCommand,
  onClose,
}: {
  snapshot?: Snapshot;
  studioScope?: StudioScope;
  workspaces: ShellWorkspace[];
  features: { id: string; name: string; description: string; terminals: StudioTerminal[] }[];
  onNavigate: (view: AppView) => void;
  onWorkspace: (id: string) => void;
  onSession: (id: string) => void;
  onNotifications: () => void;
  onCreate: () => void;
  onFeature: (id: string, terminalId?: string) => void;
  onStudioCommand?: (command: StudioShellCommand) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const entries = [
    ...(onStudioCommand
      ? (['newTerminal', 'delegate'] as const).map((command) => ({
          id: `action:${command}`,
          label: t(`shell.frame.${command}`),
          detail: t('shell.palette.actions'),
          action: () => onStudioCommand(command),
        }))
      : []),
    ...appViews.map((view) => ({
      id: `view:${view}`,
      label: t(`shell.views.${view}`),
      detail:
        view === 'studio' && studioScope?.featureName
          ? t('shell.palette.studioScope', {
              workspace: studioScope.workspace.name,
              feature: studioScope.featureName,
            })
          : t('shell.palette.goTo', { route: t(`shell.views.${view}`) }),
      action: () => onNavigate(view),
    })),
    {
      id: 'notifications',
      label: t('notifications'),
      detail: t('shell.palette.actions'),
      action: onNotifications,
    },
    {
      id: 'create',
      label: t('createWorkspace'),
      detail: t('shell.palette.actions'),
      action: onCreate,
    },
    ...workspaces.map((workspace) => ({
      id: `workspace:${workspace.id}`,
      label: workspace.name,
      detail: t('features.workspace'),
      action: () => onWorkspace(workspace.id),
    })),
    ...features.flatMap((feature) => [
      {
        id: `feature:${feature.id}`,
        label: feature.name,
        detail: feature.description,
        action: () => onFeature(feature.id),
      },
      ...feature.terminals.map((terminal) => ({
        id: `terminal:${terminal.id}`,
        label: `${terminal.label} · ${terminal.name === 'Claude Code' ? 'Claude' : terminal.name}`,
        detail: [
          terminal.alias && `@${terminal.alias}`,
          t(`shell.adapters.${terminal.provider}`),
          terminal.model,
          feature.name,
        ]
          .filter(Boolean)
          .join(' · '),
        action: () => onFeature(feature.id, terminal.id),
      })),
    ]),
    ...(snapshot?.sessions ?? []).map((session) => ({
      id: `session:${session.id}`,
      label: session.agentName,
      detail: `${session.adapter} · ${session.model ?? t('modelObservation.notRecorded')} · ${session.task ?? session.id}`,
      action: () => onSession(session.id),
    })),
  ];
  const searchable = (text: string) =>
    text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const terms = searchable(query.trim()).split(/\s+/);
  const matches = entries.filter((entry) => {
    const text = searchable(`${entry.label} ${entry.detail} ${entry.id}`);
    return terms.every((term) => text.includes(term));
  });
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
        <p className="fine-print" title={t('shell.palette.help.detail')}>
          {t('shell.palette.help.label')}
        </p>
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
              <small title={entry.detail}>{entry.detail}</small>
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
