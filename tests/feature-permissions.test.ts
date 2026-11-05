// SYNTHETIC policies and disposable SQLite only. No app, provider or native session.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Store, FeaturePermissionRevisionConflict } from '@orqst/database';
import {
  featurePermissionConfigurationSchema,
  featurePermissionStateSchema,
  type FeaturePermissionOperation,
} from '@orqst/protocol';
import { featureConfigurationDatabase } from '../packages/core/src/terminal/feature-configuration.js';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-SYNTHETIC-permissions-'));
  const file = join(directory, 'synthetic.sqlite');
  const store = new Store(file);
  const features = store.features();
  let feature = features.create({ workspaceId: 'synthetic', name: 'SYNTHETIC Feature' });
  for (let index = 0; index < 3; index++)
    feature = features.assignTerminal(
      { workspaceId: feature.workspaceId, featureId: feature.featureId },
      randomUUID(),
      feature.revision,
    );
  const [source, target, third] = feature.terminalIds as [string, string, string];
  const permissions = store.featurePermissions();
  const policy = (operations: FeaturePermissionOperation[] = ['delegate', 'execute', 'view']) => ({
    schemaVersion: 1 as const,
    rules: [{ sourceTerminalId: source, targetTerminalId: target, operations }],
  });
  const sql = <T>(action: (db: DatabaseSync) => T) => {
    const db = new DatabaseSync(file);
    try {
      return action(db);
    } finally {
      db.close();
    }
  };
  return {
    directory,
    file,
    store,
    features,
    feature,
    scope: { workspaceId: feature.workspaceId, featureId: feature.featureId },
    source,
    target,
    third,
    permissions,
    policy,
    sql,
    close: () => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
const withFixture = (run: (f: ReturnType<typeof fixture>) => void) => () => {
  const f = fixture();
  try {
    run(f);
  } finally {
    f.close();
  }
};

test(
  'absent policy is revision zero/null; empty saved policy is an explicit revocation',
  withFixture((f) => {
    assert.deepEqual(f.permissions.read(f.scope), {
      schemaVersion: 1,
      workspaceId: 'synthetic',
      featureId: f.feature.featureId,
      revision: 0,
      configuration: null,
    });
    const saved = f.permissions.save(f.scope, 'native-owner', {
      expectedRevision: 0,
      configuration: { schemaVersion: 1, rules: [] },
    });
    assert.equal(saved.revision, 1);
    assert.deepEqual(saved.configuration?.rules, []);
    const events = f.permissions.events(f.scope);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.actorId, 'native-owner');
    assert.equal(events[0]?.previousRevision, 0);
    assert.equal(events[0]?.previousConfiguration, null);
    assert.deepEqual(events[0]?.configuration, saved.configuration);
  }),
);

test(
  'policy persists through rename/reopen, independently of Feature editorial revision',
  withFixture((f) => {
    const saved = f.permissions.save(f.scope, 'native-owner', {
      expectedRevision: 0,
      configuration: f.policy(),
    });
    const renamed = f.features.update(f.scope, {
      expectedRevision: f.feature.revision,
      name: 'SYNTHETIC renamed',
    });
    assert.equal(renamed.featureId, f.feature.featureId);
    const reopened = new Store(f.file);
    try {
      assert.deepEqual(reopened.featurePermissions().read(f.scope), saved);
      assert.deepEqual(reopened.featurePermissions().events(f.scope)[0]?.configuration, f.policy());
    } finally {
      reopened.close();
    }
  }),
);

test(
  'independent writers use CAS; stale save cannot change policy or append audit',
  withFixture((f) => {
    const second = new Store(f.file);
    try {
      const competing = second.featurePermissions();
      assert.equal(competing.read(f.scope).revision, 0);
      f.permissions.save(f.scope, 'native-owner', {
        expectedRevision: 0,
        configuration: f.policy(),
      });
      assert.throws(
        () =>
          competing.save(f.scope, 'other-native-owner', {
            expectedRevision: 0,
            configuration: f.policy([]),
          }),
        FeaturePermissionRevisionConflict,
      );
      assert.equal(competing.read(f.scope).revision, 1);
      assert.equal(competing.events(f.scope).length, 1);
    } finally {
      second.close();
    }
  }),
);

test(
  'audit insertion failure atomically rolls back policy and revision',
  withFixture((f) => {
    f.permissions.save(f.scope, 'native-owner', { expectedRevision: 0, configuration: f.policy() });
    f.sql((db) =>
      db.exec(
        "CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON feature_permission_events BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END",
      ),
    );
    assert.throws(
      () =>
        f.permissions.save(f.scope, 'native-owner', {
          expectedRevision: 1,
          configuration: f.policy([]),
        }),
      /synthetic audit failure/,
    );
    assert.equal(f.permissions.read(f.scope).revision, 1);
    assert.deepEqual(f.permissions.read(f.scope).configuration, f.policy());
    assert.equal(f.permissions.events(f.scope).length, 1);
  }),
);

