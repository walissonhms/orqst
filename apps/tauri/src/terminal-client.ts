import { invoke } from '@tauri-apps/api/core';
import { createTerminalClient } from '../../desktop/src/terminal-client.js';
import {
  parseTerminalViewAction,
  type TerminalLayoutState,
} from '../../desktop/src/terminal-layout.js';

// Tauri currently presents one independent native window per terminal. Keep the
// shared renderer's layout contract complete without advertising an Electron grid.
const slot = Number(document.querySelector<HTMLElement>('main')!.dataset.slot);
const order = [...document.querySelectorAll<HTMLElement>('[data-tab]')].map((tab) =>
  Number(tab.dataset.tab),
);
const state: TerminalLayoutState = {
  axis: 'columns',
  percent: 50,
  columns: 1,
  order,
  shown: [slot],
  active: slot,
  maximized: null,
  names: order.map(() => ''),
  visible: [slot],
  count: order.length,
  persisted: false,
};
const listeners = new Set<(value: TerminalLayoutState) => void>();
const heading = document.getElementById('pane-title');
if (heading) heading.draggable = false;

Object.defineProperty(window, 'orqstTerminal', {
  value: createTerminalClient(
    (request) => invoke('terminal_request', { request }),
    () => navigator.userActivation.isActive,
  ),
});
Object.defineProperty(window, 'orqstTerminalPane', {
  value: Object.freeze({
    async show(raw: unknown) {
      const action = parseTerminalViewAction(raw);
      if (!action || !navigator.userActivation.isActive) return false;
      if (
        action !== 'dashboard' &&
        action !== 'hide' &&
        action !== 'maximize' &&
        action !== 'restore' &&
        !(typeof action === 'object' && 'tab' in action)
      )
        return false;
      const accepted = await invoke<boolean>('terminal_view', { action });
      if (accepted && (action === 'maximize' || action === 'restore')) {
        state.maximized = action === 'maximize' ? slot : null;
        for (const listener of listeners) listener(state);
      }
      return accepted;
    },
    onLayout(listener: (state: TerminalLayoutState) => void) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
  }),
});
void import('../../desktop/src/managed-terminal-client.js');
