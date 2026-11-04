import {
  parseTerminalViewAction,
  terminalGridBounds,
  terminalGridPage,
  type TerminalLayoutPreferences,
  type TerminalLayoutState,
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

  constructor(
    private readonly count: number,
    private readonly preferences: {
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

  snapshot(): TerminalLayoutState {
    const shown = this.state.order.filter((slot) => this.state.shown.includes(slot));
    const page = terminalGridPage(
      this.width,
      this.height,
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
      visible: this.suspended ? [] : page.visible,
      count: this.count,
      persisted: this.persisted,
    };
  }

  private publish(focus: number | null = null): void {
    const state = this.snapshot();
    const columns = terminalGridPage(
      this.width,
      this.height,
      state.visible,
      state.active,
      state.columns,
      state.axis,
    ).columns;
    this.send({
      kind: 'layout',
      state,
      focus,
      bounds: state.order.map((slot) => {
        const position = state.visible.indexOf(slot);
        return {
          slot,
          rect:
            position === -1
              ? null
              : terminalGridBounds(
                  this.width,
                  this.height,
                  position,
                  state.visible.length,
                  state.axis,
                  state.percent,
                  columns,
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

  private persist(): void {
    const revision = ++this.saveRevision;
    try {
      const pending = this.preferences.save(structuredClone(this.state));
      this.persisted = !pending;
      if (pending)
        void pending.then(
          () => {
            if (revision !== this.saveRevision) return;
            this.persisted = true;
            this.publish();
          },
          () => {
            if (revision !== this.saveRevision) return;
            this.persisted = false;
            this.publish();
          },
        );
    } catch {
      this.persisted = false;
    }
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
    this.state.active = slot;
    if (!this.state.shown.includes(slot)) this.state.shown.push(slot);
    if (this.state.maximized !== null) this.state.maximized = slot;
    this.changed(slot);
    return true;
  }

  act(slot: number, raw: unknown): boolean {
    const action = parseTerminalViewAction(raw);
    if (!action || !this.snapshot().visible.includes(slot)) return false;
    const state = this.state;
    if (action === 'dashboard') this.suspended = true;
    else if (action === 'hide') {
      state.shown = state.shown.filter((index) => index !== slot);
      state.maximized = null;
      state.active = state.order.find((index) => state.shown.includes(index)) ?? slot;
    } else if (action === 'focus-other') {
      return this.open(state.order[(state.order.indexOf(slot) + 1) % this.count]!);
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
        if (state.shown.length === 1 && this.count > 1)
          state.shown.push(state.order[(state.order.indexOf(slot) + 1) % this.count]!);
      } else if (typeof action === 'object' && 'percent' in action) state.percent = action.percent;
      else if (typeof action === 'object' && 'columns' in action) {
        state.columns = action.columns;
        state.axis = 'columns';
      } else if (typeof action === 'object' && 'name' in action) state.names[slot] = action.name;
      else {
        const position = state.order.indexOf(slot);
        const target =
          typeof action === 'object' && 'moveTo' in action
            ? state.order.indexOf(action.moveTo)
            : position + (action === 'move-earlier' ? -1 : 1);
        if (target < 0 || target >= this.count) return false;
        state.order.splice(position, 1);
        state.order.splice(target, 0, slot);
      }
      state.active = slot;
    }
    this.changed(action === 'hide' ? state.active : null);
    return true;
  }
}
