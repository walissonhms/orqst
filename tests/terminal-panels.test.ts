// Synthetic Electron surfaces only: no GUI, process ownership or reservation changes.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import type { BrowserWindow, WebContentsView } from 'electron';
import { build } from 'esbuild';

class Contents {
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
  send() {}
}
class View {
  children: View[] = [];
  failAdd = false;
  addChildView(view: View) {
    if (this.failAdd) throw new Error('Synthetic partial construction');
    this.children.push(view);
  }
  removeChildView(view: View) {
    this.children = this.children.filter((child) => child !== view);
  }
  setBounds() {}
  setVisible() {}
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
  isVisible() {
    return !this.destroyed;
  }
  getContentSize() {
    return [800, 600];
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
