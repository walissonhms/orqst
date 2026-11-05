// Synthetic local observer records and private preferences only; no provider or credentials.
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  appendFile,
  rename,
  symlink,
  rm,
  chmod,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CodexObserver } from '@orqst/adapter-codex';
import { Store } from '@orqst/database';
import { accountLimitsSchema, featureNativeRequestSchema } from '@orqst/protocol';
import { meta, record, token } from './fixtures.js';
import {
  readObservedCodexLimits,
  parseCodexRateLimitRecord,
} from '../packages/core/src/terminal/codex-account-limits.js';
import { withTerminalPreferences } from '../packages/core/src/terminal/layout-database.js';
import { terminalAccountLimits } from '../packages/core/src/terminal/account-limits.js';

const line = (value: unknown) => JSON.stringify(value) + '\n';
const timestamp = '2026-11-02T15:00:00.000Z';
const observed = Date.parse(timestamp) + 2000;
function quota(percent: number) {
  return record('event_msg', {
    type: 'token_count',
    info: { total_token_usage: token(100, 20) },
    rate_limits: {
      plan_type: 'pro',
      primary: { used_percent: percent, window_minutes: 300, resets_in_seconds: 100 },
      secondary: { used_percent: 0, window_minutes: 10080, resets_at: 1793632500 },
    },
  });
}

test('only exact indexed source bytes project bounded limits, without modifying the rollout', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'orqst-synthetic-limits-')));
  const root = join(dir, 'sessions');
  const core = join(dir, 'core');
  await mkdir(root, { mode: 0o700 });
  await mkdir(core, { mode: 0o700 });
  const file = join(root, 'rollout.jsonl');
  const original = line(meta()) + line(quota(24.5));
  await writeFile(file, original);
  const store = new Store(join(core, 'orqst.db'));
  const observer = new CodexObserver({ root, store });
  try {
    await observer.scan();
    const value = readObservedCodexLimits(join(core, 'orqst.db'), root, observed);
    assert.deepEqual(value, {
      updatedAt: Date.parse(timestamp),
      plan: 'pro',
      windows: [
        {
          id: 'window-300m',
          label: '5h',
          usedPercent: 24.5,
          resetsAt: Date.parse(timestamp) + 100000,
        },
        { id: 'window-10080m', label: '7d', usedPercent: 0, resetsAt: 1793632500000 },
      ],
    });
    assert.equal(await readFile(file, 'utf8'), original);
    // Equal source timestamps with different values have no proved order.
    await appendFile(file, line(quota(40)));
    await observer.scan();
    assert.equal(readObservedCodexLimits(join(core, 'orqst.db'), root, observed), undefined);
    // Even a correctly shaped replacement cannot inherit the old observer hash.
    await writeFile(file, line(meta()) + line(quota(80)));
    assert.equal(readObservedCodexLimits(join(core, 'orqst.db'), root, observed), undefined);
    await rename(file, join(dir, 'outside.jsonl'));
    await symlink(join(dir, 'outside.jsonl'), file);
    assert.equal(readObservedCodexLimits(join(core, 'orqst.db'), root, observed), undefined);
  } finally {
    await observer.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('partial, future and unverified provider data never become zero or a valid account', () => {
  assert.deepEqual(
    parseCodexRateLimitRecord(quota(101), observed)?.windows.map((window) => window.id),
    ['window-10080m'],
  );
  assert.equal(parseCodexRateLimitRecord(quota(10), Date.parse(timestamp) - 1), undefined);
  assert.equal(
    parseCodexRateLimitRecord(
      record('event_msg', {
        type: 'token_count',
        rate_limits: {
          limit_id: 'codex_other',
          primary: { used_percent: 30, window_minutes: 300 },
        },
      }),
      observed,
    ),
    undefined,
  );
  assert.equal(
    parseCodexRateLimitRecord(
      record('event_msg', { type: 'token_count', rate_limits: { primary: { used_percent: 30 } } }),
      observed,
    ),
    undefined,
  );
  const missing = record('event_msg', {
    type: 'token_count',
    rate_limits: { primary: { used_percent: Number.NaN }, secondary: { used_percent: Number.NaN } },
  });
  assert.equal(parseCodexRateLimitRecord(missing, observed), undefined);
  assert.equal(
    accountLimitsSchema.safeParse({
      readAt: 5,
      accounts: [
        { id: 'x', provider: 'codex', index: 1, locked: false, updatedAt: 6, windows: [] },
      ],
    }).success,
    false,
  );
  assert.equal(
    featureNativeRequestSchema.safeParse({
      contractVersion: 1,
      generation: 0,
      action: 'accountLimits',
      command: 'lock',
      accountId: '../x',
    }).success,
    false,
  );
});

test('account lock persists in the existing private preferences database', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orqst-synthetic-account-lock-'));
  await chmod(dir, 0o700);
  try {
    assert.equal(
      withTerminalPreferences(dir, (store) => store.accountLimitLocks().read('codex-default')),
      false,
    );
    withTerminalPreferences(dir, (store) => store.accountLimitLocks().write('codex-default', true));
    assert.equal(
      withTerminalPreferences(dir, (store) => store.accountLimitLocks().read('codex-default')),
      true,
    );
    withTerminalPreferences(dir, (store) =>
      store.accountLimitLocks().write('codex-default', false),
    );
    assert.equal(
      withTerminalPreferences(dir, (store) => store.accountLimitLocks().read('codex-default')),
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('default account facade joins only the configured observer root and persists locks', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'orqst-synthetic-profile-')));
  const home = join(dir, 'home');
  const sessions = join(home, '.codex', 'sessions');
  const data = join(dir, 'app');
  const managed = join(data, 'managed-agents');
  const core = join(data, 'core');
  await mkdir(sessions, { recursive: true, mode: 0o700 });
  await mkdir(managed, { recursive: true, mode: 0o700 });
  await mkdir(core, { mode: 0o700 });
  await writeFile(join(sessions, 'rollout.jsonl'), line(meta()) + line(quota(42)));
  const store = new Store(join(core, 'orqst.db'));
  const observer = new CodexObserver({ root: sessions, store });
  try {
    await observer.scan();
    const facade = terminalAccountLimits(managed, {}, home);
    assert.equal(facade.read().accounts[0]?.windows[0]?.usedPercent, 42);
    assert.equal(facade.update('codex-default', true).accounts[0]?.locked, true);
    assert.equal(terminalAccountLimits(managed, {}, home).read().accounts[0]?.locked, true);
    assert.equal(facade.update('codex-default', false).accounts[0]?.locked, false);
    assert.throws(() => facade.update('foreign', true));
    const other = join(dir, 'other');
    await mkdir(other, { mode: 0o700 });
    assert.deepEqual(
      terminalAccountLimits(managed, { ORQST_CODEX_SESSIONS: other }, home).read().accounts,
      [],
    );
  } finally {
    await observer.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
