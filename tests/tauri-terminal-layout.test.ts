// Synthetic visual state and private preferences only; no provider or native focus claims.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TauriTerminalLayout } from '../apps/desktop/src/tauri-terminal-layout.js';
import { terminalLayoutDatabase } from '../packages/core/src/terminal/layout-database.js';
import { terminalLayoutStore } from '../apps/desktop/src/terminal-layout-store.js';
import type {
  TerminalLayoutPreferences,
  TerminalLayoutState,
} from '../apps/desktop/src/terminal-layout.js';

function fixture(count = 8, initial?: TerminalLayoutPreferences, fail = false) {
  const messages: Array<{
    state: TerminalLayoutState;
    focus: number | null;
    bounds: Array<{
      slot: number;
      rect: { x: number; y: number; width: number; height: number } | null;
    }>;
  }> = [];
  const revoked: number[] = [];
  let saved: TerminalLayoutPreferences | undefined;
  const layout = new TauriTerminalLayout(
    count,
    {
      initial,
      save(state) {
        if (fail) throw new Error('Synthetic unavailable preference store');
        saved = structuredClone(state);
      },
    },
    (value) => messages.push(value as (typeof messages)[number]),
    (slot) => revoked.push(slot),
  );
  return { layout, messages, revoked, saved: () => saved };
}

test('one to eight retained Tauri documents use shared grid geometry and compact paging', () => {
  for (const count of [1, 2, 3, 4, 8]) {
    const { layout, messages, revoked } = fixture(count);
    assert.deepEqual(layout.snapshot().visible, []);
    layout.resize(1441, 1201);
    assert.equal(layout.open(0), true);
    const message = messages.at(-1)!;
    assert.ok(message.state.visible.length > 0);
    assert.equal(message.bounds.length, count);
    assert.equal(
      message.bounds.reduce((area, { rect }) => area + (rect ? rect.width * rect.height : 0), 0),
      1441 * 1201,
    );
    const original = layout.snapshot().order;
    layout.resize(600, 700);
    assert.deepEqual(layout.snapshot().visible, [0]);
    if (count > 1) assert.ok(revoked.includes(1));
    for (const slot of original) {
      layout.open(slot);
      assert.deepEqual(layout.snapshot().visible, [slot]);
    }
    assert.deepEqual(layout.snapshot().order, original);
  }
});

test('Feature resize restores the visible page without changing its three members or one-column preference', () => {
  const { layout } = fixture(6);
  layout.context(
    {
      axis: 'columns',
      percent: 50,
      columns: 1,
      order: [0, 1, 2],
      shown: [0, 1, 2],
      active: 0,
      maximized: null,
      names: Array.from({ length: 6 }, () => ''),
    },
    () => {},
  );
  layout.resize(1440, 900);
  // Chrome leaves 785px high: the 320px pane budget admits two rows.
  assert.deepEqual(layout.snapshot().visible, [0, 1]);
  layout.resize(720, 700);
  assert.deepEqual(layout.snapshot().visible, [0]);
  layout.resize(1440, 900);
  assert.deepEqual(layout.snapshot().visible, [0, 1]);
  assert.deepEqual(layout.snapshot().order, [0, 1, 2]);
  assert.deepEqual(layout.snapshot().shown, [0, 1, 2]);
  assert.equal(layout.snapshot().columns, 1);
});

test('workspace tabs keep minimized panes hidden across grid, rename, resize, reorder and save ACKs', async () => {
  const f = fixture(4);
  f.layout.resize(1440, 900);
  f.layout.context(f.layout.snapshot(), () => {});
  assert.deepEqual(f.layout.snapshot().visible, [0, 1, 2, 3]);
  assert.equal(f.layout.workspaceAct(2, 'hide'), true);
  assert.equal(f.layout.workspaceAct(0, 'focus'), true);
  assert.deepEqual(f.layout.snapshot().visible, [0]);
  assert.equal(f.layout.workspaceAct(0, { columns: 2 }), true);
  assert.equal(f.layout.workspaceAct(2, { name: 'SYNTHETIC minimized' }), true);
  assert.equal(f.layout.workspaceAct(2, { moveTo: 0 }), true);
  f.layout.resize(600, 700);
  f.layout.resize(1440, 900);
  await f.layout.flush();
  assert.deepEqual(f.layout.snapshot().order, [2, 0, 1, 3]);
  assert.deepEqual(f.layout.snapshot().shown, [0, 1, 3]);
  assert.ok(!f.layout.snapshot().visible.includes(2));
  assert.equal(f.layout.snapshot().names[2], 'SYNTHETIC minimized');
  assert.ok(f.messages.every((message) => message.focus === null));
  assert.equal(f.layout.workspaceAct(2, 'focus'), true);
  assert.deepEqual(f.layout.snapshot().visible, [2]);
  assert.equal(f.layout.workspaceAct(2, 'restore'), true);
  assert.deepEqual(f.layout.snapshot().visible, [2, 0, 1, 3]);
});

