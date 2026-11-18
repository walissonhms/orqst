import { useTranslation } from 'react-i18next';
import { Bell, Volume2 } from 'lucide-react';
import type { Preferences } from '@orqst/protocol';
import './account-limits.css';

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
  const labels = {
    completed: 'notificationCompleted',
    failed: 'notificationFailed',
    intervention: 'notificationIntervention',
    sound: 'sound',
  } as const;
  return (
    <div className="preferences lane-notification-preferences">
      <h3>{t('preferences')}</h3>
      {(['completed', 'failed', 'intervention', 'sound'] as const).map((key) => (
        <label className="preference" key={key}>
          <span>{t(labels[key])}</span>
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
        <Volume2 size={14} aria-hidden="true" />
        {t('audioTest')}
      </button>
      {!nativeDesktop && (
        <button className="button" onClick={onPermission}>
          <Bell size={14} aria-hidden="true" />
          {t('desktop')}
        </button>
      )}
      <p className="fine-print">
        {t(nativeDesktop ? 'desktopShell.dashboardNotice' : 'notificationsPermission')}
      </p>
    </div>
  );
}
