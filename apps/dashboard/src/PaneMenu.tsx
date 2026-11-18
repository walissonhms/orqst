import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Copy,
  CopyPlus,
  ExternalLink,
  Info,
  Crown,
  LayoutGrid,
  Minus,
  Settings,
  Square,
  PictureInPicture2,
  Maximize,
  Maximize2,
  MoreHorizontal,
  MoveRight,
  Pin,
  RefreshCw,
} from 'lucide-react';
import type { StudioTerminal } from './FeatureStudioStage';
import { studioArrangementModes, type ArrangementMode } from './terminal-arrangement';

interface CanonicalPaneMenu {
  onRename?: () => void;
  onDuplicate?: () => void;
  onHide: () => void;
  onRole?: () => void;
  onMention?: () => void;
  onFloat?: () => void;
  onDock?: () => void;
  onTerminate?: () => void;
  onRestart?: () => void;
  mode: ArrangementMode;
  onLayoutMode(mode: ArrangementMode): void;
}

/** Actions a pane menu can request. The host decides which ones exist today. */
export type PaneAction =
  | { type: 'refresh' }
  | { type: 'copy-conversation'; withTools: boolean }
  | { type: 'details' }
  | { type: 'detach' }
  | { type: 'migrate'; accountId: string; mode: 'move' | 'duplicate' };

export type PaneActionType = PaneAction['type'];

export interface AccountOption {
  id: string;
  provider: StudioTerminal['provider'];
  label: string;
  /** Only evidenced states; `unknown` when ORQST cannot tell. */
  state: 'ready' | 'limited' | 'signed_out' | 'unknown';
}

interface Props {
  v6?: CanonicalPaneMenu;
  orchestrator?: boolean;
  terminal: StudioTerminal;
  accounts: AccountOption[];
  supported: ReadonlySet<PaneActionType>;
  maximized: boolean;
  pinned: boolean;
  onAction: (action: PaneAction) => void;
  onToggleMaximize: () => void;
  onTogglePin: () => void;
  /** Omitted for native PTY views, which cannot follow a chrome-less layout yet. */
  onFullScreen?: () => void;
  /** Lets a native host hide terminal views while the menu covers them. */
  onOpenChange?: (open: boolean) => void;
}

const format = (value: number | undefined) => {
  if (value === undefined) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
};

