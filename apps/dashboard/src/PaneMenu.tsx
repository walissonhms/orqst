import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Copy,
  CopyPlus,
  ExternalLink,
  Info,
  Maximize,
  Maximize2,
  MoreHorizontal,
  MoveRight,
  Pin,
  RefreshCw,
} from 'lucide-react';
import type { StudioTerminal } from './TerminalStudio';

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
  terminal: StudioTerminal;
  accounts: AccountOption[];
  supported: ReadonlySet<PaneActionType>;
  maximized: boolean;
  pinned: boolean;
  onAction: (action: PaneAction) => void;
  onToggleMaximize: () => void;
  onTogglePin: () => void;
  onFullScreen: () => void;
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
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const openChange = useRef(onOpenChange);
  openChange.current = onOpenChange;
  useEffect(() => openChange.current?.(open), [open]);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const width = 340;
    const height = menu.current?.offsetHeight ?? 420;
    setPosition({
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top:
        rect.bottom + 6 + height > window.innerHeight
          ? Math.max(8, rect.top - height - 6)
          : rect.bottom + 6,
    });
  }, [open]);

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
    action: () => void,
  ) => {
    const enabled = type === null || supported.has(type);
    return (
      <button
        type="button"
        role="menuitem"
        className="pm-item"
        disabled={!enabled}
        title={enabled ? undefined : unsupported}
        onClick={run(action)}
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
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={15} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="pm-menu"
            role="menu"
            aria-label={t('terminalStudio.menu.title', { label: terminal.label })}
            style={{ top: position.top, left: position.left }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setOpen(false);
                button.current?.focus();
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const items = [
                  ...(menu.current?.querySelectorAll<HTMLElement>(
                    '[role="menuitem"]:not([disabled])',
                  ) ?? []),
                ];
                const index = items.indexOf(document.activeElement as HTMLElement);
                const next =
                  items[
                    (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                  ];
                next?.focus();
              }
            }}
          >
            {item('refresh', <RefreshCw size={15} />, t('terminalStudio.menu.refresh'), () =>
              onAction({ type: 'refresh' }),
            )}
            <div className="pm-tokens" title={t('terminalStudio.menu.tokensHint')}>
              <span className="pm-tokens-label">{t('terminalStudio.menu.tokens')}</span>
              <span className="pm-tokens-values">
                <span title={t('terminalStudio.menu.total')}>{format(tokens?.total)}</span>
                <span title={t('terminalStudio.menu.input')}>↑ {format(tokens?.input)}</span>
                <span title={t('terminalStudio.menu.output')}>↓ {format(tokens?.output)}</span>
                <span title={t('terminalStudio.menu.cached')}>⟲ {format(tokens?.cached)}</span>
              </span>
            </div>
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
            {item(
              null,
              <Maximize2 size={15} />,
              maximized ? t('terminalStudio.restore') : t('terminalStudio.menu.expand'),
              onToggleMaximize,
            )}
            {item(
              null,
              <Pin size={15} />,
              pinned ? t('terminalStudio.menu.unpin') : t('terminalStudio.menu.pin'),
              onTogglePin,
            )}
            {item('detach', <ExternalLink size={15} />, t('terminalStudio.menu.detach'), () =>
              onAction({ type: 'detach' }),
            )}
            {item(null, <Maximize size={15} />, t('terminalStudio.menu.fullScreen'), onFullScreen)}
            <hr />
            <div className="pm-section">{t('terminalStudio.menu.migrate')}</div>
            {others.length === 0 ? (
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
          </div>,
          document.body,
        )}
    </>
  );
}
