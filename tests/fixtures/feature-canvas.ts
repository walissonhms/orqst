// SYNTHETIC renderer fixture. Never imported by application entrypoints or staged resources.
import type {
  CanvasAgent,
  CanvasGroup,
  CanvasJournalEdge,
} from '../../apps/dashboard/src/feature-canvas.js';
import type { StoredEvent, CommunicationPane } from '@orqst/protocol';

export function syntheticCanvas() {
  const featureId = 'e10636eb-3a12-4094-9123-49a4cdad27b8';
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const groups: CanvasGroup[] = ['Interface', 'Contracts', 'Validation'].map((name) => ({
    id: name.toLowerCase(),
    name,
  }));
  const titles = [
    'SYNTHETIC coordinator',
    'Inspect layout',
    'Document focus',
    'Review protocol',
    'Check CLI evidence',
    'Validate native bounds',
    'Inspect keyboard',
  ];
  const agents: CanvasAgent[] = titles.map((title, slot) => {
    const id = uuid(slot + 1);
    const sessionId = `synthetic-session-${slot}`;
    const provider = slot % 2 === 0 ? 'codex' : 'claude';
    const status = slot === 4 ? 'waiting_for_user' : slot === 2 ? 'completed' : 'running';
    const events: StoredEvent[] = [
      'Read synthetic fixture',
      'Review synthetic contract',
      'Synthetic check recorded',
    ].map((name, index) => ({
      schemaVersion: 1,
      id: `synthetic-event-${slot}-${index}`,
      sequence: slot * 3 + index + 1,
      type: slot === 2 && index === 2 ? 'agent.completed' : 'agent.tool.completed',
      timestamp: `2026-11-05T15:0${index + 1}:00.000Z`,
      adapter: provider,
      machineId: 'synthetic-machine',
      workspaceId: 'synthetic-workspace',
      sessionId,
      agentId: id,
      correlation: {},
      source: {
        file: '/synthetic/renderer-only.jsonl',
        offset: index * 100,
        line: index + 1,
        hash: '0'.repeat(64),
        recordType: 'synthetic',
      },
      payload: { name, ...(slot > 0 ? { parentSessionId: 'synthetic-session-0' } : {}) },
    }));
    return {
      id,
      slot,
      groupId: slot === 0 ? 'coordinator' : groups[Math.floor((slot - 1) / 2)]!.id,
      featureId,
      title,
      provider,
      minimized: false,
      orchestrator: slot === 0,
      events,
      session: {
        id: sessionId,
        workspaceId: 'synthetic-workspace',
        cwd: '/synthetic',
        agentName: title,
        adapter: provider,
        status,
        startedAt: '2026-11-05T15:00:00.000Z',
        lastActivity: '2026-11-05T15:03:00.000Z',
        task: null,
        result: null,
        model: 'SYNTHETIC model',
        parentSessionId: slot ? 'synthetic-session-0' : null,
        usage: { input: 0, output: 0, cached: 0, total: 0 },
        manualWorkspace: false,
      },
    };
  });
  const panes: CommunicationPane[] = agents.map((agent, index) => ({
    schemaVersion: 1,
    paneId: uuid(100 + index),
    terminalId: agent.id,
    workspaceId: 'synthetic-workspace',
    featureId,
    displayId: `T-${String(index + 1).padStart(3, '0')}`,
    name: agent.title,
    routing: null,
    provider: agent.provider,
    cliVersion: null,
    model: null,
    ownership: 'managed',
    ownerId: 'synthetic-owner',
    creationReason: 'synthetic fixture',
    binding: {
      instanceId: uuid(200 + index),
      projectId: 'synthetic-project',
      terminalEpoch: uuid(300),
    },
    capabilities: {
      canSend: true,
      canQueueWhileBusy: true,
      canAcknowledge: true,
      canReportTaskCompletion: true,
      canCancel: true,
    },
    state: 'ready',
    createdAt: 0,
  }));
  const journal: CanvasJournalEdge[] = panes.slice(1).map((target, index) => ({
    source: panes[0]!,
    target,
    message: {
      schemaVersion: 1,
      messageId: uuid(400 + index),
      taskId: uuid(500 + index),
      correlationId: uuid(600 + index),
      workspaceId: 'synthetic-workspace',
      featureId,
      sourcePaneId: panes[0]!.paneId,
      targetPaneId: target.paneId,
      parentTaskId: null,
      kind: 'task.request',
      payload: { id: 'synthetic-content', sha256: '0'.repeat(64), bytes: 1 },
      deliveryPolicy: 'queue-if-busy',
      idempotencyKey: `synthetic-${index}`,
      deadline: 1000,
      actorId: 'synthetic-owner',
      grantId: uuid(700 + index),
      depth: 0,
      deliveryState: 'queued',
      taskState: 'pending',
      createdAt: 0,
      updatedAt: 0,
      attemptId: null,
      result: null,
      evidenceId: null,
      reason: 'admitted',
    },
    admission: {
      sequence: index + 1,
      timestamp: 0,
      actorId: 'synthetic-owner',
      workspaceId: 'synthetic-workspace',
      featureId,
      paneId: panes[0]!.paneId,
      messageId: uuid(400 + index),
      action: 'admitted',
      deliveryState: 'queued',
      taskState: 'pending',
    },
  }));
  return { agents, groups, journal };
}