test('additive DDL rolls back on failure and disposable downgrade preserves old data/user_version', () => {
  const store = new Store(':memory:');
  try {
    store.setSetting('synthetic-preserved', { value: 42 });
    assert.throws(
      () =>
        store.transaction(() => {
          store.featurePermissions();
          throw new Error('synthetic rollback');
        }),
      /rollback/,
    );
    assert.deepEqual(store.setting('synthetic-preserved', null), { value: 42 });
    // The next initialization must still succeed after transactional DDL rollback.
    store.featurePermissions();
  } finally {
    store.close();
  }
  const f = fixture();
  try {
    f.store.setSetting('synthetic-preserved', { value: 42 });
    const before = f.sql((db) => ({
      version: db.prepare('PRAGMA user_version').get(),
      feature: db.prepare('SELECT * FROM features').all(),
      assignments: db.prepare('SELECT * FROM feature_terminal_assignments').all(),
    }));
    f.permissions.save(f.scope, 'native-owner', { expectedRevision: 0, configuration: f.policy() });
    // Test-only removal of precisely the new extension, never a product downgrade path.
    f.sql((db) =>
      db.exec(
        'BEGIN; DROP TABLE feature_permission_events; DROP TABLE feature_permissions; DROP TABLE feature_permission_schema; COMMIT;',
      ),
    );
    const after = f.sql((db) => ({
      version: db.prepare('PRAGMA user_version').get(),
      feature: db.prepare('SELECT * FROM features').all(),
      assignments: db.prepare('SELECT * FROM feature_terminal_assignments').all(),
    }));
    assert.deepEqual(after, before);
    assert.deepEqual(f.store.setting('synthetic-preserved', null), { value: 42 });
  } finally {
    f.close();
  }
});

test(
  'strict policy rejects duplicate pairs/operations, self, cycles, future versions and excess rules',
  withFixture((f) => {
    const rule = f.policy().rules[0]!;
    for (const configuration of [
      { schemaVersion: 2, rules: [] },
      { ...f.policy(), role: 'orchestrator' },
      { schemaVersion: 1, rules: [rule, rule] },
      { schemaVersion: 1, rules: [{ ...rule, operations: ['view', 'view'] }] },
      { schemaVersion: 1, rules: [{ ...rule, targetTerminalId: f.source }] },
      {
        schemaVersion: 1,
        rules: [rule, { ...rule, sourceTerminalId: f.target, targetTerminalId: f.source }],
      },
      { schemaVersion: 1, rules: Array.from({ length: 57 }, () => rule) },
      { schemaVersion: 1, rules: [{ ...rule, operations: ['shell'] }] },
    ])
      assert.equal(featurePermissionConfigurationSchema.safeParse(configuration).success, false);
    assert.equal(
      featurePermissionStateSchema.safeParse({ ...f.permissions.read(f.scope), revision: 1 })
        .success,
      false,
    );
    assert.throws(
      () =>
        f.permissions.save(f.scope, 'native-owner', {
          expectedRevision: Number.MAX_SAFE_INTEGER,
          configuration: f.policy(),
        }),
      /Stale/,
    );
    assert.throws(() =>
      f.permissions.save(f.scope, '../untrusted', {
        expectedRevision: 0,
        configuration: f.policy(),
      }),
    );
  }),
);

test(
  'wrong workspace, unknown/archived Feature and foreign terminal deny without mutation',
  withFixture((f) => {
    const archived = f.features.create({
      workspaceId: 'synthetic',
      name: 'SYNTHETIC archived',
      status: 'archived',
    });
    for (const scope of [
      { ...f.scope, workspaceId: 'foreign' },
      { ...f.scope, featureId: randomUUID() },
      { workspaceId: archived.workspaceId, featureId: archived.featureId },
    ]) {
      assert.throws(() => f.permissions.read(scope));
      assert.throws(() =>
        f.permissions.save(scope, 'native-owner', {
          expectedRevision: 0,
          configuration: f.policy(),
        }),
      );
    }
    assert.throws(
      () =>
        f.permissions.save(f.scope, 'native-owner', {
          expectedRevision: 0,
          configuration: {
            schemaVersion: 1,
            rules: [{ ...f.policy().rules[0]!, targetTerminalId: randomUUID() }],
          },
        }),
      /Foreign/,
    );
    assert.equal(f.permissions.read(f.scope).revision, 0);
    assert.equal(f.permissions.events(f.scope).length, 0);
  }),
);

