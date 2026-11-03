import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings2 } from 'lucide-react';
import { Modal } from './Modal';
import {
  defaultAppearancePreferences,
  readingSize,
  type AppearancePreferences,
} from './appearance-preferences';

export function Settings({
  appearance,
  onAppearance,
  storageUnavailable,
  systemReducedMotion,
  notifications,
  onGuide,
}: {
  appearance: AppearancePreferences;
  onAppearance: (value: AppearancePreferences) => void;
  storageUnavailable: boolean;
  systemReducedMotion: boolean;
  notifications: ReactNode;
  onGuide: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [resetOpen, setResetOpen] = useState(false);
  return (
    <div className="settings-page">
      <div className="page-heading">
        <div>
          <h1>
            <Settings2 size={24} /> {t('shell.views.settings')}
          </h1>
          <p>{t('settings.description')}</p>
        </div>
      </div>
      <div className="settings-groups">
        <section className="panel settings-group" aria-labelledby="settings-general">
          <h2 id="settings-general">{t('settings.general')}</h2>
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
          <p className="fine-print">{t('settings.languageHelp')}</p>
          <button className="button" onClick={onGuide}>
            {t('observationGuide.title')}
          </button>
        </section>
        <section className="panel settings-group" aria-labelledby="settings-appearance">
          <h2 id="settings-appearance">{t('settings.appearance')}</h2>
          <p className="fine-print">{t('settings.appearanceHelp')}</p>
          <label className="settings-field">
            <span>{t('settings.theme')}</span>
            <select
              value={appearance.theme}
              aria-describedby="settings-theme-help"
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
          <p className="fine-print" id="settings-theme-help">
            {t('settings.themeHelp')}
          </p>
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
          <p className="fine-print">{t('settings.densityHelp')}</p>
          <label className="settings-field">
            <span>{t('settings.motion')}</span>
            <select
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
          <p className="fine-print">
            {t(systemReducedMotion ? 'settings.osReduced' : 'settings.osStandard')}
          </p>
          {(['textSize', 'contentSize'] as const).map((field) => (
            <label className="settings-field" key={field}>
              <span>{t(`settings.${field}`)}</span>
              <select
                value={appearance[field]}
                aria-describedby={`settings-${field}-help`}
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
          <p className="fine-print" id="settings-textSize-help">
            {t('settings.textSizeHelp')}
          </p>
          <p className="fine-print" id="settings-contentSize-help">
            {t('settings.contentSizeHelp')}
          </p>
          <label className="settings-field">
            <span>{t('settings.contentFont')}</span>
            <select
              value={appearance.contentFont}
              aria-describedby="settings-contentFont-help"
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
          <p className="fine-print" id="settings-contentFont-help">
            {t('settings.contentFontHelp')}
          </p>
          <figure className="reading-preview" aria-labelledby="settings-preview-heading">
            <figcaption id="settings-preview-heading">{t('settings.readingPreview')}</figcaption>
            <p>{t('settings.interfaceSample')}</p>
            <pre className="reading-content">{t('settings.contentSample')}</pre>
          </figure>
          <p className="fine-print">{t('settings.zoomHelp')}</p>
          <p className={storageUnavailable ? 'notice' : 'fine-print'} role="status">
            {t(storageUnavailable ? 'settings.storageUnavailable' : 'settings.localScope')}
          </p>
          <button className="button" onClick={() => setResetOpen(true)}>
            {t('settings.reset')}
          </button>
        </section>
        <section className="panel settings-group" aria-labelledby="settings-notifications">
          <h2 id="settings-notifications">{t('notifications')}</h2>
          <p className="fine-print">{t('settings.notificationScope')}</p>
          {notifications}
        </section>
        <section className="panel settings-group" aria-labelledby="settings-privacy">
          <h2 id="settings-privacy">{t('settings.privacy')}</h2>
          <p>{t('settings.privacyHelp')}</p>
          <p className="fine-print">{t('settings.privacyLimit')}</p>
        </section>
      </div>
      {resetOpen && (
        <Modal
          label={t('settings.reset')}
          className="settings-reset panel shell-dialog"
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
    </div>
  );
}
