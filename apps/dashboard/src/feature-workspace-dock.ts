/** Minimal dock payload only: hidden slot, label and provider. No ids, proofs or epochs. */
export interface DockPane {
  slot: number;
  label: string;
  provider: string;
}
export interface WorkspacePane extends DockPane {
  minimized: boolean;
  visible: boolean;
  active: boolean;
  maximized: boolean;
}

/** Display projection only. Every command is separately bound to the Core's current UUID. */
export function workspacePanes(detail: unknown): WorkspacePane[] {
  const panes = (detail as { panes?: unknown } | null)?.panes;
  if (!Array.isArray(panes) || panes.length > 8) return [];
  const seen = new Set<number>();
  return panes.flatMap((pane: unknown) => {
    if (!pane || typeof pane !== 'object') return [];
    const record = pane as Record<string, unknown>;
    if (
      Object.keys(record).length !== 7 ||
      Object.keys(record).some(
        (key) =>
          !['slot', 'label', 'provider', 'minimized', 'visible', 'active', 'maximized'].includes(
            key,
          ),
      ) ||
      !['minimized', 'visible', 'active', 'maximized'].every(
        (key) => typeof record[key] === 'boolean',
      )
    )
      return [];
    const valid = dockPanes({
      hidden: [{ slot: record.slot, label: record.label, provider: record.provider }],
    })[0];
    if (!valid || seen.has(valid.slot)) return [];
    seen.add(valid.slot);
    return [
      {
        ...valid,
        minimized: record.minimized as boolean,
        visible: record.visible as boolean,
        active: record.active as boolean,
        maximized: record.maximized as boolean,
      },
    ];
  });
}

export function dockGeneration(detail: unknown): number {
  const value = (detail as { generation?: unknown } | null)?.generation;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function dockPanes(detail: unknown): DockPane[] {
  if (!detail || typeof detail !== 'object') return [];
  const hidden = (detail as { hidden?: unknown }).hidden;
  if (!Array.isArray(hidden)) return [];
  const seen = new Set<number>();
  const panes: DockPane[] = [];
  for (const entry of hidden) {
    if (!entry || typeof entry !== 'object') continue;
    if (Object.keys(entry as object).some((key) => !['slot', 'label', 'provider'].includes(key)))
      continue;
    const slot = (entry as { slot?: unknown }).slot;
    const label = (entry as { label?: unknown }).label;
    const provider = (entry as { provider?: unknown }).provider;
    if (
      typeof slot !== 'number' ||
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot > 7 ||
      seen.has(slot) ||
      typeof label !== 'string' ||
      label.length > 48 ||
      typeof provider !== 'string' ||
      provider.length > 32
    )
      continue;
    seen.add(slot);
    panes.push({ slot, label, provider });
  }
  return panes;
}