for (const corruption of [
  'future-schema',
  'future-policy',
  'invalid-policy',
  'workspace',
  'revision',
  'foreign-terminal',
  'missing-row',
  'missing-audit',
  'audit-revision',
] as const)
  test(
    `persisted ${corruption} never becomes neutral`,
    withFixture((f) => {
      f.permissions.save(f.scope, 'native-owner', {
        expectedRevision: 0,
        configuration: f.policy(),
      });
      f.sql((db) => {
        if (corruption === 'missing-row') db.exec('DELETE FROM feature_permissions');
        else if (corruption === 'missing-audit') db.exec('DELETE FROM feature_permission_events');
        else if (corruption === 'audit-revision')
          db.exec(
            "UPDATE feature_permission_events SET metadata=json_set(metadata, '$.revision',2, '$.previousRevision',1, '$.previousConfiguration',json_extract(metadata,'$.configuration'))",
          );
        else if (corruption === 'future-schema')
          db.exec('UPDATE feature_permission_schema SET version=2');
        else if (corruption === 'workspace')
          db.exec("UPDATE feature_permissions SET workspace_id='foreign'");
        else if (corruption === 'revision')
          db.exec('UPDATE feature_permissions SET revision=9007199254740992');
        else
          db.prepare('UPDATE feature_permissions SET metadata=?').run(
            JSON.stringify(
              corruption === 'future-policy'
                ? { schemaVersion: 2, rules: [] }
                : corruption === 'invalid-policy'
                  ? { schemaVersion: 1 }
                  : {
                      schemaVersion: 1,
                      rules: [{ ...f.policy().rules[0]!, targetTerminalId: randomUUID() }],
                    },
            ),
          );
      });
      assert.throws(() => f.permissions.read(f.scope));
      assert.throws(() =>
        f.permissions.save(f.scope, 'native-owner', {
          expectedRevision: 1,
          configuration: f.policy(),
        }),
      );
    }),
  );

test(
  'corrupted audit scope/revision fails its versioned schema rather than manufacturing events',
  withFixture((f) => {
    f.permissions.save(f.scope, 'native-owner', { expectedRevision: 0, configuration: f.policy() });
    f.sql((db) =>
      db.exec(
        "UPDATE feature_permission_events SET metadata=json_set(metadata, '$.workspaceId','foreign')",
      ),
    );
    assert.throws(() => f.permissions.events(f.scope), /scope|inconsistent/);
    f.sql((db) =>
      db.exec(
        "UPDATE feature_permission_events SET metadata=json_set(metadata, '$.workspaceId','synthetic', '$.revision',5)",
      ),
    );
    assert.throws(() => f.permissions.events(f.scope), /revision/);
  }),
);

test(
  'missing earlier audit history denies rather than accepting a valid latest revision',
  withFixture((f) => {
    f.permissions.save(f.scope, 'native-owner', { expectedRevision: 0, configuration: f.policy() });
    f.permissions.save(f.scope, 'native-owner', { expectedRevision: 1, configuration: f.policy() });
    f.sql((db) => db.exec('DELETE FROM feature_permission_events WHERE sequence=1'));
    assert.throws(() => f.permissions.read(f.scope), /incomplete/);
  }),
);

test(
  'audit saturation denies reads and writes, preserves policy and never deletes audit',
  withFixture((f) => {
    f.permissions.save(f.scope, 'native-owner', { expectedRevision: 0, configuration: f.policy() });
    f.sql((db) =>
      db.exec(`INSERT INTO feature_permission_events(workspace_id,feature_id,metadata)
    WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<32767)
    SELECT e.workspace_id,e.feature_id,e.metadata FROM n CROSS JOIN feature_permission_events e`),
    );
    assert.throws(() => f.permissions.read(f.scope), /capacity/);
    assert.throws(
      () =>
        f.permissions.save(f.scope, 'native-owner', {
          expectedRevision: 1,
          configuration: f.policy([]),
        }),
      /capacity/,
    );
    assert.equal(
      f.sql((db) => db.prepare('SELECT COUNT(*) AS n FROM feature_permission_events').get()?.n),
      32768,
    );
    assert.equal(
      f.sql((db) => db.prepare('SELECT revision FROM feature_permissions').get()?.revision),
      1,
    );
  }),
);

test(
  'policy saturation denies even a valid absent-policy scope',
  withFixture((f) => {
    f.sql((db) => {
      db.exec('PRAGMA foreign_keys=OFF; BEGIN');
      const insert = db.prepare("INSERT INTO feature_permissions VALUES (?,'synthetic',1,?)");
      for (let i = 0; i < 1024; i++)
        insert.run(randomUUID(), JSON.stringify({ schemaVersion: 1, rules: [] }));
      db.exec('COMMIT');
    });
    assert.throws(() => f.permissions.read(f.scope), /capacity/);
    assert.throws(
      () =>
        f.permissions.save(f.scope, 'native-owner', {
          expectedRevision: 0,
          configuration: f.policy(),
        }),
      /capacity/,
    );
  }),
);

test(
  'trusted Core facade fixes workspace, persists actor and exposes only composition API',
  withFixture((f) => {
    const core = featureConfigurationDatabase(f.directory, 'synthetic');
    let feature = core.create({ name: 'SYNTHETIC facade' });
    for (const id of [f.source, f.target])
      feature = core.assignTerminal(feature.featureId, id, feature.revision);
    assert.equal(core.readPermissions(feature.featureId).configuration, null);
    core.savePermissions(feature.featureId, 'native-owner', {
      expectedRevision: 0,
      configuration: f.policy(),
    });
    assert.equal(
      core.permissionReader({ workspaceId: feature.workspaceId, featureId: feature.featureId })
        .permissions.revision,
      1,
    );
    assert.equal(core.permissionEvents(feature.featureId)[0]?.actorId, 'native-owner');
    assert.throws(() => core.permissionReader({ ...feature, workspaceId: 'foreign' }), /workspace/);
  }),
);
