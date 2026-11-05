import {
  parseTerminalViewAction,
  terminalGridBounds,
  terminalGridPage,
  type TerminalLayoutPreferences,
  type TerminalLayoutState,
  type TerminalViewAction,
} from './terminal-layout.js';

/** Native layout adapter only. No CLI, process, input or session recovery authority. */
export class TauriTerminalLayout {
  private state: TerminalLayoutPreferences;
  private width = 1280;
  private height = 860;
  private suspended = true;
  private persisted = true;
  private saveRevision = 0;
  private firstOpen = true;
  private chrome = false;
  private canvas = false;
  private readonly pendingSaves = new Set<Promise<void>>();
  private presentation = 0;
  private layoutRevision = 0;
  private nativeGeneration = 0;
  private saveError = false;

  constructor(
    private count: number,
    private preferences: {
      initial?: TerminalLayoutPreferences;
      save(state: TerminalLayoutPreferences): void | Promise<void>;
    },
    private readonly send: (value: object) => void,
    private readonly revoke: (slot: number) => void,
  ) {
    this.state = preferences.initial ?? {
      axis: 'columns',
      percent: 50,
      columns: 2,
      order: Array.from({ length: count }, (_, slot) => slot),
      shown: Array.from({ length: count }, (_, slot) => slot),
      active: 0,
      maximized: null,
      names: Array.from({ length: count }, () => ''),
    };
  }

  /** Reserve the confirmed slot without publishing before its native Webview exists. */
  append(slot: number): void {
    if (slot !== this.count || slot >= 8) throw new Error('Invalid layout append');
    this.count++;
    this.state.names.push('');
  }

  snapshot(): TerminalLayoutState {
    const left = this.chrome ? (this.width <= 720 ? 46 : 155) : 0;
    const width = Math.max(1, this.width - left);
    const height = Math.max(1, this.height - (this.chrome ? 115 : 0));
    const shown = this.state.order.filter((slot) => this.state.shown.includes(slot));
    const page = terminalGridPage(
      width,
      height,
      this.state.maximized === null ? shown : shown.filter((slot) => slot === this.state.maximized),
      this.state.active,
      this.state.columns,
      this.state.axis,
    );
    return {
      ...this.state,
      order: [...this.state.order],
      shown: [...this.state.shown],
      names: [...this.state.names],
      visible: this.suspended || this.canvas ? [] : page.visible,
      count: this.count,
      persisted: this.persisted,
      suspended: this.suspended,
      workspaceChrome: this.chrome,
      canvas: this.canvas,
    };
  }

  private publish(focus: number | null = null): void {
    const state = this.snapshot();
    const left = this.chrome ? (this.width <= 720 ? 46 : 155) : 0;
    const top = this.chrome ? 81 : 0;
    const bottom = this.chrome ? 34 : 0;
    const width = Math.max(1, this.width - left);
    const height = Math.max(1, this.height - top - bottom);
    const columns = terminalGridPage(
      width,
      height,
      state.visible,
      state.active,
      state.columns,
      state.axis,
    ).columns;
    this.send({
      kind: 'layout',
      generation: this.nativeGeneration,
      revision: ++this.layoutRevision,
      viewport: { width: this.width, height: this.height },
      state,
      insets: { left, top, bottom },
      focus,
      bounds: Array.from({ length: this.count }, (_, slot) => {
        const position = state.visible.indexOf(slot);
        return {
          slot,
          rect:
            position === -1
              ? null
              : this.offset(
                  terminalGridBounds(
                    width,
                    height,
                    position,
                    state.visible.length,
                    state.axis,
                    state.percent,
                    columns,
                  ),
                  left,
                  top,
                ),
        };
      }),
    });
  }

  private changed(focus: number | null = null): void {
    for (let slot = 0; slot < this.count; slot++) this.revoke(slot);
    this.persist();
    this.publish(focus);
  }

  private offset(
    rect: { x: number; y: number; width: number; height: number },
    left: number,
    top: number,
  ) {
    return { ...rect, x: rect.x + left, y: rect.y + top };
  }

  private persist(): void {
    const revision = ++this.saveRevision;
    const finished = (saved: boolean) => {
      if (revision !== this.saveRevision) return;
      this.saveError = !saved;
      this.persisted = saved;
      this.publish();
    };
    try {
      const pending = this.preferences.save(structuredClone(this.state));
      this.persisted = !pending;
      this.saveError = false;
      if (pending) {
        const tracked = pending.then(
          () => finished(true),
          () => finished(false),
        );
        this.pendingSaves.add(tracked);
        void tracked.finally(() => this.pendingSaves.delete(tracked));
      }
    } catch {
      this.persisted = false;
      this.saveError = true;
    }
  }

  async flush(): Promise<void> {
    await Promise.all(this.pendingSaves);
    if (this.saveError) throw new Error('Layout save unconfirmed');
  }

  setNativeGeneration(generation: number): void {
    if (generation <= this.nativeGeneration) return;
    this.nativeGeneration = generation;
    this.presentation++;
  }

  presentationRevision(): number {
    return this.presentation;
  }

  /** A summary view never changes pane membership, hidden preferences or process state. */
  showCanvas(): void {
    this.suspended = false;
    this.canvas = true;
    for (let slot = 0; slot < this.count; slot++) this.revoke(slot);
    this.publish();
  }

  /** Replaces only visual metadata. Documents, supervisors and input authority stay external. */
  context(
    initial: TerminalLayoutPreferences,
    save: (state: TerminalLayoutPreferences) => void | Promise<void>,
    open = true,
    canvas = false,
  ): void {
    for (let slot = 0; slot < this.count; slot++) this.revoke(slot);
    this.presentation++;
    this.saveRevision++;
    this.preferences = { initial, save };
    this.state = structuredClone(initial);
    this.saveError = false;
    this.persisted = true;
    this.firstOpen = false;
    this.chrome = true;
    this.canvas = canvas;
    this.suspended = !open;
    this.publish();
  }

