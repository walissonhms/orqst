import { useEffect, useState } from 'react';

export interface AppearancePreferences {
  contrast: 'standard' | 'high';
  density: 'compact' | 'comfortable';
  motion: 'system' | 'reduced';
}
export const appearanceStorageKey = 'orqst.appearance.v1';
export const defaultAppearancePreferences: AppearancePreferences = {
  contrast: 'standard',
  density: 'compact',
  motion: 'system',
};
export function parseAppearancePreferences(value: string | null): AppearancePreferences {
  try {
    const data: unknown = JSON.parse(value ?? 'null');
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return defaultAppearancePreferences;
    const record = data as Record<string, unknown>;
    return {
      contrast: record.contrast === 'high' ? 'high' : 'standard',
      density: record.density === 'comfortable' ? 'comfortable' : 'compact',
      motion: record.motion === 'reduced' ? 'reduced' : 'system',
    };
  } catch {
    return defaultAppearancePreferences;
  }
}
function readAppearancePreferences(): AppearancePreferences {
  try {
    return parseAppearancePreferences(localStorage.getItem(appearanceStorageKey));
  } catch {
    return defaultAppearancePreferences;
  }
}
export function useAppearancePreferences() {
  const [appearance, setAppearance] = useState(readAppearancePreferences);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.contrast = appearance.contrast;
    root.dataset.density = appearance.density;
    root.dataset.motion = appearance.motion;
    try {
      localStorage.setItem(appearanceStorageKey, JSON.stringify(appearance));
      setStorageUnavailable(false);
    } catch {
      setStorageUnavailable(true);
    }
  }, [appearance]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setSystemReducedMotion(media.matches);
    media.addEventListener('change', onChange);
    const onStorage = (event: StorageEvent) => {
      if (
        event.storageArea === localStorage &&
        (event.key === appearanceStorageKey || event.key === null)
      )
        setAppearance(parseAppearancePreferences(event.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return { appearance, setAppearance, storageUnavailable, systemReducedMotion };
}
