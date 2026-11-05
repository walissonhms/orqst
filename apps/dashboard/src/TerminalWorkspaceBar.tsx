import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkspacePane } from './feature-workspace-dock.js';

export type PaneCommand = 'focus' | 'hide' | 'maximize' | 'restore' | 'move-earlier' | 'move-later';

/** Native workspace chrome only: xterm documents and processes are never mounted here. */
export function TerminalWorkspaceBar({
  panes,
  busy,
  onCommand,
  onRename,
  onMove,
  onPrepare,
}: {
  panes: WorkspacePane[];
  busy: boolean;
  onCommand(slot: number, command: PaneCommand): void;
  onRename(slot: number): void;
  onMove(slot: number, target: number): void;
  onPrepare?: () => void;
}) {
  const { t } = useTranslation();
  const dragging = useRef<number | null>(null);
  const selected = panes.find((pane) => pane.active);
  return (
    <div className="feature-terminalbar">
      <nav className="feature-terminal-tabs" aria-label={t('features.terminalTabs')}>
        {panes.map((pane) => {
          const identity = `T-${String(pane.slot + 1).padStart(3, '0')}`;
          return (
            <button
              key={pane.slot}
              type="button"
              className="feature-terminal-tab"
              data-active={pane.active && !pane.minimized}
              data-minimized={pane.minimized}
              aria-pressed={pane.active && !pane.minimized}
              aria-label={`${identity} · ${pane.label} · ${pane.provider}${pane.minimized ? ` · ${t('features.dockLabel')}` : ''}`}
              title={t('features.tabHelp')}
              disabled={busy}
              draggable={!busy}
              onClick={() => onCommand(pane.slot, 'focus')}
              onDoubleClick={() => onRename(pane.slot)}
              onKeyDown={(event) => {
                if (event.key === 'F2') {
                  event.preventDefault();
                  onRename(pane.slot);
                }
                if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                  event.preventDefault();
                  onCommand(pane.slot, event.key === 'ArrowLeft' ? 'move-earlier' : 'move-later');
                }
              }}
              onDragStart={(event) => {
                dragging.current = pane.slot;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', identity);
              }}
              onDragEnd={() => {
                dragging.current = null;
              }}
              onDragOver={(event) => {
                if (dragging.current !== null) event.preventDefault();
              }}
              onDrop={(event) => {
                if (dragging.current === null || busy) return;
                event.preventDefault();
                if (dragging.current !== pane.slot) onMove(dragging.current, pane.slot);
                dragging.current = null;
              }}
            >
              <span className="feature-tab-id">{identity}</span>
              <span className="feature-tab-name">{pane.label}</span>
              <small>{pane.provider}</small>
              {pane.minimized && <span aria-hidden="true">−</span>}
            </button>
          );
        })}
        {onPrepare && (
          <button
            type="button"
            className="feature-terminal-add"
            disabled={busy}
            onClick={onPrepare}
            aria-label={t('features.terminal')}
            title={t('features.terminal')}
          >
            ＋
          </button>
        )}
      </nav>
      {selected && (
        <div
          className="feature-terminal-tools"
          role="group"
          aria-label={t('features.paneControls')}
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => onRename(selected.slot)}
            title={t('managedTerminal.rename')}
            aria-label={t('managedTerminal.rename')}
          >
            ✎
          </button>
          <button
            type="button"
            disabled={busy || panes[0]?.slot === selected.slot}
            onClick={() => onCommand(selected.slot, 'move-earlier')}
            title={t('managedTerminal.move-earlier')}
            aria-label={t('managedTerminal.move-earlier')}
          >
            ←
          </button>
          <button
            type="button"
            disabled={busy || panes.at(-1)?.slot === selected.slot}
            onClick={() => onCommand(selected.slot, 'move-later')}
            title={t('managedTerminal.move-later')}
            aria-label={t('managedTerminal.move-later')}
          >
            →
          </button>
          <button
            type="button"
            disabled={busy || selected.minimized}
            onClick={() => onCommand(selected.slot, 'hide')}
            title={t('managedTerminal.minimize')}
            aria-label={t('managedTerminal.minimize')}
          >
            −
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onCommand(selected.slot, selected.maximized ? 'restore' : 'maximize')}
            title={t(`managedTerminal.${selected.maximized ? 'restore' : 'maximize'}`)}
            aria-label={t(`managedTerminal.${selected.maximized ? 'restore' : 'maximize'}`)}
          >
            {selected.maximized ? '❐' : '□'}
          </button>
        </div>
      )}
    </div>
  );
}
