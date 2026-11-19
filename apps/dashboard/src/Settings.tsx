import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import type { Snapshot } from '@orqst/protocol';
import { Agents, type CatalogScope } from './Agents';
import type { LimitCaps } from './account-limits-model';
import './spec-screens.css';
import { Modal } from './Modal';
import {
  defaultAppearancePreferences,
  readingSize,
  type AppearancePreferences,
} from './appearance-preferences';
import './account-limits.css';
import dashboardPackage from '../package.json';

export interface SettingsProps {
  appearance: AppearancePreferences;
  onAppearance: (value: AppearancePreferences) => void;
  storageUnavailable: boolean;
  systemReducedMotion: boolean;
  notifications: ReactNode;
  catalogScope?: CatalogScope;
  snapshot?: Snapshot;
  snapshotStale?: boolean;
  defaultFolder?: string;
  initialTab?: SettingsTab;
  returnAction?: { label: string; onReturn: () => void };
}

const settingsTabs = [
  'general',
  'appearance',
  'agents',
  'terminals',
  'notifications',
  'metrics',
  'privacy',
  'advanced',
] as const;
type SettingsTab = (typeof settingsTabs)[number];
const startupKey = 'orqst.startup.v1';
type Startup = 'studio' | 'overview' | 'last';

export function readStartup(): Startup {
  try {
    const value = localStorage.getItem(startupKey);
    return value === 'last' || value === 'overview' ? value : 'studio';
  } catch {
    return 'studio';
  }
}

export function readLimitCaps(): LimitCaps {
  try {
    const caps = JSON.parse(localStorage.getItem('orqst.accountLimits') ?? 'null')?.caps;
    if (
      Number.isInteger(caps?.warn) &&
      Number.isInteger(caps?.critical) &&
      caps.warn >= 1 &&
      caps.warn < caps.critical &&
      caps.critical <= 100
    )
      return caps;
  } catch {
    // Invalid and inaccessible preferences use the Studio defaults.
  }
  return { warn: 60, critical: 85 };
}

function LimitPreferences() {
  const { t } = useTranslation();
  const [caps, setCaps] = useState(readLimitCaps);
  const [saved, setSaved] = useState<boolean>();
  const valid = caps.warn >= 1 && caps.warn < caps.critical && caps.critical <= 100;
  return (
    <form
      className="spec-settings-fields"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        try {
          const previous = JSON.parse(localStorage.getItem('orqst.accountLimits') ?? 'null');
          localStorage.setItem('orqst.accountLimits', JSON.stringify({ ...previous, caps }));
          setSaved(true);
        } catch {
          setSaved(false);
        }
      }}
    >
      {(['warn', 'critical'] as const).map((key) => (
        <label key={key} className="settings-field">
          <span>{t(`accountLimits.${key}`)} (%)</span>
          <input
            type="number"
            min={1}
            max={100}
            required
            value={caps[key] || ''}
            onChange={(event) => {
              setCaps({ ...caps, [key]: Number(event.target.value) });
              setSaved(undefined);
            }}
          />
        </label>
      ))}
      <button className="button" disabled={!valid}>
        {t('save')}
      </button>
      {saved !== undefined && (
        <span role={saved ? 'status' : 'alert'}>
          {t(saved ? 'screens.settings.saved' : 'screens.settings.saveFailed')}
        </span>
      )}
    </form>
  );
}

