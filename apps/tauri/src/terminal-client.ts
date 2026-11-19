import { invoke } from '@tauri-apps/api/core';
import { terminalNativeReplySchema } from '@orqst/protocol';
import { createTerminalClient } from '../../desktop/src/terminal-client.js';
import { awaitPreparedOpen } from './prepared-open.js';
import { installCanvasEscape } from './terminal-escape.js';
import {
  parseTerminalViewAction,
  type TerminalLayoutState,
} from '../../desktop/src/terminal-layout.js';

const listeners = new Set<(value: TerminalLayoutState) => void>();
// Escape is not a browser transient-activation key. This listener accepts only a trusted
// physical key event; Rust still checks the actual owned Webview and native focus.
const removeCanvasEscape = installCanvasEscape(() => {
  void invoke<boolean>('terminal_view', { action: 'canvas' })
    .then((accepted) => {
      if (!accepted) window.dispatchEvent(new Event('orqst-canvas-escape-denied'));
    })
    .catch(() => window.dispatchEvent(new Event('orqst-canvas-escape-denied')));
});
window.addEventListener('pagehide', removeCanvasEscape, { once: true });
// Native checks the actual first responder and slot; no renderer focus claim grants input.
window.addEventListener('focus', () => {
  void invoke<boolean>('terminal_view', { action: 'note-focus' }).catch(() => {});
});
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
  const main = document.querySelector<HTMLElement>('main');
  const slot = Number(main?.dataset.slot);
  let requested = false;
  let live = true;
  const openVisible = async () => {
    if (requested || !live || !state?.visible.includes(slot)) return;
    requested = true;
    let value: unknown;
    try {
      value = await awaitPreparedOpen(
        () => invoke<{ attempted: boolean; value?: unknown }>('terminal_open_prepared'),
        () => new Promise((resolve) => window.setTimeout(resolve, 150)),
        () => live,
      );
      if (value === undefined && live) {
        const result = await invoke<{ attempted: boolean; value?: unknown }>(
          'terminal_open_prepared',
          { abandon: true },
        );
        value = result.value;
      }
    } catch {
      // The dispatch result is unknown. Never replay the operation.
    }
    if (!live) return;
    const reply = terminalNativeReplySchema.safeParse(value);
    window.dispatchEvent(
      new CustomEvent('orqst-terminal-open', {
        detail: reply.success ? reply.data : { status: 'unavailable' },
      }),
    );
  };
  listeners.add(openVisible);
  window.addEventListener(
    'pagehide',
    () => {
      live = false;
      listeners.delete(openVisible);
    },
    { once: true },
  );
  void openVisible();
});
