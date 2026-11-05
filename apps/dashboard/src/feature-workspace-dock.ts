/** Minimal dock payload only: hidden slot, label and provider. No ids, proofs or epochs. */
export interface DockPane {
  slot: number;
  label: string;
  provider: string;
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
