// Synthetic private metadata only; no provider, native application or process is started.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Store, TERMINAL_LAYOUT_LIMITS } from '@orqst/database';
import { terminalLayoutRecordSchema } from '@orqst/protocol';
import {
  legacyTerminalLayoutStore,
  terminalLayoutStore,
} from '../apps/desktop/src/terminal-layout-store.js';
import { terminalLayoutDatabase } from '../packages/core/src/terminal/layout-database.js';
import type { TerminalLayoutPreferences } from '../apps/desktop/src/terminal-layout.js';

const state: TerminalLayoutPreferences = {
  axis: 'rows',
  columns: 3,
  percent: 63,
  order: [2, 0, 1],
  shown: [0, 2],
  active: 2,
  maximized: 2,
  names: ['SYNTHETIC Frontend', '', 'SYNTHETIC Reviewer'],
};
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-layout-sqlite-')));
  const identities = Array.from({ length: 3 }, () => randomUUID());
  const backend = terminalLayoutDatabase(root, identities);
  const client = (ids: string[]) => {
    const db = terminalLayoutDatabase(root, ids);
    return terminalLayoutStore(root, ids, {
      read: async () => db.read(),
      save: async (record) => db.save(record),
      import: async (record) => db.import(record),
    });
  };
  const store = client(identities);
  const directory = join(root, 'terminal-layouts');
  const file = join(directory, 'preferences.sqlite');
  return {
    backend,
    client,
    root,
    identities,
    store,
    directory,
    file,
    legacy: legacyTerminalLayoutStore(root, identities),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('SQLite imports legacy layout exactly once, preserving original bytes and stable UUID mapping', async () => {
  const f = fixture();
  try {
    f.legacy.save(state);
    const legacyFile = join(
      f.directory,
      readdirSync(f.directory).find((name) => name.endsWith('.json'))!,
    );
    const bytes = readFileSync(legacyFile);
    const modified = statSync(legacyFile).mtimeMs;
    assert.deepEqual(await f.store.load(), state);
    assert.equal(lstatSync(f.file).mode & 0o777, 0o600);
    assert.equal(lstatSync(f.directory).mode & 0o777, 0o700);
    assert.deepEqual(readFileSync(legacyFile), bytes);
    assert.equal(statSync(legacyFile).mtimeMs, modified);
    await f.store.save({ ...state, percent: 37 });
    writeFileSync(legacyFile, '{'); // SQLite, not stale or corrupt JSON, is authoritative now.
    const reopened = (await f.client([...f.identities].reverse()).load())!;
    assert.equal(reopened.percent, 37);
    assert.deepEqual(reopened.order, [0, 2, 1]);
    assert.deepEqual(reopened.names, ['SYNTHETIC Reviewer', '', 'SYNTHETIC Frontend']);
    assert.equal(reopened.active, 0);
    assert.equal(await f.client([randomUUID(), ...f.identities.slice(1)]).load(), undefined);
    const db = new DatabaseSync(f.file, { readOnly: true });
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((row) => row.name);
      assert.ok(tables.includes('terminal_layouts'));
      assert.ok(!tables.includes('terminal_attempts'));
      assert.ok(!tables.includes('terminal_owner'));
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM terminal_layouts').get()?.count, 1);
    } finally {
      db.close();
    }
  } finally {
    f.close();
  }
});

test('fresh SQLite saves produce no JSON and corrupt JSON import is atomic and non-destructive', async () => {
  const f = fixture();
  try {
    assert.equal(await f.store.load(), undefined);
    await f.store.save(state);
    assert.deepEqual(await f.store.load(), state);
    assert.ok(!readdirSync(f.directory).some((name) => name.endsWith('.json')));
    const other = Array.from({ length: 3 }, () => randomUUID());
    const legacy = legacyTerminalLayoutStore(f.root, other);
    legacy.save(state);
    const legacyFile = join(
      f.directory,
      readdirSync(f.directory).find((name) => name.endsWith('.json'))!,
    );
    writeFileSync(legacyFile, '{SYNTHETIC-CORRUPT');
    const before = readFileSync(legacyFile);
    const next = f.client(other);
    await assert.rejects(() => next.load());
    assert.deepEqual(readFileSync(legacyFile), before);
    legacy.save(state);
    assert.deepEqual(await next.load(), state); // Failed import did not leave a successful marker/partial row.
    assert.deepEqual(await f.store.load(), state);
  } finally {
    f.close();
  }
});

