import { View, type BrowserWindow, type WebContentsView } from 'electron';

/** Native sibling documents share one window, never an iframe or the observer preload. */
export class TerminalPanels {
  private readonly root = new View();
  private readonly dashboard: View;
  private readonly panes: Array<{ view: WebContentsView; revoke(): void }> = [];
  private readonly shown = new Set<number>();
  private closed = false;

  constructor(private readonly window: BrowserWindow) {
    this.dashboard = window.contentView;
    window.setContentView(this.root);
    this.root.addChildView(this.dashboard);
    window.on('resize', this.layout);
    window.on('closed', this.close);
    this.layout();
  }

  add(view: WebContentsView, revoke: () => void): number {
    const slot = this.panes.length;
    this.panes.push({ view, revoke });
    this.root.addChildView(view);
    view.setVisible(false);
    this.layout();
    return slot;
  }

  visible(slot: number): boolean {
    return !this.closed && this.shown.has(slot) && this.window.isVisible();
  }

  open(slot: number): void {
    const pane = this.panes[slot];
    if (this.closed || !pane || pane.view.webContents.isDestroyed()) return;
    this.shown.add(slot);
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.layout();
    this.window.focus();
    pane.view.webContents.focus();
  }

  hide(slot: number): void {
    this.panes[slot]?.revoke();
    this.shown.delete(slot);
    this.layout();
    const next = this.shown.values().next().value;
    if (next === undefined) this.window.webContents.focus();
    else this.panes[next]?.view.webContents.focus();
  }

  showDashboard(): void {
    for (const pane of this.panes) pane.revoke();
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
    for (const [slot, { view }] of this.panes.entries()) {
      const position = visible.indexOf(slot);
      view.setVisible(position !== -1);
      if (position === -1) continue;
      const left = Math.floor((position * width) / visible.length);
      const right = Math.floor(((position + 1) * width) / visible.length);
      view.setBounds({ x: left, y: 0, width: right - left, height });
    }
  };

  readonly close = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.window.removeListener('resize', this.layout);
    this.window.removeListener('closed', this.close);
    for (const { view, revoke } of this.panes) {
      revoke();
      this.root.removeChildView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    // A failed pair construction restores the live dashboard, including in-memory drafts.
    if (!this.window.isDestroyed()) {
      this.root.removeChildView(this.dashboard);
      this.window.setContentView(this.dashboard);
    }
  };
}
