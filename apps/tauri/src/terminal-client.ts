import { invoke } from '@tauri-apps/api/core';
import { terminalNativeReplySchema } from '@orqst/protocol';
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
void import('../../desktop/src/managed-terminal-client.js').then(() => {
  if (document.querySelector<HTMLElement>('main')?.dataset.operationalOpen !== 'true') return;
  let attempted = false;
  let busy = false;
  const open = async () => {
    if (attempted || busy) return;
    busy = true;
    try {
      // Native holds the one-use intent and rechecks actual Webview focus. This
      // call has no profile, path, authority or approval supplied by JavaScript.
      const result = await invoke<{ attempted: boolean; value?: unknown }>(
        'terminal_open_prepared',
      );
      if (!result.attempted) return;
      attempted = true;
      const reply = terminalNativeReplySchema.safeParse(result.value);
      window.dispatchEvent(
        new CustomEvent('orqst-terminal-open', {
          detail: reply.success ? reply.data : { status: 'denied' },
        }),
      );
    } catch {
      // An IPC failure is uncertain, never a reason to repeat opening on focus.
      attempted = true;
      window.dispatchEvent(
        new CustomEvent('orqst-terminal-open', { detail: { status: 'denied' } }),
      );
    } finally {
      busy = false;
    }
  };
  window.addEventListener('focus', () => void open());
  void open();
});
