// Synthetic, disposable SQLite fixture for the future Analytics worker path.
// Never points at ~/.orqst or a native Codex session directory.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@orqst/database';

export interface AnalyticsWorkerFixture {
  directory: string;
  database: string;
  store: Store;
  close: () => void;
}

/**
 * Creates a file-backed Store because a worker thread cannot share the
 * `:memory:` database used by the legacy synchronous tests. The writer stays
 * open so the test can verify that a second read-only WAL connection sees
 * committed rows before the worker is started.
 */
export function createAnalyticsWorkerFixture(): AnalyticsWorkerFixture {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-analytics-worker-'));
  const database = join(directory, 'orqst.db');
  const store = new Store(database);
  // The reader requires a canonical path. On macOS tmpdir() is under /var,
  // whose canonical form is /private/var, so expose the real path for workers.
  const canonicalDatabase = realpathSync(database);
  let closed = false;
  return {
    directory,
    database: canonicalDatabase,
    store,
    close: () => {
      if (closed) return;
      closed = true;
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
