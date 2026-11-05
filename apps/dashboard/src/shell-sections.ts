import type { SessionView, WorkspaceView } from '@orqst/protocol';

/** A `running` session without activity for this long is shown as stale, not running. */
export const STALE_MS = 15 * 60 * 1000;

export interface ShellSections {
  needsYou: SessionView[];
  running: SessionView[];
  stale: number;
  recent: SessionView[];
}

const time = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Sidebar sections from observed sessions. A last-known `running` status never proves
 * the agent is alive: only recent activity counts as running.
 */
export function shellSections(sessions: SessionView[], now: number, limit = 6): ShellSections {
  const byActivity = [...sessions].sort((a, b) => time(b.lastActivity) - time(a.lastActivity));
  const fresh = (session: SessionView) => now - time(session.lastActivity) <= STALE_MS;
  const needsYou = byActivity.filter(
    (session) => session.status === 'waiting_for_user' && fresh(session),
  );
  const runningAll = byActivity.filter((session) => session.status === 'running');
  const running = runningAll.filter(fresh);
  const shown = new Set([...needsYou, ...running].map((session) => session.id));
  return {
    needsYou: needsYou.slice(0, limit),
    running: running.slice(0, limit),
    stale: runningAll.length - running.length,
    recent: byActivity.filter((session) => !shown.has(session.id)).slice(0, limit),
  };
}

/** OS temporary folders (acceptance runs, disposable tests) are hidden by default. */
export function isTemporaryWorkspace(workspace: Pick<WorkspaceView, 'path'>): boolean {
  return /^(\/private)?\/(var\/folders|tmp)\//.test(workspace.path);
}

/** Relative age such as `3m`, `2h`, `4d`; `—` when unknown. */
export function shortAge(value: string, now: number): string {
  const at = time(value);
  if (!at) return '—';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
