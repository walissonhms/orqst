// SYNTHETIC metadata/authority fixtures. No provider, credentials, source sessions or PTY execution.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { terminalTeamSchema, type TerminalTeam } from '@orqst/protocol';
import { Store } from '@orqst/database';
import { terminalTeamDatabase } from '../packages/core/src/terminal/team-database.js';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';

function fixture(count = 8) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-team-')));
  chmodSync(root, 0o700);
  const ids = Array.from({ length: count }, () => randomUUID());
  const workspace = terminalDigest('SYNTHETIC project');
  const configuration: TerminalTeam = {
    version: 1,
    name: 'SYNTHETIC team',
    members: ids.map((terminalId, index) => ({
      terminalId,
      name: `SYNTHETIC ${index}`,
      handle: `member-${index}`,
      role: index === 0 ? 'orchestrator' : 'worker',
      allowedTargetTerminalIds: ids.slice(index + 1, index + 2),
    })),
  };
  return {
    root,
    ids,
    workspace,
    configuration,
    db: terminalTeamDatabase(root, ids, workspace),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}
for (const count of [1, 2, 3, 6, 8])
  test(`SQLite preserves ${count} stable members without restoring authority`, () => {
    const f = fixture(count);
    try {
      mkdirSync(join(f.root, 'terminal-layouts'), { mode: 0o700 });
      const original = join(f.root, 'terminal-layouts', 'original.json');
      writeFileSync(original, 'SYNTHETIC original bytes\n', { mode: 0o600 });
      assert.deepEqual(f.db.read(), { revision: 0, configuration: null });
      const saved = f.db.save({ expectedRevision: 0, configuration: f.configuration });
      assert.equal(saved.revision, 1);
      const reopened = terminalTeamDatabase(f.root, [...f.ids].reverse(), f.workspace);
      assert.deepEqual(reopened.read(), saved);
      assert.deepEqual(
        terminalTeamDatabase(f.root, f.ids, terminalDigest('SYNTHETIC other project')).read(),
        { revision: 0, configuration: null },
      );
      assert.throws(
        () => reopened.save({ expectedRevision: 0, configuration: f.configuration }),
        /Stale/,
      );
      assert.deepEqual(f.db.read(), saved);
      assert.equal(readFileSync(original, 'utf8'), 'SYNTHETIC original bytes\n');
      const raw = new DatabaseSync(join(f.root, 'terminal-layouts/preferences.sqlite'));
      try {
        const tables = raw
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map((r) => String(r.name));
        assert.ok(
          !tables.some((name) => /^(terminal_(owners|attempts)|communication_)/.test(name)),
        );
      } finally {
        raw.close();
      }
    } finally {
      f.close();
    }
  });

test('team policy rejects duplicate, foreign, self, cyclic and authority-bearing metadata atomically', () => {
  const f = fixture(3);
  try {
    const state = f.db.save({ expectedRevision: 0, configuration: f.configuration });
    const invalid = [
      { ...f.configuration, pid: 123 },
      { ...f.configuration, version: 2 },
      { ...f.configuration, members: [...f.configuration.members, f.configuration.members[0]] },
      {
        ...f.configuration,
        members: f.configuration.members.map((m) => ({ ...m, handle: 'duplicate' })),
      },
      {
        ...f.configuration,
        members: f.configuration.members.map((m) => ({
          ...m,
          allowedTargetTerminalIds: [m.terminalId],
        })),
      },
      {
        ...f.configuration,
        members: f.configuration.members.map((m) => ({
          ...m,
          allowedTargetTerminalIds: [randomUUID()],
        })),
      },
      {
        ...f.configuration,
        members: f.configuration.members.map((m, i) => ({
          ...m,
          allowedTargetTerminalIds: [f.ids[(i + 1) % 3]],
        })),
      },
      { ...f.configuration, members: f.configuration.members.map((m) => ({ ...m, grants: [] })) },
    ];
    for (const raw of invalid) {
      assert.equal(terminalTeamSchema.safeParse(raw).success, false);
      assert.throws(() => f.db.save({ expectedRevision: 1, configuration: raw as TerminalTeam }));
      assert.deepEqual(f.db.read(), state);
    }
    const other = fixture(3);
    try {
      assert.throws(
        () => f.db.save({ expectedRevision: 1, configuration: other.configuration }),
        /selection/,
      );
    } finally {
      other.close();
    }
  } finally {
    f.close();
  }
});

test('future schema/capacity fail closed; shared layout Store remains independent', () => {
  const f = fixture(1);
  try {
    f.db.save({ expectedRevision: 0, configuration: f.configuration });
    const file = join(f.root, 'terminal-layouts/preferences.sqlite');
    const raw = new DatabaseSync(file);
    raw.exec('UPDATE terminal_team_schema SET version=2');
    raw.close();
    assert.throws(() => f.db.read(), /Unsupported/);
    const store = new Store(file);
    try {
      assert.equal(store.terminalLayouts().read(f.ids), undefined);
    } finally {
      store.close();
    }
    const db = new DatabaseSync(file);
    db.exec('UPDATE terminal_team_schema SET version=1');
    const insert = db.prepare('INSERT INTO terminal_teams VALUES (?,?,?)');
    for (let i = 1; i < 1024; i++) insert.run(`SYNTHETIC-${i}`, 1, '{}');
    db.close();
    const otherId = randomUUID();
    const config = {
      ...f.configuration,
      members: [{ ...f.configuration.members[0]!, terminalId: otherId }],
    };
    assert.throws(
      () =>
        terminalTeamDatabase(f.root, [otherId], f.workspace).save({
          expectedRevision: 0,
          configuration: config,
        }),
      /capacity/,
    );
    assert.equal(f.db.save({ expectedRevision: 1, configuration: f.configuration }).revision, 2);
  } finally {
    f.close();
  }
});
