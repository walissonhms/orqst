import { invoke } from '@tauri-apps/api/core';
import { createTerminalClient } from '../../desktop/src/terminal-client.js';
import {
  parseTerminalViewAction,
  type TerminalLayoutState,
} from '../../desktop/src/terminal-layout.js';

const listeners = new Set<(value: TerminalLayoutState) => void>();
let state: TerminalLayoutState | undefined;
window.addEventListener('orqst-terminal-layout', (event) => {
  state = (event as CustomEvent<TerminalLayoutState>).detail;
  for (const listener of listeners) listener(state);
});
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
      return invoke<boolean>('terminal_view', { action });
    },
    onLayout(listener: (state: TerminalLayoutState) => void) {
      listeners.add(listener);
      if (state) listener(state);
      return () => listeners.delete(listener);
    },
  }),
});
void invoke<TerminalLayoutState>('terminal_view', { action: 'layout' }).then((value) => {
  // Native layout state has no process or input authority.
  if (!state) window.dispatchEvent(new CustomEvent('orqst-terminal-layout', { detail: value }));
});
void import('../../desktop/src/managed-terminal-client.js');