test('all-minimized workspace stays empty until explicit restore, and suspended/foreign/process actions are denied', () => {
  const f = fixture(2);
  f.layout.open(0);
  f.layout.workspaceAct(0, 'hide');
  f.layout.workspaceAct(1, 'hide');
  assert.deepEqual(f.layout.snapshot().visible, []);
  f.layout.workspaceAct(1, { columns: 2 });
  assert.deepEqual(f.layout.snapshot().shown, []);
  assert.equal(f.layout.workspaceAct(1, 'show-all'), true);
  assert.deepEqual(f.layout.snapshot().shown, [0, 1]);
  for (const action of ['stop', 'start', { tab: 0 }, { moveTo: 7 }, { name: '\u202e' }]) {
    const before = f.layout.snapshot();
    assert.equal(f.layout.workspaceAct(0, action), false);
    assert.deepEqual(f.layout.snapshot(), before);
  }
  assert.equal(f.layout.workspaceAct(7, 'focus'), false);
  f.layout.suspend();
  assert.equal(f.layout.workspaceAct(0, 'focus'), false);
});

test('passive layout updates never request native focus from the communication window', () => {
  const { layout, messages } = fixture(4);
  layout.open(0);
  assert.equal(messages.at(-1)!.focus, 0);
  messages.length = 0;
  layout.resize(1440, 1200);
  layout.focus(1);
  layout.act(1, { name: 'SYNTHETIC' });
  layout.act(1, 'maximize');
  layout.act(1, 'restore');
  assert.ok(messages.length > 0);
  assert.ok(messages.every((message) => message.focus === null));
  layout.suspend();
  layout.resize(1200, 900);
  assert.equal(messages.at(-1)!.focus, null);
  assert.deepEqual(messages.at(-1)!.state.visible, []);
  layout.open(1);
  assert.equal(messages.at(-1)!.focus, 1);
});

test('hide, suspend, restore, reorder and plain-text rename retain stable slots', () => {
  const { layout, revoked } = fixture(4);
  layout.resize(1440, 1200);
  layout.open(0);
  layout.act(0, { name: '<img src=x onerror=alert(1)>' });
  layout.act(0, { moveTo: 3 });
  assert.deepEqual(layout.snapshot().order, [1, 2, 3, 0]);
  layout.act(0, 'maximize');
  assert.deepEqual(layout.snapshot().visible, [0]);
  layout.act(0, 'restore');
  layout.act(0, 'hide');
  assert.ok(!layout.snapshot().visible.includes(0));
  assert.equal(layout.snapshot().count, 4);
  assert.ok(revoked.includes(0));
  layout.open(0);
  assert.equal(layout.snapshot().names[0], '<img src=x onerror=alert(1)>');
  const before = layout.snapshot();
  layout.suspend();
  layout.resize(1200, 900);
  assert.deepEqual(layout.snapshot().visible, []); // Native close cannot be undone by resize.
  layout.open(0);
  assert.deepEqual(layout.snapshot().order, before.order);
  layout.act(0, 'dashboard');
  assert.deepEqual(layout.snapshot().visible, []);
});

