import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, X } from 'lucide-react';
import { Modal } from './Modal';
import type { StudioTerminal } from './TerminalStudio';

/** Read-only facts about one terminal; unknown values stay `—`. */
export function TerminalDetails({
  terminal,
  onClose,
}: {
  terminal: StudioTerminal;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const dash = '—';
  const rows: [string, string][] = [
    [t('terminalStudio.details.label'), terminal.label],
    [t('terminalStudio.details.name'), terminal.name],
    [t('terminalStudio.details.cli'), t(`terminalStudio.providers.${terminal.provider}`)],
    [
      t('terminalStudio.details.model'),
      terminal.model === undefined
        ? dash
        : terminal.model === null
          ? t('terminalStudio.defaultModel')
          : terminal.model,
    ],
    [t('terminalStudio.details.account'), terminal.account?.label ?? dash],
    [t('terminalStudio.details.workspace'), terminal.workspace.name],
    [t('terminalStudio.details.status'), t(`terminalStudio.status.${terminal.status}`)],
    [
      t('terminalStudio.details.started'),
      terminal.startedAt ? new Date(terminal.startedAt).toLocaleString() : dash,
    ],
    [
      t('terminalStudio.details.role'),
      terminal.orchestrator ? t('terminalStudio.orchestrator') : dash,
    ],
  ];
  return (
    <Modal label={t('terminalStudio.details.title')} className="ntd td" onClose={onClose}>
      <div className="td-body">
        <header className="ntd-head">
          <div>
            <h2>
              <span className="ts-label">{terminal.label}</span> {terminal.name}
            </h2>
            <p>{t('terminalStudio.details.subtitle')}</p>
          </div>
          <button
            type="button"
            className="ntd-icon"
            onClick={onClose}
            aria-label={t('terminalStudio.mention.close')}
          >
            <X size={16} />
          </button>
        </header>
        <dl className="td-list">
          {rows.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          <div>
            <dt>{t('terminalStudio.details.uuid')}</dt>
            <dd className="td-uuid">
              <code>{terminal.uuid ?? dash}</code>
              {terminal.uuid && (
                <button
                  type="button"
                  aria-label={t('terminalStudio.details.copyUuid')}
                  onClick={() => {
                    void navigator.clipboard?.writeText(terminal.uuid!).then(() => setCopied(true));
                  }}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </Modal>
  );
}
