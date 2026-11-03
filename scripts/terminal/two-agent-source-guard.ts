// Explicit acceptance only: inspect names/metadata, never captured content or credentials.
import { lstatSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const entryLimit = 100000;
const depthLimit = 8;
type Source = 'home' | 'history' | 'sessions' | 'archived_sessions' | 'input';
type Reason =
  | 'invalid_input'
  | 'unsafe_home'
  | 'home_changed'
  | 'unsafe_history'
  | 'history_changed'
  | 'unsafe_directory'
  | 'unsafe_entry'
  | 'thread_materialized'
  | 'depth_exceeded'
  | 'budget_exceeded'
  | 'inspection_error';
export type SourceDiagnostic = {
  reason: Reason;
  source: Source;
  homeIndex: number | null;
  entries: number;
  entryLimit: number;
  depth: number | null;
  depthLimit: number;
  historyChanges: {
    presence: boolean;
    inode: boolean;
    size: boolean;
    mtime: boolean;
    ctime: boolean;
  } | null;
};
export type SourceInspection = {
  historyHomesChecked: number;
  historyHomesTotal: number;
  changedHistories: Array<{
    homeIndex: number;
    fields: NonNullable<SourceDiagnostic['historyChanges']>;
  }>;
  testThreadFiles: 'not-found' | 'found' | 'incomplete';
};
type SourceCheck = 'baseline' | 'pre-confirmation' | 'cleanup';
export type SourceCheckRecord = {
  phase: 'source-preservation';
  check: SourceCheck;
  status: 'captured' | 'verified' | 'inconclusive' | 'failed';
  diagnostic: SourceDiagnostic | null;
  inspection?: SourceInspection;
};

/** Later success cannot erase an earlier failure or missing required check. */
export function sourceCheckSummary(records: readonly SourceCheckRecord[]) {
  if (records.some((record) => record.status === 'failed')) return 'failed';
  if (records.some((record) => record.status === 'inconclusive')) return 'inconclusive';
  return (['baseline', 'pre-confirmation', 'cleanup'] as const).every((check) =>
    records.some(
      (record) =>
        record.check === check &&
        record.status === (check === 'baseline' ? 'captured' : 'verified'),
    ),
  )
    ? 'verified'
    : 'incomplete';
}

export class SourceGuardError extends Error {
  constructor(
    readonly diagnostic: SourceDiagnostic,
    readonly inspection?: SourceInspection,
  ) {
    super(`Source preservation: ${diagnostic.reason}`);
    this.name = 'SourceGuardError';
  }
}

function failure(
  reason: Reason,
  source: Source,
  homeIndex: number | null,
  entries = 0,
  depth: number | null = null,
  historyChanges: SourceDiagnostic['historyChanges'] = null,
): never {
  throw new SourceGuardError({
    reason,
    source,
    homeIndex,
    entries,
    entryLimit,
    depth,
    depthLimit,
    historyChanges,
  });
}

export function sourceDiagnostic(error: unknown): SourceDiagnostic {
  return error instanceof SourceGuardError
    ? error.diagnostic
    : {
        reason: 'inspection_error',
        source: 'input',
        homeIndex: null,
        entries: 0,
        entryLimit,
        depth: null,
        depthLimit,
        historyChanges: null,
      };
}

export function runSourceCheck<T>(
  check: SourceCheck,
  operation: () => T,
  emit: (record: SourceCheckRecord) => void,
): T {
  try {
    const result = operation();
    emit({
      phase: 'source-preservation',
      check,
      status: check === 'baseline' ? 'captured' : 'verified',
      diagnostic: null,
    });
    return result;
  } catch (error) {
    const diagnostic = sourceDiagnostic(error);
    emit({
      phase: 'source-preservation',
      check,
      status: diagnostic.reason === 'history_changed' ? 'inconclusive' : 'failed',
      diagnostic,
      ...(error instanceof SourceGuardError && error.inspection
        ? { inspection: error.inspection }
        : {}),
    });
    throw new SourceGuardError(
      diagnostic,
      error instanceof SourceGuardError ? error.inspection : undefined,
    );
  }
}

type Metadata = { inode: number; size: number; mtime: number; ctime: number } | null;
function metadata(file: string, homeIndex: number): Metadata {
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) failure('unsafe_history', 'history', homeIndex);
    return { inode: info.ino, size: info.size, mtime: info.mtimeMs, ctime: info.ctimeMs };
  } catch (error) {
    if (error instanceof SourceGuardError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return failure('inspection_error', 'history', homeIndex);
  }
}

