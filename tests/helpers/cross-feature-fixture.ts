// SYNTHETIC authority, panes, payload references and disposable SQLite only.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@orqst/database';
import {
  crossFeatureGrantSchema,
  type CrossFeaturePolicy,
  type CrossFeatureRequest,
} from '@orqst/protocol';
import { featureConfigurationDatabase } from '../../packages/core/src/terminal/feature-configuration.js';
import { PaneCommunication } from '../../packages/core/src/communication/service.js';
import {
  CrossFeatureCommunication,
  crossFeatureIntentDigest,
} from '../../packages/core/src/communication/cross-feature-communication.js';

export function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-SYNTHETIC-cross-'));
  const config = featureConfigurationDatabase(dir, 'synthetic');
  let source = config.create({ name: 'SYNTHETIC source' });
  let target = config.create({ name: 'SYNTHETIC target' });
  const sourceTerminal = randomUUID(),
    targetTerminal = randomUUID();
  source = config.assignTerminal(source.featureId, sourceTerminal, source.revision);
  target = config.assignTerminal(target.featureId, targetTerminal, target.revision);
  const binding = () => ({
    instanceId: randomUUID(),
    terminalEpoch: randomUUID(),
    projectId: 'synthetic',
  });
  const a = binding(),
    b = binding();
  const store = new Store(join(dir, 'journal.sqlite'));
  const journal = store.communicationJournal(randomUUID(), { recover: false });
  const local = new PaneCommunication(journal, () => Buffer.from('SYNTHETIC'));
  const register = (terminalId: string, featureId: string, n: string, instance: typeof a) =>
    local.registerPane({
      terminalId,
      workspaceId: 'synthetic',
      featureId,
      name: `SYNTHETIC ${n}`,
      routing: { handle: `test${n}`, role: 'worker', allowedTargetPaneIds: [] },
      provider: 'synthetic',
      cliVersion: null,
      model: null,
      ownership: 'managed',
      ownerId: 'synthetic',
      creationReason: 'SYNTHETIC fixture',
      binding: instance,
      capabilities: {
        canSend: true,
        canQueueWhileBusy: true,
        canAcknowledge: true,
        canReportTaskCompletion: true,
        canCancel: true,
      },
      state: 'ready',
    });
  const sourceRecord = register(sourceTerminal, source.featureId, '1', a);
  const targetRecord = register(targetTerminal, target.featureId, '2', b);
  const sourcePane = sourceRecord.paneId,
    targetPane = targetRecord.paneId;
  local.configureRouting(sourcePane, { name: sourceRecord.name, ...sourceRecord.routing! });
  local.configureRouting(targetPane, { name: targetRecord.name, ...targetRecord.routing! });
  const policy = (direction: 'outbound' | 'inbound', view = false): CrossFeaturePolicy => ({
    schemaVersion: 1,
    rules: [
      {
        direction,
        localTerminalId: direction === 'outbound' ? sourceTerminal : targetTerminal,
        remoteFeatureId: direction === 'outbound' ? target.featureId : source.featureId,
        remoteTerminalId: direction === 'outbound' ? targetTerminal : sourceTerminal,
        operation: view ? 'task.view' : 'task.request',
      },
    ],
  });
  const save = (which: 'source' | 'target', expected: number, value: CrossFeaturePolicy) =>
    config.saveCrossFeaturePermissions(
      which === 'source' ? source.featureId : target.featureId,
      'SYNTHETIC_actor',
      expected,
      value,
    );
  const request: CrossFeatureRequest = {
    schemaVersion: 1,
    messageId: randomUUID(),
    taskId: randomUUID(),
    idempotencyKey: randomUUID(),
    payload: { id: 'synthetic', bytes: 1, sha256: 'a'.repeat(64) },
  };
  const grant = {
    schemaVersion: 1 as const,
    grantId: randomUUID(),
    intentId: randomUUID(),
    intentDigest: crossFeatureIntentDigest(request),
    actorId: 'SYNTHETIC_actor',
    workspaceId: 'synthetic',
    source: {
      featureId: source.featureId,
      terminalId: sourceTerminal,
      paneId: sourcePane,
      binding: a,
    },
    target: {
      featureId: target.featureId,
      terminalId: targetTerminal,
      paneId: targetPane,
      binding: b,
    },
    operation: 'task.request' as const,
    nonce: randomUUID(),
    deadline: Date.now() + 300000,
    sourceRevision: 1,
    targetRevision: 1,
  };
  const signed = JSON.stringify(crossFeatureGrantSchema.parse(grant));
  const authority = {
    verify: (candidate: typeof grant, proof: unknown) =>
      proof === 'SYNTHETIC-proof' && JSON.stringify(candidate) === signed,
  };
  const service = new CrossFeatureCommunication(journal, config.crossFeatureSnapshot, authority);
  service.configureRoute(grant, request, 'SYNTHETIC-proof');
  return {
    dir,
    local,
    authority,
    config,
    store,
    journal,
    service,
    grant,
    request,
    policy,
    save,
    source,
    target,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
