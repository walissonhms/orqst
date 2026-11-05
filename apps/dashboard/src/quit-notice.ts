export interface QuitBlocked {
  reason: string;
  uncertain: Array<{ slot: number; reason: string }>;
}

const REASONS = new Set(['transport', 'uncertain', 'busy', 'denied', 'retirement']);

export function quitBlocked(detail: unknown): QuitBlocked | null {
  if (!detail || typeof detail !== 'object') return null;
  const reason = (detail as { reason?: unknown }).reason;
  if (typeof reason !== 'string' || !REASONS.has(reason)) return null;
  const raw = (detail as { uncertain?: unknown }).uncertain;
  const uncertain: QuitBlocked['uncertain'] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const slot = (entry as { slot?: unknown }).slot;
      const why = (entry as { reason?: unknown }).reason;
      if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > 7) continue;
      if (typeof why !== 'string' || why.length > 64) continue;
      uncertain.push({ slot, reason: why });
    }
  }
  return { reason, uncertain };
}
