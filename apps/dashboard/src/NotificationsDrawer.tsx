import { useState, type ReactNode } from 'react';
import {
  Bell,
  CheckCircle2,
  CircleAlert,
  CircleX,
  Gauge,
  MailWarning,
  UserRoundX,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import type { StudioAlert, StudioAlertKind } from './studio-notifications-model';
import './studio-notifications.css';

const severity = {
  completed: { icon: CheckCircle2, color: 'success' },
  failed: { icon: CircleX, color: 'error' },
  waiting_for_user: { icon: CircleAlert, color: 'warning' },
  delivery_failed: { icon: MailWarning, color: 'error' },
  recipient_ended: { icon: UserRoundX, color: 'warning' },
  limit_threshold: { icon: Gauge, color: 'warning' },
} satisfies Record<StudioAlertKind, { icon: typeof CircleX; color: string }>;

export function NotificationsDrawer({
  items,
  unreadCount,
  open,
  onClose,
  onMarkRead,
  onClearAll,
  canFocus,
  focusTerminal,
  preferences,
}: {
  items: readonly StudioAlert[];
  unreadCount: number;
  open: boolean;
  onClose: () => void;
  onMarkRead: (id?: string) => void;
  onClearAll: () => void;
  canFocus: (featureId: string | null, terminalId: string) => boolean;
  focusTerminal: (featureId: string | null, terminalId: string) => Promise<boolean>;
  preferences?: ReactNode;
}) {
  if (!open) return null;
  return (
    <DrawerContent
      {...{
        items,
        unreadCount,
        onClose,
        onMarkRead,
        onClearAll,
        canFocus,
        focusTerminal,
        preferences,
      }}
    />
  );
}

function DrawerContent({
  items,
  unreadCount,
  onClose,
  onMarkRead,
  onClearAll,
  canFocus,
  focusTerminal,
  preferences,
}: Omit<Parameters<typeof NotificationsDrawer>[0], 'open'>) {
  const { t, i18n } = useTranslation();
  const [openingId, setOpeningId] = useState<string>();
  const [failed, setFailed] = useState(false);
  const time = new Intl.DateTimeFormat(i18n.resolvedLanguage, { timeStyle: 'short' });
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  async function openItem(item: StudioAlert) {
    if (openingId || !item.target) return;
    setFailed(false);
    setOpeningId(item.id);
    try {
      if (await focusTerminal(item.target.featureId, item.target.terminalId)) {
        onMarkRead(item.id);
        onClose();
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setOpeningId(undefined);
    }
  }

  return (
    <Modal
      label={t('notifications')}
      className="studio-notifications"
      onClose={onClose}
      nativeOverlay
    >
      <header>
        <h2>
          <Bell size={16} aria-hidden="true" />
          {t('notifications')}
        </h2>
        <button type="button" aria-label={t('close')} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="studio-notifications-actions">
        <span>{t('notificationCounts', { count: unreadCount })}</span>
        <button type="button" onClick={() => onMarkRead()} disabled={!unreadCount}>
          {t('markRead')}
        </button>
        <button type="button" onClick={onClearAll} disabled={!items.length}>
          {t('studioNotifications.clearAll')}
        </button>
      </div>
      {failed && <p role="status">{t('studioNotifications.focusFailed')}</p>}
      {!items.length && <p>{t('studioNotifications.empty')}</p>}
      <ul>
        {items.map((item) => {
          const { icon: Icon, color } = severity[item.kind];
          const address = item.target;
          const enabled = address && canFocus(address.featureId, address.terminalId);
          const details = (
            <>
              <Icon size={16} className={`studio-notifications-${color}`} aria-hidden="true" />
              <span>
                <strong>{t(`studioNotifications.events.${item.kind}`)}</strong>
                <small>
                  {address
                    ? `${address.label} · ${address.featureName ?? t('features.unassigned')}`
                    : item.provider && t(`terminalStudio.providers.${item.provider}`)}
                </small>
              </span>
              <time dateTime={new Date(item.at).toISOString()} title={date.format(item.at)}>
                {time.format(item.at)}
              </time>
              {!item.read && (
                <span
                  className="studio-notifications-dot"
                  aria-label={t('shell.notifications.itemUnread')}
                />
              )}
            </>
          );
          return (
            <li key={item.id}>
              {enabled ? (
                <button
                  className="studio-notifications-row"
                  type="button"
                  aria-disabled={!!openingId}
                  onClick={() => void openItem(item)}
                >
                  {details}
                </button>
              ) : (
                <div className="studio-notifications-row">{details}</div>
              )}
              {!item.read && (
                <button
                  className="studio-notifications-read"
                  type="button"
                  onClick={() => onMarkRead(item.id)}
                >
                  {t('studioNotifications.markRead')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {preferences && <footer className="studio-notifications-footer">{preferences}</footer>}
    </Modal>
  );
}
