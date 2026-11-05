import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Lock, LockOpen, RefreshCw } from 'lucide-react';
import type { TerminalProvider } from './TerminalStudio';
import './account-limits.css';
import { level, renewsIn, worstWindow } from './account-limits-model';

export type { AccountLimit, LimitCaps, LimitWindow } from './account-limits-model';
import type { AccountLimit, LimitCaps } from './account-limits-model';

interface Props {
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

const providerOrder: TerminalProvider[] = ['claude', 'codex', 'opencode', 'shell'];

function short(resetsAt: number | undefined, now: number): string {
  const full = renewsIn(resetsAt, now);
  const match = /^(\d+[dhm])/.exec(full);
  return match ? match[1]! : full;
}

function Bar({ percent, caps }: { percent?: number; caps: LimitCaps }) {
  return (
    <span className={`al-bar al-${level(percent, caps)}`} aria-hidden="true">
      <span style={{ width: `${Math.max(2, Math.min(100, percent ?? 0))}%` }} />
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
}: Props) {
  const { t } = useTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<'none' | 'accounts' | 'caps'>('none');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const openChange = useRef(onOpenChange);
  openChange.current = onOpenChange;
  useEffect(() => openChange.current?.(open), [open]);

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = 380;
    setPosition({
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (panel.current?.contains(event.target as Node)) return;
      if (trigger.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);

  const visible = accounts.filter((account) => shown.includes(account.id));
  const hidden = accounts.length - visible.length;
  const groups = providerOrder
    .map((provider) => ({ provider, list: accounts.filter((a) => a.provider === provider) }))
    .filter((group) => group.list.length > 0);

  if (accounts.length === 0) return null;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="al-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('accountLimits.open')}
        onClick={() => setOpen((value) => !value)}
      >
        {providerOrder.map((provider) => {
          const list = visible.filter((account) => account.provider === provider);
          if (list.length === 0) return null;
          return (
            <span key={provider} className="al-trigger-group">
              <ProviderMark provider={provider} />
              {list.map((account) => {
                const worst = worstWindow(account);
                return (
                  <span key={account.id} className="al-trigger-account">
                    <span className="al-index">{account.index}</span>
                    <Bar percent={worst?.usedPercent} caps={caps} />
                    <span className="al-reset">{short(worst?.resetsAt, now)}</span>
                  </span>
                );
              })}
            </span>
          );
        })}
        {visible.length === 0 && <span>{t('accountLimits.title')}</span>}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="al-panel"
            role="dialog"
            aria-label={t('accountLimits.title')}
            style={{ top: position.top, left: position.left }}
          >
            <header className="al-head">
              <h2>{t('accountLimits.title')}</h2>
              <span>{source}</span>
            </header>
            <div className="al-body">
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
                          {account.updatedAt === undefined
                            ? '—'
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
                      {account.windows.map((window) => (
                        <div key={window.id} className="al-window">
                          <span className="al-window-label">{window.label}</span>
                          <span className="al-window-bar">
                            <Bar percent={window.usedPercent} caps={caps} />
                            <small>
                              {window.resetsAt === undefined
                                ? t('accountLimits.renewUnknown')
                                : t('accountLimits.renews', {
                                    time: renewsIn(window.resetsAt, now),
                                  })}
                            </small>
                          </span>
                          <span className={`al-percent al-${level(window.usedPercent, caps)}`}>
                            {window.usedPercent === undefined
                              ? '—'
                              : `${Math.round(window.usedPercent)}%`}
                          </span>
                        </div>
                      ))}
                    </article>
                  ))}
                </section>
              ))}
              {editing === 'accounts' && (
                <section className="al-editor" aria-label={t('accountLimits.choose')}>
                  <h3>{t('accountLimits.chooseHelp')}</h3>
                  {accounts.map((account) => (
                    <label key={account.id}>
                      <input
                        type="checkbox"
                        checked={shown.includes(account.id)}
                        onChange={(event) =>
                          onShownChange(
                            event.target.checked
                              ? [...shown, account.id]
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
                <section className="al-editor" aria-label={t('accountLimits.caps')}>
                  <h3>{t('accountLimits.capsHelp')}</h3>
                  {(['warn', 'critical'] as const).map((key) => (
                    <label key={key} className="al-cap">
                      <span className={`al-swatch al-${key}`} aria-hidden="true" />
                      {t(`accountLimits.${key}`)}
                      <input
                        type="number"
                        min={key === 'warn' ? 1 : caps.warn + 1}
                        max={key === 'warn' ? caps.critical - 1 : 100}
                        value={caps[key]}
                        onChange={(event) => {
                          const value = Math.round(Number(event.target.value));
                          if (!Number.isFinite(value)) return;
                          const next = { ...caps, [key]: value };
                          if (next.warn >= 1 && next.warn < next.critical && next.critical <= 100)
                            onCapsChange(next);
                        }}
                      />
                      %
                    </label>
                  ))}
                </section>
              )}
            </div>
            <footer className="al-foot">
              <span>{hidden > 0 ? t('accountLimits.hidden', { count: hidden }) : ''}</span>
              <button
                type="button"
                aria-pressed={editing === 'accounts'}
                onClick={() => setEditing((value) => (value === 'accounts' ? 'none' : 'accounts'))}
              >
                {t('accountLimits.choose')}
              </button>
              <button
                type="button"
                aria-pressed={editing === 'caps'}
                onClick={() => setEditing((value) => (value === 'caps' ? 'none' : 'caps'))}
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
