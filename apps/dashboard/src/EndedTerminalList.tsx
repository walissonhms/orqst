import { useTranslation } from 'react-i18next';
import type { EndedTerminal } from './terminal-lifecycle.js';
import './pane-lifecycle.css';

interface Props {
  terminals: readonly EndedTerminal[];
  onReopen?: (terminal: EndedTerminal) => void;
  onRemove?: (terminal: EndedTerminal) => void;
  onInspect: (terminal: EndedTerminal) => void;
  onHide?: (terminal: EndedTerminal) => void;
}

/** The caller supplies Core-backed recovery actions. The list grants no authority itself. */
export function EndedTerminalList({ terminals, onReopen, onRemove, onInspect, onHide }: Props) {
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
            <span>
              {terminal.disposition === 'uncertain' ? (
                <button type="button" onClick={() => onInspect(terminal)}>
                  {t('paneLifecycle.inspect')}
                </button>
              ) : (
                <>
                  {onReopen && (
                    <button type="button" onClick={() => onReopen(terminal)}>
                      {t('paneLifecycle.reopen')}
                    </button>
                  )}
                  {onRemove && (
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
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
