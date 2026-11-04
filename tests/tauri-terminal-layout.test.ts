// Synthetic visual state and private preferences only; no provider or native focus claims.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TauriTerminalLayout } from '../apps/desktop/src/tauri-terminal-layout.js';
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

test('focus and UUID-based preferences restore visual metadata without starting sessions', () => {
  const root = mkdtempSync(join(tmpdir(), 'orqst-tauri-layout-'));
  try {
    const identities = Array.from({ length: 4 }, () => randomUUID());
    const store = terminalLayoutStore(root, identities);
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
    const initial = terminalLayoutStore(root, [...identities].reverse()).load()!;
    const next = fixture(4, initial);
    assert.deepEqual(next.layout.snapshot().visible, []);
    next.layout.open(0); // First menu entry restores the selected immutable identity.
    assert.equal(next.layout.snapshot().active, 0); // Old slot 3 is slot 0 after identity reorder.
    assert.deepEqual(next.layout.snapshot().visible, [0]);
    assert.equal(next.layout.snapshot().names[3], 'Frontend');
    assert.equal(
      terminalLayoutStore(
        root,
        identities.map(() => randomUUID()),
      ).load(),
      undefined,
    );
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
