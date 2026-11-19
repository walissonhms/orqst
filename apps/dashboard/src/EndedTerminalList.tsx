import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EndedTerminal } from './terminal-lifecycle.js';
import './pane-lifecycle.css';

interface Props {
  terminals: readonly EndedTerminal[];
  target?: { terminalId: string };
  now?: number;
  onReopen?: (terminal: EndedTerminal) => void;
  onRemove?: (terminal: EndedTerminal) => void;
  onHide?: (terminal: EndedTerminal) => void;
}

/** The caller supplies Core-backed recovery actions. The list grants no authority itself. */
export function EndedTerminalList({
  terminals,
  target,
  now = Date.now(),
  onReopen,
  onRemove,
  onHide,
}: Props) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const targetDetails = useRef<HTMLDetailsElement>(null);
  const targetPresent = terminals.some(({ terminalId }) => terminalId === target?.terminalId);
  useEffect(() => {
    if (!target || !targetPresent) return;
    const details = targetDetails.current;
    if (!details) return;
    setExpanded(true);
    details.open = true;
  }, [target, targetPresent]);
  useEffect(() => {
    if (expanded && targetDetails.current?.open)
      targetDetails.current.querySelector('summary')?.focus();
  }, [expanded, target]);
  if (!terminals.length) return null;
  const relative = new Intl.RelativeTimeFormat(i18n.resolvedLanguage, {
    numeric: 'auto',
    style: 'short',
  });
  function endedAt(exitedAt: number | undefined) {
    if (exitedAt === undefined) return t('paneLifecycle.state.ended');
    const minutes = Math.floor(Math.max(0, now - exitedAt) / 60_000);
    const time =
      minutes >= 1440
        ? relative.format(-Math.floor(minutes / 1440), 'day')
        : minutes >= 60
          ? relative.format(-Math.floor(minutes / 60), 'hour')
          : relative.format(-minutes, 'minute');
    return t('paneLifecycle.endedAt', { time });
  }
  return (
    <section className="pane-lifecycle-ended">
      <button
        type="button"
        className="pane-lifecycle-ended-toggle"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-label={t('paneLifecycle.endedList', { count: terminals.length })}
        title={t('paneLifecycle.endedList', { count: terminals.length })}
        onClick={() => setExpanded((value) => !value)}
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>{' '}
        {t('paneLifecycle.endedList', { count: terminals.length })}
      </button>
      <ul id={listId} hidden={!expanded}>
        {terminals.map((terminal) => {
          const provider = terminal.provider && t(`terminalStudio.providers.${terminal.provider}`);
          const name =
            terminal.name?.toLocaleLowerCase() === provider?.toLocaleLowerCase() ||
            terminal.name === terminal.displayId
              ? undefined
              : terminal.name;
          const status =
            terminal.disposition === 'uncertain'
              ? t('paneLifecycle.ownershipUncertain')
              : endedAt(terminal.exitedAt);
          return (
            <li key={terminal.terminalId}>
              <span>
                <code title={terminal.terminalId}>
                  {terminal.displayId ?? terminal.terminalId.slice(0, 8)}
                </code>
                {name && <strong>{name}</strong>}
                {provider && (
                  <span>
                    {name && '· '}
                    {provider}
                  </span>
                )}
                <span>
                  {(name || provider) && <span aria-hidden="true">· </span>}
                  {status}
                </span>
              </span>
              <div className="pane-lifecycle-ended-actions">
                {!terminal.released ? (
                  <details
                    className="pane-lifecycle-recovery"
                    ref={target?.terminalId === terminal.terminalId ? targetDetails : undefined}
                  >
                    <summary>{t('paneLifecycle.inspect')}</summary>
                    <p>
                      {t(
                        terminal.activeReservation
                          ? 'paneLifecycle.reservationProofUnavailable'
                          : 'paneLifecycle.recoveryIntro',
                      )}
                    </p>
                    <code>{terminal.terminalId}</code>
                  </details>
                ) : (
                  <>
                    {onReopen && terminal.released && (
                      <button className="button" type="button" onClick={() => onReopen(terminal)}>
                        {t('paneLifecycle.reopen')}
                      </button>
                    )}
                    {onRemove && terminal.released && (
                      <button className="button" type="button" onClick={() => onRemove(terminal)}>
                        {t('paneLifecycle.remove')}
                      </button>
                    )}
                  </>
                )}
                {onHide && (
                  <button className="button" type="button" onClick={() => onHide(terminal)}>
                    {t('features.savedTerminals.hide')}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
