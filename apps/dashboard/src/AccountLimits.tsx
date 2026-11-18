import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Lock, LockOpen, RefreshCw, X } from 'lucide-react';
import type { TerminalProvider } from './TerminalStudio';
import './account-limits.css';
import { expiredWindow, level, providerWindow, renewsIn } from './account-limits-model';

export type { AccountLimit, LimitCaps, LimitWindow } from './account-limits-model';
import type { AccountLimit, LimitCaps } from './account-limits-model';

export interface AccountLimitsProps {
  accounts: AccountLimit[];
  /** Which accounts appear in the toolbar summary. */
  shown: string[];
  caps: LimitCaps;
  now: number;
  /** Label for the synthetic preview. Production uses the provider report time. */
  source?: string;
  onRefresh?: (id: string) => void;
  canRefresh?: (id: string) => boolean;
  onToggleLock?: (id: string) => void;
  onShownChange?: (ids: string[]) => void;
  onCapsChange?: (caps: LimitCaps) => void;
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

export function LimitsChip({
  accounts,
  shown,
  caps,
  now,
  source,
  onRefresh,
  canRefresh,
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
  function formatUsage(percent: number) {
    return percent === 0 ? t('accountLimits.unused') : percentFormat.format(percent / 100);
  }
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

  const latestReport = accounts.reduce<number | undefined>(
    (latest, { updatedAt }) =>
      updatedAt !== undefined && updatedAt <= now && (latest === undefined || updatedAt > latest)
        ? updatedAt
        : latest,
    undefined,
  );
  const reportAge =
    latestReport === undefined
      ? undefined
      : now - latestReport < 60_000
        ? t('accountLimits.now')
        : t('accountLimits.ago', { time: renewsIn(now + (now - latestReport), now) });
  const accountLabel = (account: AccountLimit) =>
    account.label ?? t('accountLimits.account', { index: account.index });
  const unknown = t('accountLimits.unknown');
  const unknownDetail = t('accountLimits.unknownDetail');
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
          if (!list.length) return null;
          const window = providerWindow(list, now);
          return (
            <span key={provider} className="al-trigger-group">
              <ProviderMark provider={provider} />
              <span>{t(`terminalStudio.providers.${provider}`)}</span>
              <span className={`al-percent al-${level(window?.usedPercent, caps)}`}>
                {window?.usedPercent === undefined ? '—' : formatUsage(window.usedPercent)}
              </span>
              {window && <span className="al-reset">· {window.label}</span>}
            </span>
          );
        })}
        {!visible.length && (
          <>
            <span className="al-sr-only">{t('accountLimits.title')} </span>
            <span aria-hidden="true">—</span>
            <span className="al-sr-only">{t('accountLimits.unknown')}</span>
          </>
        )}
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
              {source ? (
                <span>{source}</span>
              ) : latestReport !== undefined && reportAge !== undefined ? (
                <time dateTime={new Date(latestReport).toISOString()}>
                  {t('accountLimits.lastReport', { time: reportAge })}
                </time>
              ) : null}
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
              {accounts.length === 0 && (
                <p className="al-unknown" title={unknownDetail}>
                  {unknown}
                </p>
              )}
              {groups.map(({ provider, list }) => (
                <section key={provider} className="al-provider">
                  <h3>
                    <ProviderMark provider={provider} />
                    {t(`terminalStudio.providers.${provider}`)}
                  </h3>
                  {list.map((account) => (
                    <article key={account.id} className="al-account">
                      <div className="al-account-head">
                        <span className="al-account-name">{accountLabel(account)}</span>
                        {account.plan && <span className="al-plan">{account.plan}</span>}
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
                        {onRefresh && (canRefresh?.(account.id) ?? true) && (
                          <button
                            type="button"
                            className="al-icon"
                            title={t('accountLimits.refresh')}
                            aria-label={t('accountLimits.refresh')}
                            onClick={() => onRefresh(account.id)}
                          >
                            <RefreshCw size={14} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                      {account.windows.length === 0 && (
                        <p className="al-unknown" title={unknownDetail}>
                          {unknown}
                        </p>
                      )}
                      {account.windows.map((window) => {
                        const expired = expiredWindow(window, now);
                        const percent = expired ? undefined : window.usedPercent;
                        return (
                          <div key={window.id} className="al-window">
                            <span className="al-window-label">{window.label}</span>
                            <span className="al-window-bar">
                              {percent !== undefined && <Bar percent={percent} caps={caps} />}
                              <small
                                title={
                                  !expired && percent === undefined ? unknownDetail : undefined
                                }
                              >
                                {expired
                                  ? t('accountLimits.awaitingReport')
                                  : percent === undefined
                                    ? unknown
                                    : window.resetsAt === undefined
                                      ? t('accountLimits.renewUnknown')
                                      : t('accountLimits.renews', {
                                          time: renewsIn(window.resetsAt, now),
                                        })}
                              </small>
                            </span>
                            {percent !== undefined && (
                              <span className={`al-percent al-${level(percent, caps)}`}>
                                {formatUsage(percent)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </article>
                  ))}
                </section>
              ))}
              {editing === 'accounts' && onShownChange && (
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
                      {t(`terminalStudio.providers.${account.provider}`)} · {accountLabel(account)}
                      {account.plan && <span className="al-plan">{account.plan}</span>}
                    </label>
                  ))}
                </section>
              )}
              {editing === 'caps' && onCapsChange && (
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
            {(onShownChange || onCapsChange) && (
              <footer className="al-foot">
                <span>{hidden > 0 ? t('accountLimits.hidden', { count: hidden }) : ''}</span>
                {onShownChange && (
                  <button
                    type="button"
                    disabled={accounts.length === 0}
                    aria-expanded={editing === 'accounts'}
                    onClick={() =>
                      setEditing((value) => (value === 'accounts' ? 'none' : 'accounts'))
                    }
                  >
                    {t('accountLimits.choose')}
                  </button>
                )}
                {onCapsChange && (
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
                )}
              </footer>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

export { LimitsChip as AccountLimits };
