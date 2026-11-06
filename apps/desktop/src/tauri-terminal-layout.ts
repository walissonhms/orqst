import {
  parseTerminalViewAction,
  terminalGridBounds,
  terminalGridPage,
  type TerminalLayoutPreferences,
  type TerminalLayoutState,
  type TerminalViewAction,
} from './terminal-layout.js';
import {
  featureNativeRequestSchema,
  terminalDisplayNameSchema,
  type FeatureNativeRequest,
} from '@orqst/protocol';

type Arrangement = Extract<FeatureNativeRequest, { action: 'arrange' }>;

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
  private arrangement?: Arrangement;

  constructor(
    private count: number,
    private preferences: {
      initial?: TerminalLayoutPreferences;
      save(state: TerminalLayoutPreferences): void | Promise<void>;
    },
    private readonly send: (value: object) => void,
    private readonly revoke: (slot: number) => void,
    private readonly studio = false,
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
      visible:
        this.suspended || this.canvas || (this.studio && this.chrome && !this.arrangement)
          ? []
          : this.arrangement
            ? this.arrangement.panes
                .filter((pane) => pane.visible)
                .sort((a, b) => a.z - b.z)
                .map((pane) => pane.slot)
            : page.visible,
      count: this.count,
      persisted: this.persisted,
      suspended: this.suspended,
      workspaceChrome: this.chrome,
      canvas: this.canvas,
    };
  }

  private publish(focus: number | null = null): void {
    const state = this.snapshot();
    const custom =
      this.arrangement && !state.suspended && !state.canvas ? this.arrangement : undefined;
    const requestedChrome = custom?.layoutVersion === 2 ? custom.chrome : undefined;
    const left = this.chrome ? (requestedChrome?.sidebar ?? (this.width <= 720 ? 46 : 155)) : 0;
    const top = this.chrome ? (requestedChrome?.top ?? 81) : 0;
    const bottom = this.chrome ? (requestedChrome?.bottom ?? 34) : 0;
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
      kind: custom ? 'layout-v2' : 'layout',
      ...(custom ? { mode: custom.mode } : {}),
      ...(custom?.layoutVersion === 2 ? { arrangementVersion: 2 } : {}),
      generation: this.nativeGeneration,
      revision: ++this.layoutRevision,
      viewport: { width: this.width, height: this.height },
      state,
      insets: { left, top, bottom },
      focus: focus !== null && state.visible.includes(focus) ? focus : null,
      bounds: Array.from({ length: this.count }, (_, slot) => {
        const position = state.visible.indexOf(slot);
        const placement = custom?.panes.find((pane) => pane.slot === slot);
        if (custom) {
          const rect = placement?.visible ? placement.rect : null;
          const rounded = rect
            ? {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.x + rect.width) - Math.round(rect.x),
                height: Math.round(rect.y + rect.height) - Math.round(rect.y),
              }
            : null;
          return {
            slot,
            rect: rounded ? this.offset(rounded, left, top) : null,
            z: position < 0 ? 0 : position,
          };
        }
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

  /** Apply geometry only, keeping the retained PTYs and their process ownership unchanged. */
  arrange(input: Arrangement): boolean {
    if (
      this.suspended ||
      !this.chrome ||
      (this.studio && input.layoutVersion !== 2) ||
      !featureNativeRequestSchema.safeParse(input).success
    )
      return false;
    const requestedChrome = input.layoutVersion === 2 ? input.chrome : undefined;
    const left = requestedChrome?.sidebar ?? (this.width <= 720 ? 46 : 155);
    const width = this.width - left;
    const height = this.height - (requestedChrome?.top ?? 81) - (requestedChrome?.bottom ?? 34);
    if (
      width <= 0 ||
      height <= 0 ||
      input.viewport.width !== width ||
      input.viewport.height !== height ||
      input.panes.length !== this.state.order.length ||
      new Set(input.panes.map((pane) => pane.slot)).size !== input.panes.length ||
      input.panes.some((pane) => !this.state.order.includes(pane.slot))
    )
      return false;
    const visible = input.panes.filter((pane) => pane.visible);
    if ((input.mode === 'list' && visible.length) || (input.mode === 'focus' && visible.length > 1))
      return false;
    for (const pane of input.panes) {
      const rect = pane.rect;
      if (
        pane.visible !== (rect !== null) ||
        !Number.isInteger(pane.z) ||
        pane.z < 0 ||
        pane.z > 255
      )
        return false;
      if (!rect) continue;
      if (
        ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
        rect.x < 0 ||
        rect.y < 0 ||
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.x + rect.width > width ||
        rect.y + rect.height > height ||
        Math.round(rect.x + rect.width) <= Math.round(rect.x) ||
        Math.round(rect.y + rect.height) <= Math.round(rect.y)
      )
        return false;
    }
    const overlaps = (a: NonNullable<Arrangement['panes'][number]['rect']>, b: typeof a) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    if (
      input.mode !== 'free' &&
      visible.some((a, i) => visible.slice(i + 1).some((b) => overlaps(a.rect!, b.rect!)))
    )
      return false;
    const prior = this.arrangement;
    const topology = (value: Arrangement | undefined) =>
      JSON.stringify(
        value?.panes
          .filter((p) => p.visible)
          .sort((a, b) => a.z - b.z)
          .map((p) => p.slot) ?? [],
      );
    const covered = (value: Arrangement | undefined) => {
      const stack = value?.panes.filter((pane) => pane.visible).sort((a, b) => a.z - b.z) ?? [];
      const index = stack.findIndex((pane) => pane.slot === this.state.active);
      const active = stack[index];
      return !!active && stack.slice(index + 1).some((pane) => overlaps(active.rect!, pane.rect!));
    };
    if (
      !prior ||
      topology(prior) !== topology(input) ||
      JSON.stringify(prior.chrome ?? null) !== JSON.stringify(input.chrome ?? null)
    ) {
      for (let slot = 0; slot < this.count; slot++) this.revoke(slot);
    } else if (!covered(prior) && covered(input)) this.revoke(this.state.active);
    this.state.shown = this.state.order.filter(
      (slot) => this.state.shown.includes(slot) || visible.some((pane) => pane.slot === slot),
    );
    this.arrangement = structuredClone(input);
    this.canvas = false;
    this.publish();
    return true;
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
    this.arrangement = undefined;
    this.presentation++;
    // A new native fence invalidates every old Studio rectangle immediately.
    if (this.studio && this.chrome) {
      for (let slot = 0; slot < this.count; slot++) this.revoke(slot);
      this.publish();
    }
  }

  presentationRevision(): number {
    return this.presentation;
  }

  /** A summary view never changes pane membership, hidden preferences or process state. */
  showCanvas(): void {
    this.arrangement = undefined;
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
    this.arrangement = undefined;
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
    if (this.arrangement)
      this.arrangement = {
        ...this.arrangement,
        mode: 'list',
        panes: this.arrangement.panes.map((pane) => ({ ...pane, visible: false, rect: null })),
      };
    const after = this.snapshot().visible;
    for (const slot of before) if (!after.includes(slot)) this.revoke(slot);
    this.publish();
  }

  suspend(): void {
    this.arrangement = undefined;
    this.presentation++;
    this.suspended = true;
    for (let slot = 0; slot < this.count; slot++) this.revoke(slot);
    this.publish();
  }

  focus(slot: number): void {
    if (!this.snapshot().visible.includes(slot)) return;
    if (this.arrangement?.mode === 'free') {
      const stack = this.arrangement.panes.filter((pane) => pane.visible).sort((a, b) => a.z - b.z);
      if (stack.at(-1)?.slot !== slot) {
        const ordered = [
          ...stack.filter((pane) => pane.slot !== slot),
          ...stack.filter((pane) => pane.slot === slot),
        ];
        this.arrangement = {
          ...this.arrangement,
          panes: this.arrangement.panes.map((pane) => ({
            ...pane,
            z: Math.max(
              0,
              ordered.findIndex((item) => item.slot === pane.slot),
            ),
          })),
        };
        this.publish();
      }
    }
    if (this.state.active === slot) return;
    this.state.active = slot;
    this.persist();
    this.publish();
  }

  open(slot: number): boolean {
    if (this.firstOpen && slot === 0 && this.preferences.initial) slot = this.state.active;
    if (!this.state.order.includes(slot)) return false;
    this.arrangement = undefined;
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
      this.arrangement = undefined;
      this.state.shown = [slot, ...this.state.shown.filter((index) => index !== slot)];
      this.state.maximized = null;
      this.state.active = slot;
      this.changed(null);
      return true;
    }
    if (!this.snapshot().visible.includes(slot)) return false;
    this.arrangement = undefined;
    return this.apply(slot, action);
  }

  /** Explicit native workspace controls may address off-page/minimized members, never processes. */
  workspaceAct(slot: number, raw: unknown): boolean {
    if (this.suspended || !this.state.order.includes(slot)) return false;
    if (raw === 'focus') {
      this.arrangement = undefined;
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
    this.arrangement = undefined;
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

  /** Private native creation metadata only. Naming never shows or starts a pane. */
  nameOwned(slot: number, raw: unknown): boolean {
    const name = terminalDisplayNameSchema.safeParse(raw);
    if (!name.success || !this.state.order.includes(slot)) return false;
    this.state.names[slot] = name.data.trim();
    this.changed();
    return true;
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