/** Changed shared history is inconclusive and fails acceptance; its writer is unknown. */
export function acceptanceSourceGuard(codexHomes: readonly string[]) {
  if (!codexHomes.length || codexHomes.length > 2) failure('invalid_input', 'input', null);
  const homes: Array<{
    path: string;
    identity: string;
    history: Metadata;
    index: number;
    aliases: Array<{ path: string; index: number }>;
  }> = [];
  for (const [index, input] of codexHomes.entries()) {
    const path = resolve(input);
    let info;
    try {
      info = lstatSync(path, { bigint: true });
    } catch {
      failure('inspection_error', 'home', index);
    }
    if (!info.isDirectory() || info.isSymbolicLink()) failure('unsafe_home', 'home', index);
    const identity = `${info.dev}:${info.ino}`;
    const existing = homes.find((home) => home.identity === identity);
    if (existing) existing.aliases.push({ path, index });
    else
      homes.push({
        path,
        identity,
        history: metadata(join(path, 'history.jsonl'), index),
        index,
        aliases: [{ path, index }],
      });
  }
  return (threadIds: readonly string[]) => {
    if (!threadIds.length || !threadIds.every((id) => /^[a-zA-Z0-9_-]+$/.test(id)))
      failure('invalid_input', 'input', null);
    let entries = 0;
    const inspection: SourceInspection = {
      historyHomesChecked: 0,
      historyHomesTotal: homes.length,
      changedHistories: [],
      testThreadFiles: 'incomplete',
    };
    try {
      for (const home of homes) {
        for (const alias of home.aliases) {
          let info;
          try {
            info = lstatSync(alias.path, { bigint: true });
          } catch {
            failure('inspection_error', 'home', alias.index);
          }
          if (!info.isDirectory() || info.isSymbolicLink())
            failure('unsafe_home', 'home', alias.index);
          if (`${info.dev}:${info.ino}` !== home.identity)
            failure('home_changed', 'home', alias.index);
        }
        const current = metadata(join(home.path, 'history.jsonl'), home.index);
        const previous = home.history;
        const changes = {
          presence: (current === null) !== (previous === null),
          inode: current !== null && previous !== null && current.inode !== previous.inode,
          size: current !== null && previous !== null && current.size !== previous.size,
          mtime: current !== null && previous !== null && current.mtime !== previous.mtime,
          ctime: current !== null && previous !== null && current.ctime !== previous.ctime,
        };
        inspection.historyHomesChecked++;
        if (Object.values(changes).some(Boolean))
          inspection.changedHistories.push({ homeIndex: home.index, fields: changes });
        // Shared history drift must not mask unsafe paths or a materialized test thread.
        const inspect = (
          directory: string,
          source: 'sessions' | 'archived_sessions',
          depth: number,
        ) => {
          if (depth > depthLimit) failure('depth_exceeded', source, home.index, entries, depth);
          let info;
          try {
            info = lstatSync(directory);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT' && depth === 0) return;
            failure('inspection_error', source, home.index, entries, depth);
          }
          if (!info.isDirectory() || info.isSymbolicLink())
            failure('unsafe_directory', source, home.index, entries, depth);
          let children;
          try {
            children = readdirSync(directory, { withFileTypes: true });
          } catch {
            failure('inspection_error', source, home.index, entries, depth);
          }
          for (const entry of children) {
            if (++entries > entryLimit)
              failure('budget_exceeded', source, home.index, entries, depth);
            if (entry.isSymbolicLink()) failure('unsafe_entry', source, home.index, entries, depth);
            if (threadIds.some((id) => entry.name.includes(id)))
              failure('thread_materialized', source, home.index, entries, depth);
            if (entry.isDirectory()) inspect(join(directory, entry.name), source, depth + 1);
          }
        };
        inspect(join(home.path, 'sessions'), 'sessions', 0);
        inspect(join(home.path, 'archived_sessions'), 'archived_sessions', 0);
      }
      inspection.testThreadFiles = 'not-found';
      const firstChanged = inspection.changedHistories[0];
      if (firstChanged)
        failure(
          'history_changed',
          'history',
          firstChanged.homeIndex,
          entries,
          null,
          firstChanged.fields,
        );
    } catch (error) {
      const diagnostic = sourceDiagnostic(error);
      if (diagnostic.reason === 'thread_materialized') inspection.testThreadFiles = 'found';
      throw new SourceGuardError(diagnostic, inspection);
    }
  };
}