test('focus and UUID-based preferences restore visual metadata without starting sessions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orqst-tauri-layout-'));
  try {
    const identities = Array.from({ length: 4 }, () => randomUUID());
    const client = (ids: string[]) => {
      const db = terminalLayoutDatabase(root, ids);
      return terminalLayoutStore(root, ids, {
        read: async () => db.read(),
        save: async (record) => db.save(record),
        import: async (record) => db.import(record),
      });
    };
    const store = client(identities);
    const first = new TauriTerminalLayout(
      4,
      { save: store.save },
      () => {},
      () => {},
    );
    first.resize(1440, 1200);
    first.open(0);
    first.act(0, { name: 'Frontend' });
    first.act(0, { moveTo: 2 });
    first.focus(3);
    first.act(3, 'maximize');
    await new Promise((resolve) => setImmediate(resolve));
    const initial = (await client([...identities].reverse()).load())!;
    const next = fixture(4, initial);
    assert.deepEqual(next.layout.snapshot().visible, []);
    next.layout.open(0); // First menu entry restores the selected immutable identity.
    assert.equal(next.layout.snapshot().active, 0); // Old slot 3 is slot 0 after identity reorder.
    assert.deepEqual(next.layout.snapshot().visible, [0]);
    assert.equal(next.layout.snapshot().names[3], 'Frontend');
    assert.equal(await client(identities.map(() => randomUUID())).load(), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('untrusted actions and hidden sources cannot mutate layout or grant process authority', () => {
  const { layout } = fixture(3);
  assert.equal(layout.act(0, 'show-all'), false);
  layout.open(0);
  for (const raw of [
    'start',
    'stop',
    { tab: 7 },
    { name: 'x', command: 'start' },
    { moveTo: 7 },
    { name: '\u202e' },
  ]) {
    assert.equal(layout.act(0, raw), false);
  }
  layout.act(0, 'maximize');
  assert.equal(layout.act(1, 'hide'), false);
  const before = layout.snapshot();
  layout.focus(2);
  assert.deepEqual(layout.snapshot(), before);
  assert.equal(layout.open(7), false);
});

test('failed preference writes leave the visual workspace usable and report memory-only state', () => {
  const { layout } = fixture(2, undefined, true);
  layout.open(0);
  layout.act(0, { name: 'Backend' });
  assert.equal(layout.snapshot().persisted, false);
  assert.equal(layout.snapshot().names[0], 'Backend');
  layout.act(0, 'hide');
  assert.equal(layout.open(0), true);
});

test('asynchronous save acknowledgments cannot override newer state or reopen a suspended layout', async () => {
  const writes: Array<{
    state: TerminalLayoutPreferences;
    resolve(): void;
    reject(error: Error): void;
  }> = [];
  const messages: Array<{ state: TerminalLayoutState; focus: number | null }> = [];
  const layout = new TauriTerminalLayout(
    2,
    {
      save(state) {
        return new Promise<void>((resolve, reject) => writes.push({ state, resolve, reject }));
      },
    },
    (value) => messages.push(value as (typeof messages)[number]),
    () => {},
  );
  layout.resize(1200, 900);
  layout.open(0);
  layout.act(0, { name: 'SYNTHETIC newest name' });
  assert.equal(writes[0]!.state.names[0], ''); // Save received a snapshot, not mutable live state.
  assert.equal(writes[1]!.state.names[0], 'SYNTHETIC newest name');
  assert.equal(layout.snapshot().persisted, false);
  layout.suspend();
  writes[1]!.resolve();
  await Promise.resolve();
  assert.equal(layout.snapshot().persisted, true);
  writes[0]!.reject(new Error('SYNTHETIC older save failed'));
  await Promise.resolve();
  assert.equal(layout.snapshot().persisted, true);
  assert.deepEqual(layout.snapshot().visible, []);
  assert.equal(messages.at(-1)!.focus, null);
});

test('confirmed append reserves one stable slot without changing old layout or publishing early', () => {
  const f = fixture(2);
  f.layout.open(0);
  f.layout.act(0, { name: 'SYNTHETIC original' });
  f.layout.act(0, 'maximize');
  const before = f.layout.snapshot();
  const publications = f.messages.length;
  const revocations = f.revoked.length;
  f.layout.append(2);
  assert.equal(f.messages.length, publications);
  assert.equal(f.revoked.length, revocations);
  const after = f.layout.snapshot();
  assert.deepEqual(after, { ...before, count: 3, names: [...before.names, ''] });
  assert.throws(() => f.layout.append(2), /Invalid/);
  assert.throws(() => f.layout.append(4), /Invalid/);
  assert.equal(f.layout.open(2), false, 'Enrollment alone does not assign view membership');
});

test('dock reopen re-shows only an existing hidden slot without starting anything', () => {
  const f = fixture(2);
  f.layout.open(0);
  f.layout.act(1, 'hide');
  assert.equal(f.layout.snapshot().visible.includes(1), false);
  assert.equal(f.layout.act(1, 'reopen', 0), true);
  assert.equal(f.layout.snapshot().shown.includes(1), true);
  assert.equal(f.layout.snapshot().active, 1);
  assert.equal(f.layout.act(5, 'reopen', 0), false);
});

test('dock reopen rejects missing or stale native generation before any save or publication', () => {
  const f = fixture(2);
  f.layout.open(0);
  f.layout.act(1, 'hide');
  const capturedGeneration = 4;
  f.layout.setNativeGeneration(capturedGeneration);
  // Deterministic transport barrier: the generation invalidation arrives before the old action.
  f.layout.setNativeGeneration(capturedGeneration + 1);
  const before = f.layout.snapshot();
  const saved = f.saved();
  const publications = f.messages.length;
  const revocations = f.revoked.length;
  for (const generation of [undefined, capturedGeneration, capturedGeneration + 2]) {
    assert.equal(f.layout.act(1, 'reopen', generation), false);
    assert.deepEqual(f.layout.snapshot(), before);
    assert.strictEqual(f.saved(), saved);
    assert.equal(f.messages.length, publications);
    assert.equal(f.revoked.length, revocations);
  }
  assert.equal(f.layout.act(1, 'reopen', capturedGeneration + 1), true);
  f.layout.suspend();
  const suspended = f.layout.snapshot();
  const lastSave = f.saved();
  assert.equal(f.layout.act(1, 'reopen', capturedGeneration + 1), false);
  assert.deepEqual(f.layout.snapshot(), suspended);
  assert.strictEqual(f.saved(), lastSave);
});
