import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Lock, LockOpen, RefreshCw, X } from 'lucide-react';
import type { TerminalProvider } from './TerminalStudio';
import './account-limits.css';
import { expiredWindow, level, renewsIn, worstWindow } from './account-limits-model';

export type { AccountLimit, LimitCaps, LimitWindow } from './account-limits-model';
import type { AccountLimit, LimitCaps } from './account-limits-model';

export interface AccountLimitsProps {
  accounts: AccountLimit[];
  /** Which accounts appear in the toolbar summary. */
  shown: string[];
  caps: LimitCaps;
  now: number;
  /** Who reads the numbers, shown as the source label. */
  source: string;
  onRefresh?: (id: string) => void;
  onToggleLock?: (id: string) => void;
  onShownChange: (ids: string[]) => void;
  onCapsChange: (caps: LimitCaps) => void;
  /** Native hosts hide terminal views while the panel covers them. */
  onOpenChange?: (open: boolean) => void;
}

const providerOrder: TerminalProvider[] = ['claude', 'codex', 'opencode', 'antigravity', 'shell'];

function Bar({ percent, caps }: { percent: number; caps: LimitCaps }) {
  return (
    <span className={`al-bar al-${level(percent, caps)}`} aria-hidden="true">
      <span style={{ width: `${percent}%` }} />
    </span>
  );
}

function ProviderMark({ provider }: { provider: TerminalProvider }) {
  return <span className={`al-mark al-mark-${provider}`} aria-hidden="true" />;
}

