import { useEffect, useState } from 'react';

export const workspacePinsStorageKey = 'orqst.workspace-pins.v1';
export const maxWorkspacePins = 100;

export function parseWorkspacePins(value: string | null): string[] {
  try {
    if (!value || value.length > 128_000) return [];
    const data: unknown = JSON.parse(value);
    if (!Array.isArray(data)) return [];
    return [
      ...new Set(
        data.filter(
          (id): id is string =>
            typeof id === 'string' &&
            id.length > 0 &&
            id.length <= 200 &&
            ![...id].some(
              (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
            ),
        ),
      ),
    ].slice(0, maxWorkspacePins);
  } catch {
    return [];
  }
}

export function pinnedFirst<T extends { id: string }>(items: T[], pins: string[]): T[] {
  const pinned = new Set(pins);
  return [
    ...items.filter((item) => pinned.has(item.id)),
    ...items.filter((item) => !pinned.has(item.id)),
  ];
}

function readPins() {
  try {
    return {
      pins: parseWorkspacePins(localStorage.getItem(workspacePinsStorageKey)),
      storageUnavailable: false,
    };
  } catch {
    return { pins: [] as string[], storageUnavailable: true };
  }
}

export function useWorkspacePins() {
  const [state, setState] = useState(readPins);
  function togglePin(id: string) {
    // Prefer the latest other-tab choice, while retaining visit-only edits if storage fails.
    const stored = readPins();
    const current =
      stored.storageUnavailable || state.storageUnavailable ? state.pins : stored.pins;
    const pins = current.includes(id)
      ? current.filter((pin) => pin !== id)
      : parseWorkspacePins(JSON.stringify([...current, id]));
    savePins(pins);
  }
  function savePins(pins: string[]) {
    try {
      localStorage.setItem(workspacePinsStorageKey, JSON.stringify(pins));
      setState({ pins, storageUnavailable: false });
    } catch {
      setState({ pins, storageUnavailable: true });
    }
  }
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      try {
        if (
          event.storageArea === localStorage &&
          (event.key === workspacePinsStorageKey || event.key === null)
        )
          setState(readPins());
      } catch {
        setState((current) => ({ ...current, storageUnavailable: true }));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return { ...state, togglePin, clearPins: () => savePins([]) };
}
