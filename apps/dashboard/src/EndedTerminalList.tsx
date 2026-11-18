import { useTranslation } from 'react-i18next';
import type { EndedTerminal } from './terminal-lifecycle.js';
import './pane-lifecycle.css';

interface Props {
  terminals: readonly EndedTerminal[];
  now?: number;
  onReopen?: (terminal: EndedTerminal) => void;
  onRemove?: (terminal: EndedTerminal) => void;
  onHide?: (terminal: EndedTerminal) => void;
}

/** The caller supplies Core-backed recovery actions. The list grants no authority itself. */
export function EndedTerminalList({
  terminals,
  now = Date.now(),
  onReopen,
  onRemove,
  onHide,
}: Props) {
  const { t, i18n } = useTranslation();
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
    <details className="pane-lifecycle-ended">
      <summary>{t('paneLifecycle.endedList', { count: terminals.length })}</summary>
      <ul>
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
                  <details className="pane-lifecycle-recovery">
                    <summary>{t('paneLifecycle.inspect')}</summary>
                    <p>{t('paneLifecycle.recoveryIntro')}</p>
                    <ol>
                      <li>{t('paneLifecycle.recoveryQuit')}</li>
                      <li>{t('paneLifecycle.recoveryStart')}</li>
                      <li>{t('paneLifecycle.recoveryVerify')}</li>
                    </ol>
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
    </details>
  );
}
