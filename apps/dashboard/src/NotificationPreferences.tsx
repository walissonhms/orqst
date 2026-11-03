import { useTranslation } from 'react-i18next';
import { Bell, Volume2 } from 'lucide-react';
import type { Preferences } from '@orqst/protocol';

/** Shared controls keep Settings and the notification drawer on the same confirmed store. */
export function NotificationPreferences({
  value,
  disabled,
  nativeDesktop,
  onChange,
  onTestSound,
  onPermission,
}: {
  value: Preferences;
  disabled: boolean;
  nativeDesktop: boolean;
  onChange: (value: Preferences) => void;
  onTestSound: () => void;
  onPermission: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="preferences">
      <h3>{t('preferences')}</h3>
      {(['completed', 'failed', 'intervention', 'sound'] as const).map((key) => (
        <label className="preference" key={key}>
          <span>
            {t(
              key === 'completed'
                ? 'notificationCompleted'
                : key === 'failed'
                  ? 'notificationFailed'
                  : key === 'intervention'
                    ? 'notificationIntervention'
                    : 'sound',
            )}
          </span>
          <input
            type="checkbox"
            checked={value[key]}
            disabled={disabled}
            onChange={(event) => {
              onChange({ ...value, [key]: event.target.checked });
              if (key === 'sound' && event.target.checked) onTestSound();
            }}
          />
        </label>
      ))}
      <button className="button" onClick={onTestSound}>
        <Volume2 size={14} />
        {t('audioTest')}
      </button>
      {!nativeDesktop && (
        <button className="button" onClick={onPermission}>
          <Bell size={14} />
          {t('desktop')}
        </button>
      )}
      <p className="fine-print">
        {t(nativeDesktop ? 'desktopShell.dashboardNotice' : 'notificationsPermission')}
      </p>
    </div>
  );
}
