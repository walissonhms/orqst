// Read-only quarantine/capacity inspection. Never acquires a journal owner,
// releases a reservation, opens provider state or signals a process.
import { DatabaseSync } from 'node:sqlite';
import { lstatSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  terminalAdmissionLimits,
  terminalAttemptSchema,
  type TerminalAttempt,
  type TerminalState,
} from '@orqst/protocol';
import { TERMINAL_JOURNAL_LIMITS } from '@orqst/database';

export interface CapacityReservation {
  instanceId: string;
  projectId: string;
  state: TerminalState;
  updatedAt: number;
  ageMs: number;
  exitRecorded: boolean;
}

export interface CapacityReport {
  journal: string;
  schemaVersion: number;
  ownerClaimed: boolean;
  counts: Partial<Record<TerminalState, number>>;
  reservations: CapacityReservation[];
  capacity: {
    activeInstances: number;
    perProject: number;
    active: number;
    remainingGlobal: number;
    projects: { projectId: string; active: number; remaining: number }[];
  };
  retention: { attempts: number; retentionMs: number };
}

const activeStates: readonly TerminalState[] = ['starting', 'running', 'ownership_lost'];

function assertReadableJournal(file: string): void {
  if (!isAbsolute(file)) throw new Error('Journal path must be absolute');
  if (/[%?#\n]/.test(file)) throw new Error('Journal path contains unsupported characters');
  const info = lstatSync(file);
  if (info.isSymbolicLink() || !info.isFile())
    throw new Error('Journal must be a regular non-symlink file');
  // Read-only access still refuses a world/group-writable path that another user could swap.
  if ((info.mode & 0o022) !== 0) throw new Error('Journal path is writable by another user');
  // An immutable read never writes the shared-memory/WAL sidecars of quarantined evidence.
  // Pending WAL frames would make that snapshot incomplete, so they fail closed instead.
  try {
    if (statSync(`${file}-wal`).size > 0)
      throw new Error('Journal has pending WAL frames; stop its owner before inspecting');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** Reads allowlisted attempt metadata only; a missing or foreign schema fails closed. */
export function inspectTerminalCapacity(
  file: string,
  now: () => number = Date.now,
): CapacityReport {
  assertReadableJournal(file);
  // Immutable: no locks, no -shm/-wal creation, no checkpoint of preserved evidence.
  const db = new DatabaseSync(`file:${file}?immutable=1`, { readOnly: true });
  try {
    const version = db.prepare('SELECT version FROM terminal_schema WHERE singleton=1').get() as
      { version?: number } | undefined;
    // Version 1 and 2 share this attempt shape; v2 only adds nullable exit evidence.
    if (version?.version !== 1 && version?.version !== 2)
      throw new Error('Unsupported terminal journal schema');
    const owner = db.prepare('SELECT epoch FROM terminal_owner WHERE singleton=1').get();
    const rows = db
      .prepare('SELECT metadata FROM terminal_attempts ORDER BY updated_at,instance_id LIMIT 10001')
      .all();
    if (rows.length > TERMINAL_JOURNAL_LIMITS.attempts)
      throw new Error('Terminal journal capacity exceeded');
    const attempts: TerminalAttempt[] = rows.map((row) =>
      terminalAttemptSchema.parse(JSON.parse(String((row as { metadata: unknown }).metadata))),
    );
    const timestamp = now();
    const counts: Partial<Record<TerminalState, number>> = {};
    for (const attempt of attempts) counts[attempt.state] = (counts[attempt.state] ?? 0) + 1;
    const reservations = attempts
      .filter((attempt) => activeStates.includes(attempt.state))
      .map((attempt) => ({
        instanceId: attempt.instanceId,
        projectId: attempt.projectId,
        state: attempt.state,
        updatedAt: attempt.updatedAt,
        ageMs: Math.max(0, timestamp - attempt.updatedAt),
        exitRecorded: attempt.exit !== undefined,
      }));
    const projects = [...new Set(reservations.map((entry) => entry.projectId))]
      .sort()
      .map((projectId) => {
        const active = reservations.filter((entry) => entry.projectId === projectId).length;
        return {
          projectId,
          active,
          remaining: Math.max(0, terminalAdmissionLimits.perProject - active),
        };
      });
    return {
      journal: file,
      schemaVersion: version.version,
      ownerClaimed: owner !== undefined,
      counts,
      reservations,
      capacity: {
        activeInstances: terminalAdmissionLimits.activeInstances,
        perProject: terminalAdmissionLimits.perProject,
        active: reservations.length,
        remainingGlobal: Math.max(0, terminalAdmissionLimits.activeInstances - reservations.length),
        projects,
      },
      retention: {
        attempts: TERMINAL_JOURNAL_LIMITS.attempts,
        retentionMs: TERMINAL_JOURNAL_LIMITS.retentionMs,
      },
    };
  } finally {
    db.close();
  }
}
