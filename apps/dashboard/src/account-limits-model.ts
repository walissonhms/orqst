import type { TerminalProvider } from './TerminalStudio';

/** One usage window reported by a provider (e.g. 5 hours, week, a model-specific cap). */
export interface LimitWindow {
  id: string;
  label: string;
  /** 0–100 when evidenced; undefined means unknown, never zero. */
  usedPercent?: number;
  /** Epoch ms when the window renews, when known. */
  resetsAt?: number;
}

export interface AccountLimit {
  id: string;
  provider: TerminalProvider;
  /** Stable visible number of the account inside its CLI. */
  index: number;
  plan?: string;
  /** Epoch ms of the latest evidenced reading. */
  updatedAt?: number;
  /** Locked accounts are never suggested when another account reaches a limit. */
  locked: boolean;
  windows: LimitWindow[];
}

export interface LimitCaps {
  /** Percentages where bars turn amber and red. */
  warn: number;
  critical: number;
}

export function level(
  percent: number | undefined,
  caps: LimitCaps,
): 'ok' | 'warn' | 'critical' | 'unknown' {
  if (percent === undefined) return 'unknown';
  return percent >= caps.critical ? 'critical' : percent >= caps.warn ? 'warn' : 'ok';
}

/** Compact countdown: `4d10h`, `21h15m`, `2h45m`, `5m`; `—` when unknown or past. */
export function renewsIn(resetsAt: number | undefined, now: number): string {
  if (resetsAt === undefined || resetsAt <= now) return '—';
  const minutes = Math.floor((resetsAt - now) / 60_000);
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

/** The most used window decides the toolbar bar for an account. */
export function worstWindow(account: AccountLimit): LimitWindow | undefined {
  return [...account.windows]
    .filter((window) => window.usedPercent !== undefined)
    .sort((a, b) => b.usedPercent! - a.usedPercent!)[0];
}

const providers = new Set(['codex', 'claude', 'opencode', 'shell']);
const finite = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/**
 * Validate host-reported limits. Anything malformed is dropped rather than shown:
 * the panel never displays a guessed percentage or renewal time.
 */
export function parseAccountLimits(value: unknown): AccountLimit[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).flatMap((raw): AccountLimit[] => {
    if (!raw || typeof raw !== 'object') return [];
    const entry = raw as Record<string, unknown>;
    if (typeof entry.id !== 'string' || !providers.has(entry.provider as string)) return [];
    if (!finite(entry.index, 1, 99)) return [];
    const windows = Array.isArray(entry.windows)
      ? entry.windows.slice(0, 8).flatMap((w): LimitWindow[] => {
          if (!w || typeof w !== 'object') return [];
          const item = w as Record<string, unknown>;
          if (typeof item.id !== 'string' || typeof item.label !== 'string') return [];
          return [
            {
              id: item.id,
              label: item.label.slice(0, 24),
              ...(finite(item.usedPercent, 0, 100)
                ? { usedPercent: item.usedPercent as number }
                : {}),
              ...(finite(item.resetsAt) ? { resetsAt: item.resetsAt as number } : {}),
            },
          ];
        })
      : [];
    return [
      {
        id: entry.id.slice(0, 64),
        provider: entry.provider as TerminalProvider,
        index: entry.index as number,
        ...(typeof entry.plan === 'string' ? { plan: entry.plan.slice(0, 16) } : {}),
        ...(finite(entry.updatedAt) ? { updatedAt: entry.updatedAt as number } : {}),
        locked: entry.locked === true,
        windows,
      },
    ];
  });
}
