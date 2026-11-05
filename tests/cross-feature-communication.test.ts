// SYNTHETIC data and disposable SQLite only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '@orqst/database';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers/cross-feature-fixture.js';
import {
  CrossFeatureCommunication,
  crossFeatureIntentDigest,
} from '../packages/core/src/communication/cross-feature-communication.js';

const run = (fn: (f: ReturnType<typeof fixture>) => void) => () => {
  const f = fixture();
  try {
    fn(f);
  } finally {
    f.close();
  }
};

test(
  'SYNTHETIC bilateral policy requires both explicit rules and exact authority',
  run((f) => {
    assert.throws(() => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'));
    f.save('source', 0, f.policy('outbound'));
    assert.throws(() => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'));
    f.save('target', 0, f.policy('inbound'));
    assert.throws(() => f.service.admit(f.grant, f.request, 'forged'));
    assert.throws(() =>
      f.service.admit({ ...f.grant, actorId: 'forged' }, f.request, 'SYNTHETIC-proof'),
    );
    assert.equal(f.service.admit(f.grant, f.request, 'SYNTHETIC-proof').state, 'queued');
    assert.throws(() => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'));
    assert.equal(
      f.journal.transaction((tx) => tx.crossMessages().length),
      1,
    );
    assert.equal(
      f.journal.transaction((tx) => tx.crossEvents().length),
      1,
    );
  }),
);
test(
  'SYNTHETIC revocation prevents claim and retains queued message',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    f.service.admit(f.grant, f.request, 'SYNTHETIC-proof');
    f.save('target', 1, { schemaVersion: 1, rules: [] });
    assert.equal(f.service.claim(f.request.messageId), undefined);
    assert.equal(
      f.journal.transaction((tx) => tx.crossMessages()[0]?.state),
      'queued',
    );
  }),
);

test(
  'inbound alone and absent outbound deny',
  run((f) => {
    f.save('target', 0, f.policy('inbound'));
    assert.throws(() => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'));
  }),
);
test(
  'grant expiry, altered intent, and foreign workspace deny',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    assert.throws(() => f.service.admit({ ...f.grant, deadline: 1 }, f.request, 'SYNTHETIC-proof'));
    assert.throws(() =>
      f.service.admit(f.grant, { ...f.request, taskId: randomUUID() }, 'SYNTHETIC-proof'),
    );
    assert.throws(() =>
      f.service.admit({ ...f.grant, workspaceId: 'foreign' }, f.request, 'SYNTHETIC-proof'),
    );
    assert.equal(
      f.journal.transaction((tx) => tx.crossMessages().length),
      0,
    );
  }),
);
test(
  'a policy revision change denies an old grant even if allow is restored',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    f.save('source', 1, { schemaVersion: 1, rules: [] });
    f.save('source', 2, f.policy('outbound'));
    assert.throws(() => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'));
  }),
);
test(
  'audit failure rolls back admission and does not consume grant',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    const db = new DatabaseSync(join(f.dir, 'journal.sqlite'));
    try {
      db.exec(
        "CREATE TRIGGER synthetic_fail BEFORE INSERT ON cross_feature_audit BEGIN SELECT RAISE(ABORT,'SYNTHETIC audit failure'); END",
      );
      assert.throws(
        () => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'),
        /SYNTHETIC audit failure/,
      );
      assert.equal(
        f.journal.transaction((tx) => tx.crossMessages().length),
        0,
      );
      db.exec('DROP TRIGGER synthetic_fail');
      assert.equal(f.service.admit(f.grant, f.request, 'SYNTHETIC-proof').state, 'queued');
    } finally {
      db.close();
    }
  }),
);
test(
  'claim audit failure rolls back the state transition',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    f.service.admit(f.grant, f.request, 'SYNTHETIC-proof');
    const db = new DatabaseSync(join(f.dir, 'journal.sqlite'));
    try {
      db.exec(
        "CREATE TRIGGER synthetic_fail BEFORE INSERT ON cross_feature_audit BEGIN SELECT RAISE(ABORT,'SYNTHETIC audit failure'); END",
      );
      assert.throws(() => f.service.claim(f.request.messageId), /SYNTHETIC audit failure/);
      assert.equal(
        f.journal.transaction((tx) => tx.crossMessages()[0]?.state),
        'queued',
      );
    } finally {
      db.close();
    }
  }),
);
test(
  'unknown schema and audit corruption fail closed',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    const db = new DatabaseSync(join(f.dir, 'terminal-layouts', 'preferences.sqlite'));
    try {
      db.exec('UPDATE cross_feature_permission_schema SET version=2');
      assert.throws(() => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'));
      db.exec(
        'UPDATE cross_feature_permission_schema SET version=1; DELETE FROM cross_feature_permission_events',
      );
      assert.throws(() => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'));
    } finally {
      db.close();
    }
  }),
);
test(
  'local routing remains isolated and cross routing requires explicit reviewed configuration',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    const source = f.journal.transaction((tx) =>
      tx.panes().find((p) => p.paneId === f.grant.source.paneId)!,
    );
    assert.throws(() =>
      f.local.configureRouting(source.paneId, {
        name: source.name,
        ...source.routing!,
        allowedTargetPaneIds: [f.grant.target.paneId],
      }),
    );
    const db = new DatabaseSync(join(f.dir, 'journal.sqlite'));
    try {
      db.exec('DELETE FROM cross_feature_routes');
    } finally {
      db.close();
    }
    assert.throws(() => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'));
    assert.throws(() => f.service.configureRoute(f.grant, f.request, 'forged'));
    f.service.configureRoute(f.grant, f.request, 'SYNTHETIC-proof');
    assert.equal(f.service.admit(f.grant, f.request, 'SYNTHETIC-proof').state, 'queued');
  }),
);
test(
  'view requires bilateral view rules and trusted proof',
  run((f) => {
    const outbound = f.policy('outbound');
    const inbound = f.policy('inbound');
    outbound.rules.push(...f.policy('outbound', true).rules);
    inbound.rules.push(...f.policy('inbound', true).rules);
    f.save('source', 0, outbound);
    f.save('target', 0, inbound);
    f.service.admit(f.grant, f.request, 'SYNTHETIC-proof');
    assert.equal(f.service.view(f.request.messageId, f.grant, 'invalid'), undefined);
    assert.equal(f.service.view(f.request.messageId, f.grant, 'SYNTHETIC-proof')?.state, 'queued');
    f.save('target', 1, { schemaVersion: 1, rules: [] });
    assert.equal(f.service.view(f.request.messageId, f.grant, 'SYNTHETIC-proof'), undefined);
  }),
);
test(
  'a newly constructed service never restores an old grant',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    f.service.admit(f.grant, f.request, 'SYNTHETIC-proof');
    const restarted = new CrossFeatureCommunication(
      f.journal,
      f.config.crossFeatureSnapshot,
      f.authority,
    );
    assert.equal(restarted.claim(f.request.messageId), undefined);
    assert.equal(f.service.claim(f.request.messageId)?.state, 'dispatching');
  }),
);
test(
  'closed or external panes are refused',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    f.journal.transaction((tx) => {
      const target = tx.panes().find((p) => p.paneId === f.grant.target.paneId)!;
      tx.savePane({ ...target, state: 'closed' });
    });
    assert.throws(() => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'));
  }),
);

