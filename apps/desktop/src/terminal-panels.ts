import { View, type BrowserWindow, type WebContents, type WebContentsView } from 'electron';
import {
  parseTerminalViewAction,
  terminalPaneBounds,
  type TerminalLayoutState,
} from './terminal-layout.js';

/** Native sibling documents share one window, never an iframe or the observer preload. */
export class TerminalPanels {
  private readonly root = new View();
  private readonly dashboard: View;
  private readonly panes: Array<{
    view: WebContentsView;
    contents: WebContents;
    attached: boolean;
    revoke(): void;
  }> = [];
  private readonly shown = new Set<number>();
  private closed = false;
  private axis: TerminalLayoutState['axis'] = 'columns';
  private percent = 50;

  constructor(private readonly window: BrowserWindow) {
    this.dashboard = window.contentView;
    window.setContentView(this.root);
    this.root.addChildView(this.dashboard);
    window.on('resize', this.layout);
    window.on('closed', this.close);
    this.layout();
  }

  add(view: WebContentsView, revoke: () => void): number {
    if (this.closed) throw new Error('Terminal panels already closed');
    const slot = this.panes.length;
    // Electron can clear view.webContents after destruction; retain the owned handle.
    const pane = { view, contents: view.webContents, attached: false, revoke };
    this.panes.push(pane);
    this.root.addChildView(view);
    pane.attached = true;
    view.setVisible(false);
    this.layout();
    return slot;
  }

  visible(slot: number): boolean {
    return !this.closed && this.shown.has(slot) && this.window.isVisible();
  }

  open(slot: number): void {
    const pane = this.panes[slot];
    if (this.closed || !pane || pane.contents.isDestroyed()) return;
    this.shown.add(slot);
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.layout();
    this.window.focus();
    pane.contents.focus();
  }

  /** Sender/activation checks belong to the dedicated native document binding. */
  act(slot: number, raw: unknown): boolean {
    const action = parseTerminalViewAction(raw);
    if (!action || this.closed || !this.shown.has(slot)) return false;
    const paired = this.panes.length === 2;
    if (action === 'dashboard') this.showDashboard();
    else if (action === 'hide') this.hide(slot);
    else if (action === 'tab-a' || action === 'tab-b') {
      const target = action === 'tab-a' ? 0 : 1;
      if (!this.panes[target]) return false;
      this.revokeAll();
      this.shown.clear();
      this.open(target);
    } else if (action === 'maximize') {
      this.revokeAll();
      this.shown.clear();
      this.open(slot);
    } else {
      if (!paired) return false;
      if (action === 'focus-other') {
        this.revokeAll();
        this.open(slot === 0 ? 1 : 0);
      } else {
        this.revokeAll();
        if (typeof action === 'object') this.percent = action.percent;
        else {
          if (action === 'split-columns') this.axis = 'columns';
          if (action === 'split-rows') this.axis = 'rows';
          this.shown.add(0);
          this.shown.add(1);
        }
        this.layout();
      }
    }
    return true;
  }

  private revokeAll(): void {
    for (const pane of this.panes) pane.revoke();
  }

  hide(slot: number): void {
    this.revokeAll();
    this.shown.delete(slot);
    this.layout();
    const next = this.shown.values().next().value;
    if (next === undefined) this.window.webContents.focus();
    else this.panes[next]?.contents.focus();
  }

  showDashboard(): void {
    this.revokeAll();
    this.shown.clear();
    this.layout();
    this.window.webContents.focus();
  }

  private readonly layout = (): void => {
    if (this.closed || this.window.isDestroyed()) return;
    const [width = 0, height = 0] = this.window.getContentSize();
    this.root.setBounds({ x: 0, y: 0, width, height });
    this.dashboard.setBounds({ x: 0, y: 0, width, height });
    this.dashboard.setVisible(this.shown.size === 0);
    const visible = [...this.shown].sort();
    const state: TerminalLayoutState = {
      axis: this.axis,
      percent: this.percent,
      visible,
      count: this.panes.length,
    };
    for (const [slot, { view, contents }] of this.panes.entries()) {
      const position = visible.indexOf(slot);
      if (contents.isDestroyed()) continue;
      view.setVisible(position !== -1);
      contents.send('orqst:terminal-layout', state);
      if (position === -1) continue;
      view.setBounds(
        terminalPaneBounds(width, height, position, visible.length, this.axis, this.percent),
      );
    }
  };

  readonly close = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.window.removeListener('resize', this.layout);
    this.window.removeListener('closed', this.close);
    for (const { view, contents, attached, revoke } of this.panes) {
      revoke();
      if (attached && !this.window.isDestroyed()) this.root.removeChildView(view);
      if (!contents.isDestroyed()) contents.close();
    }
    this.shown.clear();
    // A failed pair construction restores the live dashboard, including in-memory drafts.
    if (!this.window.isDestroyed()) {
      this.root.removeChildView(this.dashboard);
      this.window.setContentView(this.dashboard);
    }
  };
}