test('database, sidecars, directory and hardlinks cannot redirect metadata writes', async () => {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const f = fixture();
    try {
      await f.store.save(state);
      const outside = join(f.root, 'untouched');
      writeFileSync(outside, 'SYNTHETIC-UNCHANGED', { mode: 0o600 });
      if (!suffix) unlinkSync(f.file);
      symlinkSync(outside, f.file + suffix);
      await assert.rejects(() => f.store.load());
      await assert.rejects(() => f.store.save(state));
      assert.equal(readFileSync(outside, 'utf8'), 'SYNTHETIC-UNCHANGED');
    } finally {
      f.close();
    }
  }
  const f = fixture();
  try {
    await f.store.save(state);
    chmodSync(f.file, 0o644);
    await assert.rejects(() => f.store.load());
    await assert.rejects(() => f.store.save(state));
    chmodSync(f.file, 0o600);
    const alias = join(f.root, 'hardlink');
    linkSync(f.file, alias);
    await assert.rejects(() => f.store.save(state));
    unlinkSync(alias);
    rmSync(f.directory, { recursive: true });
    symlinkSync(f.root, f.directory);
    await assert.rejects(() => f.store.load());
  } finally {
    f.close();
  }
});

test('additive layout schema preserves settings and lifecycle rows and rejects future versions', async () => {
  const f = fixture();
  try {
    const original = new Store(f.file);
    original.setSetting('synthetic-existing-setting', { preserved: true });
    original.close();
    const before = new DatabaseSync(f.file);
    before.exec(
      "CREATE TABLE synthetic_ownership_evidence (state TEXT); INSERT INTO synthetic_ownership_evidence VALUES ('ownership_lost')",
    );
    const version = before.prepare('PRAGMA user_version').get()?.user_version;
    before.close();
    await f.store.save(state);
    const db = new DatabaseSync(f.file);
    try {
      assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, version);
      assert.equal(
        db.prepare('SELECT state FROM synthetic_ownership_evidence').get()?.state,
        'ownership_lost',
      );
      assert.equal(
        db.prepare('SELECT value FROM settings WHERE key=?').get('synthetic-existing-setting')
          ?.value,
        '{"preserved":true}',
      );
      db.exec('UPDATE terminal_layout_schema SET version=999');
    } finally {
      db.close();
    }
    await assert.rejects(() => f.store.load(), /Unsupported terminal layout schema/);
    await assert.rejects(() => f.store.save(state), /Unsupported terminal layout schema/);
    const verify = new DatabaseSync(f.file, { readOnly: true });
    assert.equal(verify.prepare('SELECT version FROM terminal_layout_schema').get()?.version, 999);
    assert.equal(verify.prepare('SELECT COUNT(*) AS count FROM terminal_layouts').get()?.count, 1);
    verify.close();
  } finally {
    f.close();
  }
});

test('layout contracts reject foreign, duplicate and process fields without replacing valid preferences', async () => {
  const f = fixture();
  try {
    await f.store.save(state);
    for (const input of [
      { ...state, order: [0, 0, 2] },
      { ...state, shown: [3] },
      { ...state, active: 7 },
      { ...state, names: ['bad\u202e', '', ''] },
    ]) {
      await assert.rejects(() => f.store.save(input));
      assert.deepEqual(await f.store.load(), state);
    }
    const valid = {
      version: 1,
      axis: 'columns',
      columns: 2,
      percent: 50,
      order: f.identities,
      shown: f.identities,
      active: f.identities[0],
      maximized: null,
      names: [],
    };
    for (const patch of [
      { instanceId: randomUUID() },
      { command: 'start' },
      { grants: [] },
      { shown: [randomUUID()] },
      {
        names: [
          { id: f.identities[0], name: 'x' },
          { id: f.identities[0], name: 'y' },
        ],
      },
    ])
      assert.equal(terminalLayoutRecordSchema.safeParse({ ...valid, ...patch }).success, false);
    const store = new Store(':memory:');
    try {
      const layouts = store.terminalLayouts();
      for (let index = 0; index < TERMINAL_LAYOUT_LIMITS.records; index++) {
        const id = randomUUID();
        layouts.save(
          [id],
          terminalLayoutRecordSchema.parse({ ...valid, order: [id], shown: [id], active: id }),
        );
      }
      const id = randomUUID();
      assert.throws(
        () =>
          layouts.save(
            [id],
            terminalLayoutRecordSchema.parse({ ...valid, order: [id], shown: [id], active: id }),
          ),
        /capacity/,
      );
    } finally {
      store.close();
    }
  } finally {
    f.close();
  }
});