test(
  'recovery preserves uncertain claim without retry or restored authority',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    f.service.admit(f.grant, f.request, 'SYNTHETIC-proof');
    assert.equal(f.service.claim(f.request.messageId)?.state, 'dispatching');
    const reopened = new Store(join(f.dir, 'journal.sqlite'));
    try {
      const journal = reopened.communicationJournal(randomUUID(), { recover: true });
      journal.enableCross();
      assert.equal(
        journal.transaction((tx) => tx.crossMessages()[0]?.state),
        'outcome_unknown',
      );
      assert.equal(
        journal.transaction((tx) => tx.crossEvents().at(-1)?.outcome),
        'outcome_unknown',
      );
      const restarted = new CrossFeatureCommunication(
        journal,
        f.config.crossFeatureSnapshot,
        f.authority,
      );
      assert.equal(restarted.claim(f.request.messageId), undefined);
    } finally {
      reopened.close();
    }
  }),
);
test(
  'foreign terminal, duplicate rule and stale policy save fail',
  run((f) => {
    const bad = f.policy('outbound');
    bad.rules[0]!.remoteTerminalId = randomUUID();
    assert.throws(() => f.save('source', 0, bad));
    const duplicate = f.policy('outbound');
    duplicate.rules.push(duplicate.rules[0]!);
    assert.throws(() => f.save('source', 0, duplicate));
    f.save('source', 0, f.policy('outbound'));
    assert.throws(() => f.save('source', 0, f.policy('outbound')));
  }),
);

