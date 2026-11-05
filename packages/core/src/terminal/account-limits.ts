import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { withTerminalPreferences } from './layout-database.js';
import { defaultCodexAccountLimits, readObservedCodexLimits } from './codex-account-limits.js';

/** Data-dir-owned profile preference and observer-only projection. No credentials or network. */
export function terminalAccountLimits(
  directory: string,
  environment: NodeJS.ProcessEnv = process.env,
  home = homedir(),
) {
  const accountId = 'codex-default';
  const defaultRoot = join(home, '.codex', 'sessions');
  const observerRoot = resolve(
    environment.ORQST_CODEX_SESSIONS ??
      join(environment.CODEX_HOME ?? join(home, '.codex'), 'sessions'),
  );
  const database = join(dirname(realpathSync(directory)), 'core', 'orqst.db');
  const locks = () =>
    withTerminalPreferences(directory, (store) => store.accountLimitLocks().read(accountId));
  const read = () => {
    const readAt = Date.now();
    let result: ReturnType<typeof readObservedCodexLimits>;
    try {
      // A custom observer root has no proven default-profile identity.
      if (realpathSync(observerRoot) === realpathSync(defaultRoot))
        result = readObservedCodexLimits(database, observerRoot, readAt);
    } catch {
      // Missing or inaccessible observer data is unavailable, never an empty quota.
    }
    return defaultCodexAccountLimits(readAt, locks(), result);
  };
  const update = (id: string, locked: boolean) => {
    if (id !== accountId) throw new Error('Unknown account');
    withTerminalPreferences(directory, (store) => store.accountLimitLocks().write(id, locked));
    return read();
  };
  return { read, update };
}
