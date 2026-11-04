import { View, type BrowserWindow, type WebContents, type WebContentsView } from 'electron';
import {
  parseTerminalViewAction,
  terminalGridBounds,
  terminalGridPage,
  type TerminalLayoutPreferences,
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
  private columns: TerminalLayoutPreferences['columns'] = 2;
  private order: number[] = [];
  private names: string[] = [];
  private active = 0;
  private maximized: number | null = null;
  private displayed = new Set<number>();
  private persisted = true;
  private firstOpen = true;
  private suspended = false;

  constructor(
    private readonly window: BrowserWindow,
    private readonly preferences?: {
      initial?: TerminalLayoutPreferences;
      save(state: TerminalLayoutPreferences): void;
    },
  ) {
    const initial = preferences?.initial;
    if (initial) {
      this.axis = initial.axis;
      this.percent = initial.percent;
      this.columns = initial.columns;
      this.order = [...initial.order];
      this.names = [...initial.names];
      this.active = initial.active;
      this.maximized = initial.maximized;
      for (const slot of initial.shown) this.shown.add(slot);
    }
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
    if (!this.order.includes(slot)) this.order.push(slot);
    this.names[slot] ??= '';
    this.root.addChildView(view);
    pane.attached = true;
    pane.contents.on('focus', () => {
      if (this.displayed.has(slot) && this.active !== slot) {
        this.active = slot;
        this.changed();
      }
    });
    view.setVisible(false);
    this.layout();
    return slot;
  }

  visible(slot: number): boolean {
    return !this.closed && this.displayed.has(slot) && this.window.isVisible();
  }

  open(slot: number): void {
    if (this.firstOpen && slot === 0 && this.preferences?.initial) slot = this.active;
    const pane = this.panes[slot];
    if (this.closed || !pane || pane.contents.isDestroyed()) return;
    this.firstOpen = false;
    this.suspended = false;
    this.revokeAll();
    this.active = slot;
    this.shown.add(slot);
    if (this.maximized !== null) this.maximized = slot;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.changed();
    this.window.focus();
    pane.contents.focus();
  }

  /** Sender/activation checks belong to the dedicated native document binding. */
  act(slot: number, raw: unknown): boolean {
    const action = parseTerminalViewAction(raw);
    if (!action || this.closed || !this.displayed.has(slot)) return false;
    if (action === 'dashboard') this.showDashboard();
    else if (action === 'hide') this.hide(slot);
    else if (action === 'focus-other') {
      const position = this.order.indexOf(slot);
      const candidates = [...this.order.slice(position + 1), ...this.order.slice(0, position)];
      const next = candidates.find((index) => !this.panes[index]?.contents.isDestroyed());
      if (next === undefined) return false;
      this.open(next);
    } else if (
      action === 'tab-a' ||
      action === 'tab-b' ||
      (typeof action === 'object' && 'tab' in action)
    ) {
      const target = typeof action === 'object' ? action.tab : action === 'tab-a' ? 0 : 1;
      if (!this.panes[target] || this.panes[target]!.contents.isDestroyed()) return false;
      this.maximized = target;
      this.open(target);
    } else {
      this.revokeAll();
      this.active = slot;
      if (action === 'maximize') this.maximized = slot;
      else if (action === 'restore') this.maximized = null;
      else if (action === 'show-all') {
        this.maximized = null;
        for (const index of this.order) this.shown.add(index);
      } else if (action === 'split-columns' || action === 'split-rows') {
        this.axis = action === 'split-columns' ? 'columns' : 'rows';
        this.maximized = null;
        if (this.shown.size === 1 && this.panes.length > 1)
          this.shown.add(this.order[(this.order.indexOf(slot) + 1) % this.order.length]!);
      } else if (typeof action === 'object' && 'percent' in action) this.percent = action.percent;
      else if (typeof action === 'object' && 'columns' in action) {
        this.columns = action.columns;
        this.axis = 'columns';
      } else if (typeof action === 'object' && 'name' in action) this.names[slot] = action.name;
      else {
        const position = this.order.indexOf(slot);
        const target =
          typeof action === 'object' && 'moveTo' in action
            ? this.order.indexOf(action.moveTo)
            : position + (action === 'move-earlier' ? -1 : 1);
        if (target < 0 || target >= this.order.length) return false;
        this.order.splice(position, 1);
        this.order.splice(target, 0, slot);
      }
      this.changed();
    }
    return true;
  }

  private snapshot(): TerminalLayoutPreferences {
    return {
      axis: this.axis,
      percent: this.percent,
      columns: this.columns,
      order: [...this.order],
      shown: [...this.shown],
      active: this.active,
      maximized: this.maximized,
      names: [...this.names],
    };
  }

  private changed(): void {
    try {
      this.preferences?.save(this.snapshot());
      this.persisted = true;
    } catch {
      this.persisted = false;
    }
    this.layout();
  }

  private revokeAll(): void {
    for (const pane of this.panes) pane.revoke();
  }

  hide(slot: number): void {
    this.revokeAll();
    this.shown.delete(slot);
    this.maximized = null;
    const next = this.order.find(
      (index) => this.shown.has(index) && !this.panes[index]?.contents.isDestroyed(),
    );
    if (next !== undefined) this.active = next;
    this.changed();
    if (next === undefined) this.window.webContents.focus();
    else this.panes[next]?.contents.focus();
  }

  showDashboard(): void {
    this.revokeAll();
    this.suspended = true;
    this.layout();
    this.window.webContents.focus();
  }

  private readonly layout = (): void => {
    if (this.closed || this.window.isDestroyed()) return;
    const [width = 0, height = 0] = this.window.getContentSize();
    this.root.setBounds({ x: 0, y: 0, width, height });
    this.dashboard.setBounds({ x: 0, y: 0, width, height });
    const shown = this.order.filter(
      (slot) =>
        this.shown.has(slot) && this.panes[slot] && !this.panes[slot]!.contents.isDestroyed(),
    );
    const page = terminalGridPage(
      width,
      height,
      this.maximized === null ? shown : shown.filter((slot) => slot === this.maximized),
      this.active,
      this.columns,
      this.axis,
    );
    const visible = this.suspended ? [] : page.visible;
    const previous = this.displayed;
    this.displayed = new Set(visible);
    // Responsive paging also revokes a document that has just become hidden.
    for (const slot of previous) if (!this.displayed.has(slot)) this.panes[slot]?.revoke();
    this.dashboard.setVisible(visible.length === 0);
    const state: TerminalLayoutState = {
      ...this.snapshot(),
      visible,
      count: this.panes.length,
      persisted: this.persisted,
    };
    for (const [slot, { view, contents }] of this.panes.entries()) {
      const position = visible.indexOf(slot);
      if (contents.isDestroyed()) continue;
      view.setVisible(position !== -1);
      contents.send('orqst:terminal-layout', state);
      if (position === -1) continue;
      view.setBounds(
        terminalGridBounds(
          width,
          height,
          position,
          visible.length,
          this.axis,
          this.percent,
          page.columns,
        ),
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