test(
  'orchestrator role adds no authority; the same explicit rules suffice',
  run((f) => {
    f.journal.transaction((tx) => {
      const source = tx.panes().find((p) => p.paneId === f.grant.source.paneId)!;
      tx.savePane({ ...source, routing: { ...source.routing!, role: 'orchestrator' } });
    });
    assert.throws(() => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'));
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    f.service.admit(f.grant, f.request, 'SYNTHETIC-proof');
    const events = f.journal.transaction((tx) => tx.crossEvents());
    assert.equal(events.length, 1);
    assert.equal('payload' in events[0]!, false);
  }),
);
test(
  'journal insert failure does not record admission or consume grant',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    const db = new DatabaseSync(join(f.dir, 'journal.sqlite'));
    try {
      db.exec(
        "CREATE TRIGGER synthetic_fail BEFORE INSERT ON cross_feature_messages BEGIN SELECT RAISE(ABORT,'SYNTHETIC insert failure'); END",
      );
      assert.throws(
        () => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'),
        /SYNTHETIC insert failure/,
      );
      assert.equal(
        f.journal.transaction((tx) => tx.crossMessages().length),
        0,
      );
      assert.equal(
        f.journal.transaction((tx) => tx.crossEvents().length),
        0,
      );
      db.exec('DROP TRIGGER synthetic_fail');
      assert.equal(f.service.admit(f.grant, f.request, 'SYNTHETIC-proof').state, 'queued');
    } finally {
      db.close();
    }
  }),
);
test(
  'legacy and foreign pane identities cannot satisfy the exact binding',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    const source = f.journal.transaction((tx) =>
      tx.panes().find((p) => p.paneId === f.grant.source.paneId)!,
    );
    assert.throws(() =>
      f.journal.transaction((tx) => tx.savePane({ ...source, featureId: undefined })),
    );
    assert.throws(() =>
      f.journal.transaction((tx) => tx.savePane({ ...source, workspaceId: 'foreign' })),
    );
    assert.throws(() =>
      f.journal.transaction((tx) =>
        tx.savePane({ ...source, binding: { ...source.binding!, terminalEpoch: randomUUID() } }),
      ),
    );
  }),
);

test(
  'renaming a Feature and pane does not change stable identity',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    f.config.update(f.source.featureId, {
      expectedRevision: f.source.revision,
      name: 'SYNTHETIC renamed',
    });
    f.journal.transaction((tx) => {
      const pane = tx.panes().find((p) => p.paneId === f.grant.target.paneId)!;
      tx.savePane({ ...pane, name: 'SYNTHETIC renamed pane' });
    });
    assert.equal(f.service.admit(f.grant, f.request, 'SYNTHETIC-proof').state, 'queued');
  }),
);
test(
  'archived Feature and unavailable reader deny',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    const unavailable = new CrossFeatureCommunication(
      f.journal,
      () => {
        throw new Error('SYNTHETIC unavailable');
      },
      f.authority,
    );
    assert.throws(() => unavailable.admit(f.grant, f.request, 'SYNTHETIC-proof'));
    const db = new DatabaseSync(join(f.dir, 'terminal-layouts', 'preferences.sqlite'));
    try {
      db.prepare("UPDATE features SET status='archived' WHERE id=?").run(f.target.featureId);
      assert.throws(() => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'));
    } finally {
      db.close();
    }
  }),
);

