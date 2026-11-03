import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, X } from 'lucide-react';
import type { Snapshot } from '@orqst/protocol';
import { Modal } from './Modal';
import type { AppView } from './shell-preferences';

/** Read-only orientation from the existing snapshot, never an installation or readiness test. */
export function ObservationGuide({
  snapshot,
  connection,
  snapshotError,
  onNavigate,
  onClose,
}: {
  snapshot?: Snapshot;
  connection: 'connecting' | 'connected' | 'offline';
  snapshotError: boolean;
  onNavigate: (view: AppView) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en-US';
  const current = connection === 'connected' && !snapshotError;
  const diagnostics = snapshot?.diagnostics;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  function containTab(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:enabled')];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const heading = event.currentTarget.querySelector('.guide-heading');
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === heading)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  function visit(view: AppView) {
    // Release the modal before the existing navigation/draft guard takes focus.
    onClose();
    onNavigate(view);
  }
  return (
    <Modal
      label={t('observationGuide.title')}
      className="observation-guide panel shell-dialog"
      initialFocus=".guide-heading"
      onClose={onClose}
    >
      <div onKeyDown={containTab}>
        <div className="panel-heading">
          <h2 className="guide-heading" tabIndex={-1}>
            <BookOpen size={18} /> {t('observationGuide.title')}
          </h2>
          <button className="icon-button" aria-label={t('close')} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="observation-guide-body">
          <p>{t('observationGuide.intro')}</p>
          <ol className="observation-guide-steps">
            <li>
              <section aria-labelledby="guide-connection">
                <h3 id="guide-connection">{t('observationGuide.connection')}</h3>
                <p role="status">
                  {t(`observationGuide.${snapshotError ? 'snapshotError' : connection}`)}
                </p>
                <p className="fine-print">{t('observationGuide.connectionHelp')}</p>
              </section>
            </li>
            <li>
              <section aria-labelledby="guide-sources">
                <h3 id="guide-sources">{t('observationGuide.sources')}</h3>
                {!current && snapshot && <p className="notice">{t('observationGuide.stale')}</p>}
                {diagnostics ? (
                  <>
                    <p>
                      {t(
                        diagnostics.scanning
                          ? 'observationGuide.scanning'
                          : 'observationGuide.notScanning',
                      )}
                    </p>
                    <dl className="observation-guide-facts">
                      <div>
                        <dt>{t('observationGuide.lastScan')}</dt>
                        <dd>
                          {diagnostics.lastScan ? (
                            <time dateTime={diagnostics.lastScan}>
                              {new Intl.DateTimeFormat(locale, {
                                dateStyle: 'medium',
                                timeStyle: 'medium',
                              }).format(new Date(diagnostics.lastScan))}
                            </time>
                          ) : (
                            t('observationGuide.noScan')
                          )}
                        </dd>
                      </div>
                      {(['files', 'malformed', 'oversized', 'skipped', 'errors'] as const).map(
                        (key) => (
                          <div key={key}>
                            <dt>{t(`observationGuide.${key}`)}</dt>
                            <dd>{number(diagnostics[key])}</dd>
                          </div>
                        ),
                      )}
                    </dl>
                    <p className="fine-print">{t('observationGuide.counterHelp')}</p>
                  </>
                ) : (
                  <p>{t('observationGuide.noDiagnostics')}</p>
                )}
                <p>{t('observationGuide.sourceHelp')}</p>
                <p className="fine-print">
                  {t('observationGuide.pathHelp')} <code>ORQST_CODEX_SESSIONS</code>.
                </p>
                <button className="button" disabled={!snapshot} onClick={() => visit('agents')}>
                  {t('observationGuide.viewAdapters')}
                </button>
              </section>
            </li>
            <li>
              <section aria-labelledby="guide-history">
                <h3 id="guide-history">{t('observationGuide.history')}</h3>
                <p>
                  {snapshot
                    ? t('observationGuide.sessionCount', { count: snapshot.sessions.length })
                    : t('observationGuide.noHistory')}
                </p>
                <p className="fine-print">{t('observationGuide.historyHelp')}</p>
                {snapshot && snapshot.sessions.length === 0 && (
                  <p>{t('observationGuide.emptyHistory')}</p>
                )}
                <button className="button" disabled={!snapshot} onClick={() => visit('workspaces')}>
                  {t('observationGuide.viewWorkspaces')}
                </button>
              </section>
            </li>
          </ol>
          <p className="fine-print">{t('observationGuide.privacy')}</p>
          <button className="button" onClick={onClose}>
            {t('observationGuide.dismiss')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