export function AccountLimits({
  accounts,
  shown,
  caps,
  now,
  source,
  onRefresh,
  onToggleLock,
  onShownChange,
  onCapsChange,
  onOpenChange,
}: AccountLimitsProps) {
  const { t, i18n } = useTranslation();
  const percentFormat = new Intl.NumberFormat(i18n.resolvedLanguage, {
    style: 'percent',
    maximumSignificantDigits: 15,
  });
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const accountsEditor = useRef<HTMLElement>(null);
  const capsEditor = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<'none' | 'accounts' | 'caps'>('none');
  const [draftCaps, setDraftCaps] = useState({ warn: '', critical: '' });
  const openChange = useRef(onOpenChange);
  openChange.current = onOpenChange;
  useEffect(() => {
    if (!open) return;
    openChange.current?.(true);
    return () => openChange.current?.(false);
  }, [open]);

  function close(restoreFocus: boolean) {
    setOpen(false);
    setEditing('none');
    if (restoreFocus) trigger.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = trigger.current;
    const overlay = panel.current;
    if (!anchor || !overlay) return;
    function place() {
      if (!anchor || !overlay) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(380, window.innerWidth - 16);
      const top = Math.min(rect.bottom + 4, Math.max(8, window.innerHeight - 160));
      overlay.style.top = `${top}px`;
      overlay.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
      overlay.style.setProperty('--al-available-height', `${window.innerHeight - top - 8}px`);
    }
    place();
    closeButton.current?.focus({ preventScroll: true });
    const resize = new ResizeObserver(place);
    resize.observe(anchor);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      if (panel.current?.contains(event.target) || trigger.current?.contains(event.target)) return;
      close(panel.current?.contains(document.activeElement) ?? false);
    }
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [open]);

  useLayoutEffect(() => {
    const editor = editing === 'accounts' ? accountsEditor.current : capsEditor.current;
    if (editing !== 'none') editor?.querySelector('input')?.focus();
  }, [editing]);

  const nextCaps = { warn: Number(draftCaps.warn), critical: Number(draftCaps.critical) };
  const canSaveCaps =
    Number.isInteger(nextCaps.warn) &&
    Number.isInteger(nextCaps.critical) &&
    nextCaps.warn >= 1 &&
    nextCaps.warn < nextCaps.critical &&
    nextCaps.critical <= 100;

  const visible = accounts.filter((account) => shown.includes(account.id));
  const hidden = accounts.length - visible.length;
  const groups = providerOrder
    .map((provider) => ({ provider, list: accounts.filter((a) => a.provider === provider) }))
    .filter((group) => group.list.length > 0);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="al-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={t('accountLimits.open')}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        {providerOrder.map((provider) => {
          const list = visible.filter((account) => account.provider === provider);
          if (list.length === 0) return null;
          return (
            <span key={provider} className="al-trigger-group">
              <ProviderMark provider={provider} />
              {list.map((account) => {
                const worst = worstWindow(account, now);
                return (
                  <span key={account.id} className="al-trigger-account">
                    <span className="al-sr-only">{t(`terminalStudio.providers.${provider}`)} </span>
                    <span className="al-index">{account.index}</span>
                    {worst?.usedPercent !== undefined && (
                      <>
                        <Bar percent={worst.usedPercent} caps={caps} />
                        <span className="al-sr-only">
                          {percentFormat.format(worst.usedPercent / 100)}
                        </span>
                      </>
                    )}
                    {worst?.resetsAt !== undefined && (
                      <span className="al-reset">{renewsIn(worst.resetsAt, now)}</span>
                    )}
                  </span>
                );
              })}
            </span>
          );
        })}
        <span className={visible.length ? 'al-sr-only' : undefined}>
          {t('accountLimits.title')}
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            className="al-panel"
            data-native-overlay=""
            role="dialog"
            aria-label={t('accountLimits.title')}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(true);
              }
              if (event.key !== 'Tab') return;
              const buttons = event.currentTarget.querySelectorAll<HTMLElement>(
                'button:enabled, input:enabled',
              );
              const first = buttons[0];
              const last = buttons[buttons.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <header className="al-head">
              <h2>{t('accountLimits.title')}</h2>
              {accounts.length > 0 && <span>{source}</span>}
              <button
                ref={closeButton}
                type="button"
                className="al-icon"
                aria-label={t('close')}
                onClick={() => close(true)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </header>
            <div className="al-body">
              {accounts.length === 0 && <p className="al-unknown">{t('accountLimits.unknown')}</p>}
              {groups.map(({ provider, list }) => (
                <section key={provider} className="al-provider">
                  <h3>
                    <ProviderMark provider={provider} />
                    {t(`terminalStudio.providers.${provider}`)}
                  </h3>
                  {list.map((account) => (
                    <article key={account.id} className="al-account">
                      <div className="al-account-head">
                        <span className="al-index">{account.index}</span>
                        {account.plan && <span className="al-plan">{account.plan}</span>}
                        <span className="al-updated">
                          {account.updatedAt === undefined || account.updatedAt > now
                            ? null
                            : now - account.updatedAt < 60_000
                              ? t('accountLimits.now')
                              : t('accountLimits.ago', {
                                  time: renewsIn(now + (now - account.updatedAt), now),
                                })}
                        </span>
                        {onToggleLock && (
                          <button
                            type="button"
                            className={`al-icon${account.locked ? ' active' : ''}`}
                            aria-pressed={account.locked}
                            title={t(
                              account.locked ? 'accountLimits.unlock' : 'accountLimits.lock',
                            )}
                            aria-label={t(
                              account.locked ? 'accountLimits.unlock' : 'accountLimits.lock',
                            )}
                            onClick={() => onToggleLock(account.id)}
                          >
                            {account.locked ? <Lock size={14} /> : <LockOpen size={14} />}
                          </button>
                        )}
                        {onRefresh && (
                          <button
                            type="button"
                            className="al-icon"
                            title={t('accountLimits.refresh')}
                            aria-label={t('accountLimits.refresh')}
                            onClick={() => onRefresh(account.id)}
                          >
                            <RefreshCw size={14} />
                          </button>
                        )}
                      </div>
                      {account.windows.length === 0 && (
                        <p className="al-unknown">{t('accountLimits.unknown')}</p>
                      )}
                      {account.windows.map((window) => {
                        const expired = expiredWindow(window, now);
                        const percent = expired ? undefined : window.usedPercent;
                        return (
                          <div key={window.id} className="al-window">
                            <span className="al-window-label">{window.label}</span>
                            <span className="al-window-bar">
                              {percent !== undefined && <Bar percent={percent} caps={caps} />}
                              <small>
                                {expired
                                  ? t('accountLimits.awaitingReport')
                                  : percent === undefined
                                    ? t('accountLimits.unknown')
                                    : window.resetsAt === undefined
                                      ? t('accountLimits.renewUnknown')
                                      : t('accountLimits.renews', {
                                          time: renewsIn(window.resetsAt, now),
                                        })}
                              </small>
                            </span>
                            {percent !== undefined && (
                              <span className={`al-percent al-${level(percent, caps)}`}>
                                {percentFormat.format(percent / 100)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </article>
                  ))}
                </section>
              ))}
              {editing === 'accounts' && (
                <section
                  ref={accountsEditor}
                  className="al-editor"
                  aria-label={t('accountLimits.choose')}
                >
                  <h3>{t('accountLimits.chooseHelp')}</h3>
                  {accounts.map((account) => (
                    <label key={account.id}>
                      <input
                        type="checkbox"
                        checked={shown.includes(account.id)}
                        onChange={(event) =>
                          onShownChange(
                            event.target.checked
                              ? [...new Set([...shown, account.id])]
                              : shown.filter((id) => id !== account.id),
                          )
                        }
                      />
                      <ProviderMark provider={account.provider} />
                      {t(`terminalStudio.providers.${account.provider}`)} {account.index}
                      {account.plan && <span className="al-plan">{account.plan}</span>}
                    </label>
                  ))}
                </section>
              )}
              {editing === 'caps' && (
                <form
                  ref={capsEditor}
                  className="al-editor"
                  aria-label={t('accountLimits.caps')}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!canSaveCaps) return;
                    onCapsChange(nextCaps);
                    setEditing('none');
                    panel.current?.querySelector<HTMLButtonElement>('.al-edit-caps')?.focus();
                  }}
                >
                  <h3>{t('accountLimits.capsHelp')}</h3>
                  {(['warn', 'critical'] as const).map((key) => (
                    <label key={key} className="al-cap">
                      <span className={`al-swatch al-${key}`} aria-hidden="true" />
                      {t(`accountLimits.${key}`)}
                      <input
                        type="number"
                        min={key === 'warn' ? 1 : nextCaps.warn + 1}
                        max={key === 'warn' ? nextCaps.critical - 1 : 100}
                        required
                        value={draftCaps[key]}
                        onChange={(event) =>
                          setDraftCaps({ ...draftCaps, [key]: event.target.value })
                        }
                      />
                      <span aria-hidden="true">%</span>
                    </label>
                  ))}
                  <button type="submit" disabled={!canSaveCaps}>
                    {t('save')}
                  </button>
                </form>
              )}
            </div>
            <footer className="al-foot">
              <span>{hidden > 0 ? t('accountLimits.hidden', { count: hidden }) : ''}</span>
              <button
                type="button"
                disabled={accounts.length === 0}
                aria-expanded={editing === 'accounts'}
                onClick={() => setEditing((value) => (value === 'accounts' ? 'none' : 'accounts'))}
              >
                {t('accountLimits.choose')}
              </button>
              <button
                type="button"
                className="al-edit-caps"
                aria-expanded={editing === 'caps'}
                onClick={() => {
                  setDraftCaps({ warn: String(caps.warn), critical: String(caps.critical) });
                  setEditing(editing === 'caps' ? 'none' : 'caps');
                }}
              >
                {t('accountLimits.caps')}
              </button>
            </footer>
          </div>,
          document.body,
        )}
    </>
  );
}
