import { invoke } from '@tauri-apps/api/core';
import { createTerminalClient } from '../../desktop/src/terminal-client.js';
import {
  parseTerminalViewAction,
  type TerminalLayoutState,
} from '../../desktop/src/terminal-layout.js';

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
      // Each native terminal is an independent window in this increment.
      listener({ axis: 'columns', percent: 50, visible: [0], count: 1 });
      return () => {};
    },
  }),
});
void import('../../desktop/src/managed-terminal-client.js');
