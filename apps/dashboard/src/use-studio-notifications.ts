import { useCallback, useEffect, useState } from 'react';
import { addAlerts, parseAlertHistory, type StudioAlert } from './studio-notifications-model';

const storageKey = 'orqst.studioNotifications.v1';

export function useStudioNotifications() {
  const [history, setHistory] = useState(() => {
    try {
      return parseAlertHistory(JSON.parse(localStorage.getItem(storageKey) ?? 'null'));
    } catch {
      return parseAlertHistory(null);
    }
  });

  const update = useCallback((change: (current: typeof history) => typeof history) => {
    setHistory((current) => change(current));
  }, []);

  // Keep writes outside state updaters, which React may run more than once.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(history));
    } catch {
      // This window still retains its current history.
    }
  }, [history]);

  const add = useCallback(
    (incoming: StudioAlert[], now = Date.now()) =>
      update((current) => addAlerts(current, incoming, now)),
    [update],
  );

  return {
    items: history.items,
    unreadCount: history.items.reduce((count, item) => count + Number(!item.read), 0),
    add,
    markRead: (id?: string) =>
      update((current) => ({
        ...current,
        items: current.items.map((item) =>
          id === undefined || id === item.id ? { ...item, read: true } : item,
        ),
      })),
    clearAll: () => update((current) => ({ ...current, items: [] })),
  };
}
