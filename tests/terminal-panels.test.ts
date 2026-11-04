// Synthetic Electron surfaces only: no GUI, process ownership or reservation changes.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import type { BrowserWindow, WebContentsView } from 'electron';
import { build } from 'esbuild';

class Contents extends EventEmitter {
  destroyed = false;
  closes = 0;
  isDestroyed() {
    return this.destroyed;
  }
  close() {
    this.destroyed = true;
    this.closes++;
  }
  focus() {}
  messages: unknown[] = [];
  send(_channel: string, state: unknown) {
    this.messages.push(state);
  }
}
class View {
  bounds = { x: 0, y: 0, width: 0, height: 0 };
  visible = false;
  children: View[] = [];
  failAdd = false;
  addChildView(view: View) {
    if (this.failAdd) throw new Error('Synthetic partial construction');
    this.children.push(view);
  }
  removeChildView(view: View) {
    this.children = this.children.filter((child) => child !== view);
  }
  setBounds(bounds: typeof this.bounds) {
    this.bounds = bounds;
  }
  setVisible(visible: boolean) {
    this.visible = visible;
  }
}
class Pane extends View {
  readonly owned = new Contents();
  get webContents() {
    return this.owned.destroyed ? undefined : this.owned;
  }
}
class Window extends EventEmitter {
  contentView = new View();
  webContents = new Contents();
  destroyed = false;
  isDestroyed() {
    return this.destroyed;
  }
  isMinimized() {
    return false;
  }
  show() {}
  focus() {}
  isVisible() {
    return !this.destroyed;
  }
  size = [1600, 1800];
  getContentSize() {
    return this.size;
  }
  setContentView(view: View) {
    this.contentView = view;
  }
}
const bundle = await build({
  entryPoints: ['apps/desktop/src/terminal-panels.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  write: false,
  logLevel: 'silent',
});
const module = { exports: {} };
runInNewContext(bundle.outputFiles[0]!.text, {
  module,
  exports: module.exports,
  require: (name: string) => {
    assert.equal(name, 'electron');
    return { View };
  },
});
const { TerminalPanels } =
  module.exports as typeof import('../apps/desktop/src/terminal-panels.js');
function setup() {
  const window = new Window();
  const dashboard = window.contentView;
  const panels = new TerminalPanels(window as unknown as BrowserWindow);
  const quit = new EventEmitter();
  quit.on('before-quit', panels.close);
  return { window, dashboard, panels, quit };
}

test('beforeQuit with no panes and repeated close restores the dashboard once', () => {
  const f = setup();
  f.quit.emit('before-quit');
  f.panels.close();
  f.window.emit('closed');
  assert.equal(f.window.contentView, f.dashboard);
  assert.equal(f.window.listenerCount('resize'), 0);
  assert.equal(f.window.listenerCount('closed'), 0);
  assert.throws(() => f.panels.add(new Pane() as unknown as WebContentsView, () => {}), /closed/);
});

test('destroyed WebContentsView loses its property but close uses the retained owned handle', () => {
  const f = setup();
  const dead = new Pane();
  const live = new Pane();
  let revokes = 0;
  for (const pane of [dead, live])
    f.panels.add(pane as unknown as WebContentsView, () => {
      revokes++;
    });
  dead.owned.close();
  assert.equal(dead.webContents, undefined);
  f.window.emit('resize');
  f.quit.emit('before-quit');
  f.panels.close();
  assert.equal(revokes, 2);
  assert.equal(dead.owned.closes, 1);
  assert.equal(live.owned.closes, 1);
  assert.equal(f.window.contentView, f.dashboard);
});

test('partial pane attachment failure still closes its owned handle exactly once', () => {
  const f = setup();
  const pane = new Pane();
  let revokes = 0;
  f.window.contentView.failAdd = true;
  assert.throws(
    () =>
      f.panels.add(pane as unknown as WebContentsView, () => {
        revokes++;
      }),
    /partial construction/,
  );
  f.quit.emit('before-quit');
  f.panels.close();
  assert.equal(revokes, 1);
  assert.equal(pane.owned.closes, 1);
  assert.equal(f.window.contentView, f.dashboard);
});

test('window closed teardown and later beforeQuit remain idempotent', () => {
  const f = setup();
  const pane = new Pane();
  let revokes = 0;
  f.panels.add(pane as unknown as WebContentsView, () => {
    revokes++;
  });
  f.window.destroyed = true;
  f.window.emit('closed');
  f.quit.emit('before-quit');
  f.panels.close();
  assert.equal(revokes, 1);
  assert.equal(pane.owned.closes, 1);
  assert.equal(f.window.listenerCount('resize'), 0);
});

test('eight retained documents form a grid and survive hide, maximize, reorder and compact paging', () => {
  const f = setup();
  const panes = Array.from({ length: 8 }, () => new Pane());
  let revoked = 0;
  for (const pane of panes)
    f.panels.add(pane as unknown as WebContentsView, () => {
      revoked++;
    });
  const visible = () => panes.flatMap((_, index) => (f.panels.visible(index) ? [index] : []));
  const state = () =>
    panes[0]!.owned.messages.at(
      -1,
    ) as import('../apps/desktop/src/terminal-layout.js').TerminalLayoutState;
  try {
    f.panels.open(0);
    assert.equal(f.panels.act(0, 'show-all'), true);
    assert.equal(visible().length, 8);
    assert.equal(f.panels.act(0, { name: 'Frontend' }), true);
    assert.equal(state().names[0], 'Frontend');
    assert.equal(f.panels.act(0, 'move-later'), true);
    assert.deepEqual([...state().order], [1, 0, 2, 3, 4, 5, 6, 7]);
    assert.equal(f.panels.act(0, { moveTo: 7 }), true);
    assert.deepEqual([...state().order], [1, 2, 3, 4, 5, 6, 7, 0]);
    assert.equal(f.panels.act(3, 'maximize'), true);
    assert.deepEqual(visible(), [3]);
    assert.equal(f.panels.act(0, 'hide'), false); // Invisible senders cannot manage layout.
    assert.equal(f.panels.act(3, 'restore'), true);
    assert.equal(visible().length, 8);
    f.panels.hide(3);
    assert.equal(visible().length, 7);
    assert.ok(!visible().includes(3));
    f.panels.showDashboard();
    assert.deepEqual(visible(), []);
    f.panels.open(1);
    assert.equal(visible().length, 7); // Dashboard switching preserves the group.
    f.window.size = [600, 700];
    f.window.emit('resize');
    assert.deepEqual(visible(), [1]);
    assert.equal(f.panels.act(1, 'focus-other'), true);
    assert.deepEqual(visible(), [2]);
    f.window.size = [1600, 1800];
    f.window.emit('resize');
    assert.equal(visible().length, 7);
    assert.ok(panes.every((pane) => !pane.owned.destroyed));
    assert.ok(revoked > 0);
    assert.equal(f.panels.act(2, { tab: 8 }), false);
    panes[3]!.owned.close();
    assert.equal(f.panels.act(2, 'focus-other'), true);
    assert.equal(f.panels.visible(4), true); // Skip the failed sibling instead of trapping focus.
  } finally {
    f.panels.close();
  }
  assert.ok(panes.every((pane) => pane.owned.closes === 1));
});

test('preferences restore active selection and visible group without reloading documents', () => {
  const window = new Window();
  const initial = {
    axis: 'columns' as const,
    percent: 63,
    columns: 3 as const,
    order: [2, 0, 1],
    shown: [0, 2],
    active: 2,
    maximized: 2,
    names: ['A', 'B', 'C'],
  };
  let saved = initial;
  const panels = new TerminalPanels(window as unknown as BrowserWindow, {
    initial,
    save: (value) => {
      saved = value as typeof initial;
    },
  });
  const panes = Array.from({ length: 3 }, () => new Pane());
  for (const pane of panes) panels.add(pane as unknown as WebContentsView, () => {});
  panels.open(0);
  assert.ok(panels.visible(2));
  assert.equal(panels.act(2, 'restore'), true);
  assert.ok(panels.visible(0));
  assert.ok(!panels.visible(1));
  assert.deepEqual([...saved.order], [2, 0, 1]);
  assert.equal(saved.percent, 63);
  panels.close();
});

test('unavailable persistence reports memory-only while native views remain usable', () => {
  const window = new Window();
  const panels = new TerminalPanels(window as unknown as BrowserWindow, {
    save() {
      throw new Error('Synthetic disk failure');
    },
  });
  const pane = new Pane();
  panels.add(pane as unknown as WebContentsView, () => {});
  panels.open(0);
  const state = pane.owned.messages.at(
    -1,
  ) as import('../apps/desktop/src/terminal-layout.js').TerminalLayoutState;
  assert.equal(state.persisted, false);
  assert.equal(panels.visible(0), true);
  assert.equal(pane.owned.closes, 0);
  panels.close();
});
