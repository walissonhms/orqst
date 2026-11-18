import { useTranslation } from 'react-i18next';
import type { EndedTerminal } from './terminal-lifecycle.js';
import './pane-lifecycle.css';

interface Props {
  terminals: readonly EndedTerminal[];
  onReopen?: (terminal: EndedTerminal) => void;
  onRemove?: (terminal: EndedTerminal) => void;
  onHide?: (terminal: EndedTerminal) => void;
}

/** The caller supplies Core-backed recovery actions. The list grants no authority itself. */
export function EndedTerminalList({ terminals, onReopen, onRemove, onHide }: Props) {
  const { t, i18n } = useTranslation();
  if (!terminals.length) return null;
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  return (
    <details className="pane-lifecycle-ended">
      <summary>{t('paneLifecycle.endedList', { count: terminals.length })}</summary>
      <ul>
        {terminals.map((terminal) => (
          <li key={terminal.terminalId}>
            <span>
              <code title={terminal.terminalId}>
                {terminal.displayId ?? terminal.terminalId.slice(0, 8)}
              </code>
              {terminal.name && <strong>{terminal.name}</strong>}
              {terminal.provider && t(`terminalStudio.providers.${terminal.provider}`)}
              <span>
                {terminal.disposition === 'uncertain'
                  ? t('paneLifecycle.ownershipUncertain')
                  : terminal.exitedAt === undefined
                    ? t('paneLifecycle.state.ended')
                    : date.format(terminal.exitedAt)}
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
                    <button type="button" onClick={() => onReopen(terminal)}>
                      {t('paneLifecycle.reopen')}
                    </button>
                  )}
                  {onRemove && terminal.released && (
                    <button type="button" onClick={() => onRemove(terminal)}>
                      {t('paneLifecycle.remove')}
                    </button>
                  )}
                </>
              )}
              {onHide && (
                <button type="button" onClick={() => onHide(terminal)}>
                  {t('features.savedTerminals.hide')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
