import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canvasActivities,
  canvasDuration,
  canvasEdges,
  canvasGeometry,
  canvasMembers,
  fitCanvas,
} from '../apps/dashboard/src/feature-canvas.js';
import { syntheticCanvas } from './fixtures/feature-canvas.js';
import { TauriTerminalLayout } from '../apps/desktop/src/tauri-terminal-layout.js';
import type { FeatureNativeSnapshot } from '@orqst/protocol';

test('canvas edges require exact admitted Core journal evidence and scoped terminal bindings', () => {
  const { agents, journal } = syntheticCanvas();
  assert.equal(canvasEdges(agents).length, 0); // Source event parentage alone is not the journal.
  assert.equal(canvasEdges(agents, journal).length, 6);
  const edge = journal[0]!;
  const rejected = (entry: typeof edge) => canvasEdges(agents, [entry]).length === 0;
  assert.ok(rejected({ ...edge, admission: { ...edge.admission, action: 'denied' } }));
  assert.ok(rejected({ ...edge, admission: { ...edge.admission, messageId: null } }));
  assert.ok(rejected({ ...edge, target: { ...edge.target, workspaceId: 'foreign' } }));
  assert.ok(rejected({ ...edge, source: { ...edge.source, terminalId: undefined } }));
  assert.ok(rejected({ ...edge, message: { ...edge.message, featureId: undefined } }));
  agents[1]!.featureId = 'another-feature';
  assert.ok(rejected(edge));
});

test('canvas shows only three validated source activities and never extracts prose from a PTY', () => {
  const agent = syntheticCanvas().agents[1]!;
  const events = agent.events;
  agent.events = [
    ...events,
    {
      ...events[2]!,
      id: 'latest-synthetic',
      sequence: 100,
      payload: { text: '<img src=x onerror=alert(1)>' },
    },
    { ...events[0]!, sessionId: 'foreign', sequence: 101 },
  ];
  assert.deepEqual(
    canvasActivities(agent).map((event) => event.sequence),
    [5, 6, 100],
  );
  delete agent.session;
  assert.deepEqual(canvasActivities(agent), []);
});

test('a completed duration requires a matching completion event, not an unrelated final activity', () => {
  const agent = syntheticCanvas().agents[2]!;
  assert.equal(canvasDuration(agent), 180000);
  agent.events = agent.events.filter((event) => event.type !== 'agent.completed');
  assert.equal(canvasDuration(agent), null);
});

test('native metadata produces honest unavailable cards, scoped only by persisted Feature membership', () => {
  const id = 'e10636eb-3a12-4094-9123-49a4cdad27b8';
  const snapshot: FeatureNativeSnapshot = {
    contractVersion: 1,
    storage: 'core',
    generation: 0,
    workspace: { id: 'synthetic', name: 'SYNTHETIC' },
    features: [],
    activeFeatureId: null,
    view: {
      contractVersion: 1,
      storage: 'core',
      workspaceId: 'synthetic',
      featureId: null,
      revision: 0,
    },
    slots: [{ slot: 0, terminalId: id, provider: 'codex' }],
    layoutSaved: true,
  };
  const cards = canvasMembers(snapshot, []);
  assert.equal(cards[0]!.session, undefined);
  assert.deepEqual(cards[0]!.events, []);
  assert.equal(cards[0]!.orchestrator, false);
  assert.equal(cards[0]!.id, id);
  assert.deepEqual(canvasEdges(cards), []);
});

test('canvas bounds fit the entire graph and retain independent cards and groups', () => {
  const { agents, groups } = syntheticCanvas();
  const geometry = canvasGeometry(agents, groups);
  assert.equal(geometry.cards.size, 7);
  assert.equal(geometry.frames.size, 3);
  const camera = fitCanvas(1194, 785, geometry);
  assert.ok(geometry.width * camera.zoom <= 1194);
  assert.ok(geometry.height * camera.zoom <= 785);
});

test('canvas hides every native PTY without changing minimized preferences or requesting focus/input', async () => {
  const revoked: number[] = [];
  const packets: Array<{
    state: { visible: number[] };
    focus: unknown;
    bounds: Array<{ rect: unknown }>;
  }> = [];
  const layout = new TauriTerminalLayout(
    3,
    { save: () => {} },
    (packet) => packets.push(packet as (typeof packets)[number]),
    (slot) => revoked.push(slot),
  );
  layout.context(layout.snapshot(), () => {});
  layout.workspaceAct(1, { name: 'SYNTHETIC retained' });
  layout.workspaceAct(2, 'hide');
  const before = layout.snapshot();
  layout.showCanvas();
  assert.deepEqual(layout.snapshot().shown, before.shown);
  assert.deepEqual(layout.snapshot().names, before.names);
  assert.deepEqual(layout.snapshot().order, before.order);
  assert.deepEqual(layout.snapshot().visible, []);
  assert.equal(layout.snapshot().suspended, false);
  assert.ok(packets.at(-1)!.bounds.every((bound) => bound.rect === null));
  assert.equal(packets.at(-1)!.focus, null);
  assert.ok([0, 1, 2].every((slot) => revoked.includes(slot)));
  assert.equal(layout.workspaceAct(1, 'focus'), true);
  assert.deepEqual(layout.snapshot().visible, [1]);
  assert.ok(!layout.snapshot().shown.includes(2));
  assert.equal(layout.act(1, 'canvas'), true);
  await layout.flush();
  assert.deepEqual(layout.snapshot().visible, []);
});
