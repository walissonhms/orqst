import { useEffect, useState } from 'react';

export interface AppearancePreferences {
  theme: 'dark' | 'light' | 'system';
  contrast: 'standard' | 'high';
  density: 'compact' | 'comfortable';
  motion: 'system' | 'reduced';
  textSize: 'standard' | 'large' | 'extra-large';
  contentSize: 'standard' | 'large' | 'extra-large';
  contentFont: 'default' | 'mono' | 'sans';
}
export const appearanceStorageKey = 'orqst.appearance.v1';
export const defaultAppearancePreferences: AppearancePreferences = {
  theme: 'dark',
  contrast: 'standard',
  density: 'compact',
  motion: 'system',
  textSize: 'standard',
  contentSize: 'standard',
  contentFont: 'default',
};
export function parseAppearancePreferences(value: string | null): AppearancePreferences {
  try {
    const data: unknown = JSON.parse(value ?? 'null');
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return defaultAppearancePreferences;
    const record = data as Record<string, unknown>;
    return {
      theme: record.theme === 'light' || record.theme === 'system' ? record.theme : 'dark',
      contrast: record.contrast === 'high' ? 'high' : 'standard',
      density: record.density === 'comfortable' ? 'comfortable' : 'compact',
      motion: record.motion === 'reduced' ? 'reduced' : 'system',
      textSize: readingSize(record.textSize),
      contentSize: readingSize(record.contentSize),
      contentFont:
        record.contentFont === 'mono' || record.contentFont === 'sans'
          ? record.contentFont
          : 'default',
    };
  } catch {
    return defaultAppearancePreferences;
  }
}
export function readingSize(value: unknown): AppearancePreferences['textSize'] {
  return value === 'large' || value === 'extra-large' ? value : 'standard';
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
  const [systemLightTheme, setSystemLightTheme] = useState(
    () => matchMedia('(prefers-color-scheme: light)').matches,
  );
  const resolvedTheme =
    appearance.theme === 'system' ? (systemLightTheme ? 'light' : 'dark') : appearance.theme;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.contrast = appearance.contrast;
    root.dataset.density = appearance.density;
    root.dataset.motion = appearance.motion;
    root.dataset.textSize = appearance.textSize;
    root.dataset.contentSize = appearance.contentSize;
    root.dataset.contentFont = appearance.contentFont;
  }, [appearance, resolvedTheme]);
  useEffect(() => {
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
    const themeMedia = matchMedia('(prefers-color-scheme: light)');
    const onThemeChange = () => setSystemLightTheme(themeMedia.matches);
    themeMedia.addEventListener('change', onThemeChange);
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
      themeMedia.removeEventListener('change', onThemeChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return { appearance, setAppearance, storageUnavailable, systemReducedMotion, resolvedTheme };
}