export function Settings({
  appearance,
  onAppearance,
  storageUnavailable,
  systemReducedMotion,
  notifications,
  catalogScope,
  snapshot,
  snapshotStale,
  defaultFolder,
  initialTab = 'general',
  returnAction,
}: SettingsProps) {
  const { t, i18n } = useTranslation();
  const [resetOpen, setResetOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [startup, setStartup] = useState(readStartup);
  const [startupFailed, setStartupFailed] = useState(false);
  return (
    <section className="spec-screen spec-settings" aria-labelledby="settings-title">
      <div className="spec-head">
        <h1 id="settings-title">{t('shell.views.settings')}</h1>
        {returnAction && (
          <button type="button" className="button" onClick={returnAction.onReturn}>
            <ArrowLeft size={13} aria-hidden="true" />
            {returnAction.label}
          </button>
        )}
      </div>
      <div className="spec-settings-layout">
        <nav className="spec-settings-nav" aria-label={t('shell.views.settings')}>
          {settingsTabs.map((value) => (
            <button
              key={value}
              type="button"
              className="button"
              aria-current={tab === value ? 'page' : undefined}
              onClick={() => setTab(value)}
            >
              {t(`screens.settings.tabs.${value}`)}
            </button>
          ))}
        </nav>
        <section className="spec-panel spec-settings-content" aria-labelledby="settings-tab-title">
          <h2 id="settings-tab-title">{t(`screens.settings.tabs.${tab}`)}</h2>
          <div className="spec-settings-fields">
            {tab === 'general' && (
              <>
                <label className="settings-field">
                  <span>{t('language')}</span>
                  <select
                    value={i18n.resolvedLanguage ?? 'en-US'}
                    onChange={(event) => {
                      void i18n.changeLanguage(event.target.value);
                    }}
                  >
                    <option value="en-US">{t('settings.english')}</option>
                    <option value="pt-BR">{t('settings.portuguese')}</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>{t('screens.settings.startup')}</span>
                  <select
                    value={startup}
                    onChange={(event) => {
                      const next = event.target.value as Startup;
                      try {
                        localStorage.setItem(startupKey, next);
                        setStartup(next);
                        setStartupFailed(false);
                      } catch {
                        setStartupFailed(true);
                      }
                    }}
                  >
                    <option value="last">{t('screens.settings.lastPage')}</option>
                    <option value="studio">{t('shell.views.studio')}</option>
                    <option value="overview">{t('overviewPage.title')}</option>
                  </select>
                </label>
                {startupFailed && <p role="alert">{t('screens.settings.saveFailed')}</p>}
              </>
            )}
            {tab === 'appearance' && (
              <>
                <label className="settings-field">
                  <span>{t('settings.theme')}</span>
                  <select
                    value={appearance.theme}
                    title={t('settings.themeHelp')}
                    onChange={(event) =>
                      onAppearance({
                        ...appearance,
                        theme:
                          event.target.value === 'light' || event.target.value === 'system'
                            ? event.target.value
                            : 'dark',
                      })
                    }
                  >
                    <option value="dark">{t('settings.darkTheme')}</option>
                    <option value="light">{t('settings.lightTheme')}</option>
                    <option value="system">{t('settings.systemTheme')}</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>{t('settings.contrast')}</span>
                  <select
                    value={appearance.contrast}
                    onChange={(event) =>
                      onAppearance({
                        ...appearance,
                        contrast: event.target.value === 'high' ? 'high' : 'standard',
                      })
                    }
                  >
                    <option value="standard">{t('settings.standard')}</option>
                    <option value="high">{t('settings.high')}</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>{t('settings.density')}</span>
                  <select
                    value={appearance.density}
                    onChange={(event) =>
                      onAppearance({
                        ...appearance,
                        density: event.target.value === 'comfortable' ? 'comfortable' : 'compact',
                      })
                    }
                  >
                    <option value="compact">{t('settings.compact')}</option>
                    <option value="comfortable">{t('settings.comfortable')}</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>{t('settings.motion')}</span>
                  <select
                    title={t(systemReducedMotion ? 'settings.osReduced' : 'settings.osStandard')}
                    value={appearance.motion}
                    onChange={(event) =>
                      onAppearance({
                        ...appearance,
                        motion: event.target.value === 'reduced' ? 'reduced' : 'system',
                      })
                    }
                  >
                    <option value="system">{t('settings.systemMotion')}</option>
                    <option value="reduced">{t('settings.reducedMotion')}</option>
                  </select>
                </label>
                {(['textSize', 'contentSize'] as const).map((field) => (
                  <label className="settings-field" key={field}>
                    <span>{t(`settings.${field}`)}</span>
                    <select
                      value={appearance[field]}
                      title={t(`settings.${field}Help`)}
                      onChange={(event) =>
                        onAppearance({ ...appearance, [field]: readingSize(event.target.value) })
                      }
                    >
                      <option value="standard">{t('settings.sizeStandard')}</option>
                      <option value="large">{t('settings.sizeLarge')}</option>
                      <option value="extra-large">{t('settings.sizeExtraLarge')}</option>
                    </select>
                  </label>
                ))}
                <label className="settings-field">
                  <span>{t('settings.contentFont')}</span>
                  <select
                    value={appearance.contentFont}
                    title={t('settings.contentFontHelp')}
                    onChange={(event) =>
                      onAppearance({
                        ...appearance,
                        contentFont:
                          event.target.value === 'mono' || event.target.value === 'sans'
                            ? event.target.value
                            : 'default',
                      })
                    }
                  >
                    <option value="default">{t('settings.fontDefault')}</option>
                    <option value="mono">{t('settings.fontMono')}</option>
                    <option value="sans">{t('settings.fontSans')}</option>
                  </select>
                </label>
                <figure className="reading-preview" aria-labelledby="settings-preview-heading">
                  <figcaption id="settings-preview-heading">
                    {t('settings.readingPreview')}
                  </figcaption>
                  <p>{t('settings.interfaceSample')}</p>
                  <pre className="reading-content">{t('settings.contentSample')}</pre>
                </figure>
                <div className="settings-field">
                  <span>{t('screens.settings.terminalFont')}</span>
                  <span>—</span>
                </div>
                {storageUnavailable && (
                  <p role="status" title={t('settings.storageUnavailable')}>
                    {t('screens.settings.appearanceVisit')}
                  </p>
                )}
                <button className="button" onClick={() => setResetOpen(true)}>
                  {t('settings.reset')}
                </button>
              </>
            )}
            {tab === 'agents' && <Agents scope={catalogScope} />}
            {tab === 'terminals' && (
              <dl className="spec-facts">
                <div>
                  <dt>{t('screens.settings.defaultFolder')}</dt>
                  <dd>{defaultFolder ?? '—'}</dd>
                </div>
                <div>
                  <dt>{t('screens.settings.scrollback')}</dt>
                  <dd>—</dd>
                </div>
                <div>
                  <dt>{t('screens.settings.confirmClose')}</dt>
                  <dd>—</dd>
                </div>
              </dl>
            )}
            {tab === 'notifications' && notifications}
            {tab === 'metrics' && <LimitPreferences />}
            {tab === 'privacy' && (
              <dl className="spec-facts">
                <div>
                  <dt>{t('screens.settings.storage')}</dt>
                  <dd>{t('screens.settings.localStorage')}</dd>
                </div>
                <div>
                  <dt>{t('screens.settings.nativeHistory')}</dt>
                  <dd>{t('readOnly')}</dd>
                </div>
              </dl>
            )}
            {tab === 'advanced' && (
              <>
                <dl className="spec-facts">
                  <div>
                    <dt>{t('screens.settings.appVersion')}</dt>
                    <dd>{dashboardPackage.version}</dd>
                  </div>
                  <div>
                    <dt>{t('screens.settings.logs')}</dt>
                    <dd>—</dd>
                  </div>
                  <div>
                    <dt>{t('observationGuide.lastScan')}</dt>
                    <dd>
                      {snapshot?.diagnostics.lastScan ? (
                        <time dateTime={snapshot.diagnostics.lastScan}>
                          {new Date(snapshot.diagnostics.lastScan).toLocaleString(
                            i18n.resolvedLanguage,
                          )}
                        </time>
                      ) : (
                        <span title={t('observationGuide.noScan')}>—</span>
                      )}
                    </dd>
                  </div>
                  {(['files', 'malformed', 'oversized', 'skipped', 'errors'] as const).map(
                    (key) => (
                      <div key={key}>
                        <dt>{t(`observationGuide.${key}`)}</dt>
                        <dd>{snapshot?.diagnostics[key] ?? '—'}</dd>
                      </div>
                    ),
                  )}
                </dl>
                {!snapshot ? (
                  <p role="status">{t('observationGuide.noDiagnostics')}</p>
                ) : (
                  <>
                    {snapshotStale && <p role="status">{t('observationGuide.stale')}</p>}
                    <p>{t('observationGuide.sessionCount', { count: snapshot.sessions.length })}</p>
                    <details>
                      <summary>{t('screens.details')}</summary>
                      <p>
                        {t(
                          snapshot.diagnostics.scanning
                            ? 'observationGuide.scanning'
                            : 'observationGuide.notScanning',
                        )}
                      </p>
                      <p>{t('observationGuide.counterHelp')}</p>
                      <p>{t('observationGuide.historyHelp')}</p>
                    </details>
                  </>
                )}
              </>
            )}
          </div>
        </section>
      </div>
      {resetOpen && (
        <Modal
          label={t('settings.reset')}
          className="settings-reset panel shell-dialog lane-settings-reset"
          initialFocus=".reset-cancel"
          onClose={() => setResetOpen(false)}
        >
          <div className="settings-group">
            <h2>{t('settings.reset')}</h2>
            <p>{t('settings.resetHelp')}</p>
            <div className="settings-actions">
              <button className="button reset-cancel" onClick={() => setResetOpen(false)}>
                {t('cancel')}
              </button>
              <button
                className="button"
                onClick={() => {
                  onAppearance(defaultAppearancePreferences);
                  setResetOpen(false);
                }}
              >
                {t('settings.resetConfirm')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
