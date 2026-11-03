import { useEffect, useState } from 'react';

export const overviewPanels = ['activity', 'attention', 'usage', 'diagnostics'] as const;
export type OverviewPanel = (typeof overviewPanels)[number];
export interface OverviewPreferences {
  order: OverviewPanel[];
  hidden: OverviewPanel[];
}
export const overviewStorageKey = 'orqst.overview.v1';
export const defaultOverviewPreferences: OverviewPreferences = {
  order: [...overviewPanels],
  hidden: [],
};

function panelList(value: unknown): OverviewPanel[] {
  if (!Array.isArray(value)) return [];
  return overviewPanels.filter((panel) => value.includes(panel));
}

export function parseOverviewPreferences(value: string | null): OverviewPreferences {
  try {
    if (!value || value.length > 4096) return defaultOverviewPreferences;
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return defaultOverviewPreferences;
    const record = data as Record<string, unknown>;
    const order = Array.isArray(record.order)
      ? record.order.filter(
          (panel, index, values): panel is OverviewPanel =>
            overviewPanels.includes(panel as OverviewPanel) && values.indexOf(panel) === index,
        )
      : [];
    return {
      order: [...order, ...overviewPanels.filter((panel) => !order.includes(panel))],
      hidden: panelList(record.hidden),
    };
  } catch {
    return defaultOverviewPreferences;
  }
}

function readOverviewState() {
  try {
    return {
      preferences: parseOverviewPreferences(localStorage.getItem(overviewStorageKey)),
      storageUnavailable: false,
    };
  } catch {
    return { preferences: defaultOverviewPreferences, storageUnavailable: true };
  }
}

export function moveOverviewPanel(
  preferences: OverviewPreferences,
  panel: OverviewPanel,
  direction: -1 | 1,
): OverviewPreferences {
  const order = [...preferences.order];
  const index = order.indexOf(panel);
  const adjacent = order[index + direction];
  if (index < 0 || !adjacent) return preferences;
  order[index] = adjacent;
  order[index + direction] = panel;
  return { ...preferences, order };
}

export function useOverviewPreferences() {
  const [state, setState] = useState(readOverviewState);
  function setPreferences(preferences: OverviewPreferences) {
    try {
      localStorage.setItem(overviewStorageKey, JSON.stringify(preferences));
      setState({ preferences, storageUnavailable: false });
    } catch {
      setState({ preferences, storageUnavailable: true });
    }
  }
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      try {
        if (
          event.storageArea === localStorage &&
          (event.key === overviewStorageKey || event.key === null)
        ) {
          // Read the latest stored choice rather than replaying a queued older event.
          // Receiving another tab's choice must not write it back into storage.
          setState({
            preferences: parseOverviewPreferences(localStorage.getItem(overviewStorageKey)),
            storageUnavailable: false,
          });
        }
      } catch {
        setState((current) => ({ ...current, storageUnavailable: true }));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return { ...state, setPreferences };
}