  resize(width: number, height: number): void {
    const before = this.snapshot().visible;
    this.width = width;
    this.height = height;
    const after = this.snapshot().visible;
    for (const slot of before) if (!after.includes(slot)) this.revoke(slot);
    this.publish();
  }

  suspend(): void {
    this.presentation++;
    this.suspended = true;
    for (let slot = 0; slot < this.count; slot++) this.revoke(slot);
    this.publish();
  }

  focus(slot: number): void {
    if (this.state.active === slot || !this.snapshot().visible.includes(slot)) return;
    this.state.active = slot;
    this.persist();
    this.publish();
  }

  open(slot: number): boolean {
    if (this.firstOpen && slot === 0 && this.preferences.initial) slot = this.state.active;
    if (!this.state.order.includes(slot)) return false;
    this.firstOpen = false;
    this.suspended = false;
    this.canvas = false;
    this.state.active = slot;
    if (!this.state.shown.includes(slot)) this.state.shown.push(slot);
    if (this.state.maximized !== null) this.state.maximized = slot;
    this.changed(slot);
    return true;
  }

  act(slot: number, raw: unknown, generation?: number): boolean {
    const action = parseTerminalViewAction(raw);
    if (!action) return false;
    // Dock restore only re-shows an existing hidden pane; it never starts a process.
    if (action === 'reopen') {
      if (
        generation !== this.nativeGeneration ||
        this.suspended ||
        !this.state.order.includes(slot)
      )
        return false;
      this.state.shown = [slot, ...this.state.shown.filter((index) => index !== slot)];
      this.state.maximized = null;
      this.state.active = slot;
      this.changed(null);
      return true;
    }
    if (!this.snapshot().visible.includes(slot)) return false;
    return this.apply(slot, action);
  }

  /** Explicit native workspace controls may address off-page/minimized members, never processes. */
  workspaceAct(slot: number, raw: unknown): boolean {
    if (this.suspended || !this.state.order.includes(slot)) return false;
    if (raw === 'focus') {
      this.canvas = false;
      this.state.active = slot;
      this.state.maximized = slot;
      if (!this.state.shown.includes(slot)) this.state.shown.push(slot);
      this.changed();
      return true;
    }
    const action = parseTerminalViewAction(raw);
    if (
      !action ||
      !(
        ['hide', 'maximize', 'restore', 'move-earlier', 'move-later', 'show-all'].includes(
          action as string,
        ) ||
        (typeof action === 'object' &&
          ('name' in action || 'moveTo' in action || 'columns' in action))
      ) ||
      (typeof action === 'object' &&
        'moveTo' in action &&
        !this.state.order.includes(action.moveTo))
    )
      return false;
    // Maximizing an explicitly selected tab restores only that pane, not other minimized panes.
    if (action === 'maximize' && !this.state.shown.includes(slot)) this.state.shown.push(slot);
    if (
      action === 'maximize' ||
      action === 'restore' ||
      action === 'show-all' ||
      (typeof action === 'object' && 'columns' in action)
    )
      this.canvas = false;
    return this.apply(slot, action, false);
  }

  private apply(slot: number, action: TerminalViewAction, nativeFocus = true): boolean {
    const state = this.state;
    if (action === 'canvas') {
      this.showCanvas();
      return true;
    } else if (action === 'dashboard') {
      this.presentation++;
      this.suspended = true;
    } else if (action === 'hide') {
      state.shown = state.shown.filter((index) => index !== slot);
      state.maximized = null;
      state.active = state.order.find((index) => state.shown.includes(index)) ?? slot;
    } else if (action === 'focus-other') {
      return this.open(state.order[(state.order.indexOf(slot) + 1) % state.order.length]!);
    } else if (
      action === 'tab-a' ||
      action === 'tab-b' ||
      (typeof action === 'object' && 'tab' in action)
    ) {
      const target = typeof action === 'object' ? action.tab : action === 'tab-a' ? 0 : 1;
      if (!state.order.includes(target)) return false;
      state.maximized = target;
      return this.open(target);
    } else {
      if (action === 'maximize') state.maximized = slot;
      else if (action === 'restore') state.maximized = null;
      else if (action === 'show-all') {
        state.maximized = null;
        state.shown = [...state.order];
      } else if (action === 'split-columns' || action === 'split-rows') {
        state.axis = action === 'split-columns' ? 'columns' : 'rows';
        state.maximized = null;
        if (state.shown.length === 1 && state.order.length > 1)
          state.shown.push(state.order[(state.order.indexOf(slot) + 1) % state.order.length]!);
      } else if (typeof action === 'object' && 'percent' in action) state.percent = action.percent;
      else if (typeof action === 'object' && 'columns' in action) {
        state.columns = action.columns;
        state.axis = 'columns';
        state.maximized = null;
      } else if (typeof action === 'object' && 'name' in action) state.names[slot] = action.name;
      else {
        const position = state.order.indexOf(slot);
        const target =
          typeof action === 'object' && 'moveTo' in action
            ? state.order.indexOf(action.moveTo)
            : position + (action === 'move-earlier' ? -1 : 1);
        if (target < 0 || target >= state.order.length) return false;
        state.order.splice(position, 1);
        state.order.splice(target, 0, slot);
      }
      state.active = slot;
    }
    this.changed(action === 'hide' && nativeFocus ? state.active : null);
    return true;
  }
}
