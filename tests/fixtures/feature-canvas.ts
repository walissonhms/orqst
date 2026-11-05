// SYNTHETIC renderer fixture. Never imported by application entrypoints or staged resources.
import type { CanvasAgent, CanvasGroup } from '../../apps/dashboard/src/feature-canvas.js';
import type { StoredEvent } from '@orqst/protocol';

export function syntheticCanvas() {
  const featureId = 'e10636eb-3a12-4094-9123-49a4cdad27b8';
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
    const id = `synthetic-terminal-${slot}`;
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
      type: 'agent.tool.completed',
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
  return { agents, groups };
}
