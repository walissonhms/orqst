import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import type { AdapterCapabilities, Snapshot } from '@orqst/protocol';

const capabilities: (keyof AdapterCapabilities)[] = [
  'sessionDiscovery',
  'realtimeEvents',
  'messages',
  'toolCalls',
  'subagents',
  'tokenUsage',
  'taskResults',
  'userIntervention',
  'remoteControl',
];
export function Agents({ snapshot }: { snapshot: Snapshot }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.resolvedLanguage ?? 'en-US');
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{t('readOnly')}</span>
          <h1>{t('shell.views.agents')}</h1>
          <p>{t('shell.agents.description')}</p>
        </div>
        <ShieldCheck size={30} />
      </div>
      <section className="panel adapter-panel" aria-label={t('shell.agents.matrix')}>
        <div className="panel-heading">
          <h2>{t('shell.agents.matrix')}</h2>
        </div>
        <p className="fine-print adapter-intro">{t('shell.agents.discoveryNote')}</p>
        <div
          className="table-scroll"
          tabIndex={0}
          role="group"
          aria-label={t('shell.agents.matrix')}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">{t('shell.agents.capability')}</th>
                {snapshot.adapters.map((adapter) => (
                  <th scope="col" key={adapter.id}>
                    {t(`shell.adapters.${adapter.id}`, { defaultValue: adapter.id })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{t('shell.agents.mode')}</th>
                {snapshot.adapters.map((adapter) => (
                  <td key={adapter.id}>{t(adapter.implemented ? 'readOnly' : 'planned')}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">{t('sessions')}</th>
                {snapshot.adapters.map((adapter) => (
                  <td className="mono" key={adapter.id}>
                    {number.format(
                      snapshot.sessions.filter((session) => session.adapter === adapter.id).length,
                    )}
                  </td>
                ))}
              </tr>
              {capabilities.map((capability) => (
                <tr key={capability}>
                  <th scope="row">{t(`shell.capabilities.${capability}`)}</th>
                  {snapshot.adapters.map((adapter) => (
                    <td key={adapter.id}>
                      <span
                        className={
                          adapter.implemented && adapter.capabilities[capability]
                            ? 'capability-available'
                            : 'muted'
                        }
                      >
                        {t(
                          adapter.implemented && adapter.capabilities[capability]
                            ? 'shell.agents.supported'
                            : 'shell.agents.unavailable',
                        )}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="panel-footer">{t('shell.agents.limits')}</p>
      </section>
      <section className="panel adapter-evidence" aria-label={t('shell.agents.evidence')}>
        <div className="panel-heading">
          <h2>{t('shell.agents.evidence')}</h2>
        </div>
        {snapshot.adapters.map((adapter) => (
          <details key={adapter.id}>
            <summary>{t(`shell.adapters.${adapter.id}`, { defaultValue: adapter.id })}</summary>
            <p>{adapter.evidence}</p>
          </details>
        ))}
        <p className="fine-print">{t('shell.agents.evidenceNote')}</p>
      </section>
    </>
  );
}