test(
  'loss of injected authority after admission denies claim',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    f.service.admit(f.grant, f.request, 'SYNTHETIC-proof');
    f.authority.verify = () => false;
    assert.equal(f.service.claim(f.request.messageId), undefined);
    assert.equal(
      f.journal.transaction((tx) => tx.crossMessages()[0]?.state),
      'queued',
    );
  }),
);

test(
  'journal uniqueness fences reuse of grant, intent, nonce and idempotency',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    f.service.admit(f.grant, f.request, 'SYNTHETIC-proof');
    const permissiveSynthetic = new CrossFeatureCommunication(
      f.journal,
      f.config.crossFeatureSnapshot,
      { verify: () => true },
    );
    for (const collision of ['grantId', 'intentId', 'nonce', 'idempotencyKey'] as const) {
      const request = {
        ...f.request,
        messageId: randomUUID(),
        taskId: randomUUID(),
        idempotencyKey: collision === 'idempotencyKey' ? f.request.idempotencyKey : randomUUID(),
      };
      const grant = {
        ...f.grant,
        grantId: collision === 'grantId' ? f.grant.grantId : randomUUID(),
        intentId: collision === 'intentId' ? f.grant.intentId : randomUUID(),
        nonce: collision === 'nonce' ? f.grant.nonce : randomUUID(),
        intentDigest: crossFeatureIntentDigest(request),
      };
      assert.throws(() => permissiveSynthetic.admit(grant, request, 'SYNTHETIC'));
    }
    assert.equal(
      f.journal.transaction((tx) => tx.crossMessages().length),
      1,
    );
    assert.equal(
      f.journal.transaction((tx) => tx.crossEvents().length),
      1,
    );
  }),
);

test(
  'an existing opposing delegation edge prevents a cross-Feature cycle',
  run((f) => {
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    const grant = {
      ...f.grant,
      source: f.grant.target,
      target: f.grant.source,
      grantId: randomUUID(),
      intentId: randomUUID(),
      nonce: randomUUID(),
    };
    const request = {
      ...f.request,
      messageId: randomUUID(),
      taskId: randomUUID(),
      idempotencyKey: randomUUID(),
    };
    const timestamp = Date.now();
    f.journal.transaction((tx) =>
      tx.insertCross(
        {
          schemaVersion: 1,
          grant,
          request,
          state: 'queued',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          schemaVersion: 1,
          eventId: randomUUID(),
          timestamp,
          actorId: grant.actorId,
          workspaceId: grant.workspaceId,
          sourceFeatureId: grant.source.featureId,
          targetFeatureId: grant.target.featureId,
          sourceTerminalId: grant.source.terminalId,
          targetTerminalId: grant.target.terminalId,
          sourcePaneId: grant.source.paneId,
          targetPaneId: grant.target.paneId,
          operation: grant.operation,
          grantId: grant.grantId,
          intentId: grant.intentId,
          messageId: request.messageId,
          sourceRevision: grant.sourceRevision,
          targetRevision: grant.targetRevision,
          outcome: 'admitted',
        },
      ),
    );
    assert.throws(() => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'), /cycle/);
  }),
);

test(
  'cross route refuses a foreign Workspace even with a SYNTHETIC approving port',
  run((f) => {
    const unsafeAuthority = new CrossFeatureCommunication(
      f.journal,
      f.config.crossFeatureSnapshot,
      { verify: () => true },
    );
    assert.throws(() =>
      unsafeAuthority.configureRoute(
        { ...f.grant, workspaceId: 'foreign' },
        f.request,
        'SYNTHETIC',
      ),
    );
    assert.throws(() =>
      unsafeAuthority.configureRoute(
        { ...f.grant, target: { ...f.grant.target, featureId: f.grant.source.featureId } },
        f.request,
        'SYNTHETIC',
      ),
    );
  }),
);