export function PaneMenu({
  v6,
  orchestrator,
  terminal,
  accounts,
  supported,
  maximized,
  pinned,
  onAction,
  onToggleMaximize,
  onTogglePin,
  onFullScreen,
  onOpenChange,
}: Props) {
  const { t } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const openChange = useRef(onOpenChange);
  openChange.current = onOpenChange;
  useEffect(() => openChange.current?.(open), [open]);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const width = v6 ? 215 : 340;
    const height = menu.current?.offsetHeight ?? 420;
    setPosition({
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top:
        rect.bottom + 6 + height > window.innerHeight
          ? Math.max(8, rect.top - height - 6)
          : rect.bottom + 6,
    });
  }, [open, !!v6, layoutsOpen]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const close = (event: PointerEvent) => {
      if (menu.current?.contains(event.target as Node)) return;
      if (button.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
    button.current?.focus();
  };
  const unsupported = t('terminalStudio.menu.unavailable');
  const item = (
    type: PaneActionType | null,
    icon: React.ReactNode,
    label: string,
    action: (() => void) | undefined,
    reason = unsupported,
    danger = false,
  ) => {
    // Actions the host does not support are not offered at all (no dead menu entries).
    if (type !== null && !supported.has(type)) return null;
    return (
      <button
        type="button"
        role="menuitem"
        className={danger ? 'pm-item pm-danger' : 'pm-item'}
        disabled={!action}
        title={action ? undefined : reason}
        onClick={action && run(action)}
      >
        {icon}
        <span>{label}</span>
      </button>
    );
  };
  const tokens = terminal.tokens;
  const others = accounts.filter(
    (account) => account.provider === terminal.provider && account.id !== terminal.account?.id,
  );

  return (
    <>
      <button
        ref={button}
        type="button"
        className="ts-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('terminalStudio.menu.open')}
        title={t('terminalStudio.menu.open')}
        onClick={() => {
          setLayoutsOpen(false);
          setOpen(!open);
        }}
      >
        <MoreHorizontal size={15} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className={`pm-menu${v6 ? ' pm-v6' : ''}`}
            data-native-overlay=""
            role="menu"
            aria-label={t('terminalStudio.menu.title', { label: terminal.label })}
            style={{ top: position.top, left: position.left }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                button.current?.focus();
              }
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const items = [
                  ...(menu.current?.querySelectorAll<HTMLElement>(
                    '[role="menuitem"]:not([disabled]), [role="menuitemradio"]',
                  ) ?? []),
                ];
                const index = items.indexOf(document.activeElement as HTMLElement);
                const next =
                  event.key === 'Home'
                    ? items[0]
                    : event.key === 'End'
                      ? items.at(-1)
                      : items[
                          (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
                            items.length
                        ];
                next?.focus();
              }
            }}
          >
            {v6 ? (
              <>
                {item(null, <Settings size={15} />, t('studio.pane.settings'), v6.onRename)}
                {item(
                  null,
                  <Crown size={15} />,
                  t(
                    orchestrator
                      ? 'terminalStudio.unsetOrchestrator'
                      : 'terminalStudio.setOrchestrator',
                  ),
                  v6.onRole,
                )}
                {item(
                  null,
                  <PictureInPicture2 size={15} />,
                  t(v6.onDock ? 'studio.pane.dock' : 'studio.pane.float'),
                  v6.onDock ?? v6.onFloat,
                )}
                {item(null, <Minus size={15} />, t('studio.pane.hide'), v6.onHide)}
                {item(null, <Square size={15} />, t('studio.pane.maximize'), onToggleMaximize)}
                {item(
                  null,
                  <CopyPlus size={15} />,
                  t('studio.pane.duplicateConfig'),
                  v6.onDuplicate,
                )}
                {item(null, <ExternalLink size={15} />, t('studio.pane.sendMessage'), v6.onMention)}
                {item(null, <RefreshCw size={15} />, t('studio.pane.restart'), v6.onRestart)}
                {item(null, <Info size={15} />, t('studio.pane.details'), () =>
                  onAction({ type: 'details' }),
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="pm-item"
                  aria-expanded={layoutsOpen}
                  onClick={() => setLayoutsOpen((previous) => !previous)}
                >
                  <LayoutGrid size={15} aria-hidden="true" />
                  <span>{t('studio.pane.layouts')}</span>
                </button>
                {layoutsOpen && (
                  <div
                    className="pm-arrangements"
                    role="group"
                    aria-label={t('studio.pane.layouts')}
                  >
                    {studioArrangementModes.map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        role="menuitemradio"
                        aria-checked={mode === v6.mode}
                        onClick={run(() => v6.onLayoutMode(mode))}
                      >
                        {t(`terminalStudio.mode.${mode}`)}
                      </button>
                    ))}
                  </div>
                )}
                <hr role="separator" />
                {item(
                  null,
                  <Square size={15} />,
                  t('studio.pane.terminate'),
                  v6.onTerminate,
                  unsupported,
                  true,
                )}
              </>
            ) : (
              <>
                {item('refresh', <RefreshCw size={15} />, t('terminalStudio.menu.refresh'), () =>
                  onAction({ type: 'refresh' }),
                )}
                {(!v6 || tokens) && (
                  <div className="pm-tokens" title={t('terminalStudio.menu.tokensHint')}>
                    <span className="pm-tokens-label">{t('terminalStudio.menu.tokens')}</span>
                    <span className="pm-tokens-values">
                      <span title={t('terminalStudio.menu.total')}>{format(tokens?.total)}</span>
                      <span title={t('terminalStudio.menu.input')}>↑ {format(tokens?.input)}</span>
                      <span title={t('terminalStudio.menu.output')}>
                        ↓ {format(tokens?.output)}
                      </span>
                      <span title={t('terminalStudio.menu.cached')}>
                        ⟲ {format(tokens?.cached)}
                      </span>
                    </span>
                  </div>
                )}
                {item(
                  'copy-conversation',
                  <Copy size={15} />,
                  t('terminalStudio.menu.copyConversation'),
                  () => onAction({ type: 'copy-conversation', withTools: false }),
                )}
                {item(
                  'copy-conversation',
                  <CopyPlus size={15} />,
                  t('terminalStudio.menu.copyWithTools'),
                  () => onAction({ type: 'copy-conversation', withTools: true }),
                )}
                <hr />
                {item(null, <Info size={15} />, t('terminalStudio.menu.details'), () =>
                  onAction({ type: 'details' }),
                )}
                {!v6 &&
                  item(
                    null,
                    <Maximize2 size={15} />,
                    maximized ? t('terminalStudio.restore') : t('terminalStudio.menu.expand'),
                    onToggleMaximize,
                  )}
                {!v6 &&
                  item(
                    null,
                    <Pin size={15} />,
                    pinned ? t('terminalStudio.menu.unpin') : t('terminalStudio.menu.pin'),
                    onTogglePin,
                  )}
                {item('detach', <ExternalLink size={15} />, t('terminalStudio.menu.detach'), () =>
                  onAction({ type: 'detach' }),
                )}
                {onFullScreen &&
                  item(
                    null,
                    <Maximize size={15} />,
                    t('terminalStudio.menu.fullScreen'),
                    onFullScreen,
                  )}
                {supported.has('migrate') && <hr />}
                {supported.has('migrate') && (
                  <div className="pm-section">{t('terminalStudio.menu.migrate')}</div>
                )}
                {!supported.has('migrate') ? null : others.length === 0 ? (
                  <div className="pm-empty">{t('terminalStudio.menu.noOtherAccount')}</div>
                ) : (
                  others.map((account) => {
                    const enabled = supported.has('migrate') && account.state !== 'signed_out';
                    return (
                      <div key={account.id} className="pm-account">
                        <span
                          className={`pm-account-state pm-state-${account.state}`}
                          aria-hidden="true"
                        />
                        <span
                          className="pm-account-name"
                          title={t(`terminalStudio.account.${account.state}`)}
                        >
                          {account.label}
                        </span>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!enabled}
                          title={enabled ? t('terminalStudio.menu.moveHint') : unsupported}
                          onClick={run(() =>
                            onAction({ type: 'migrate', accountId: account.id, mode: 'move' }),
                          )}
                        >
                          <MoveRight size={13} />
                          {t('terminalStudio.menu.move')}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!enabled}
                          title={enabled ? t('terminalStudio.menu.duplicateHint') : unsupported}
                          onClick={run(() =>
                            onAction({ type: 'migrate', accountId: account.id, mode: 'duplicate' }),
                          )}
                        >
                          <CopyPlus size={13} />
                          {t('terminalStudio.menu.duplicate')}
                        </button>
                      </div>
                    );
                  })
                )}
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
