import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { TerminalLayoutState, TerminalViewAction } from './terminal-layout.js';
import type {
  DesktopTerminal,
  TerminalNativeRequest,
  TerminalNativeWireReply,
} from '@orqst/protocol';

const client = (window as unknown as { orqstTerminal: DesktopTerminal }).orqstTerminal;
const status = document.querySelector<HTMLElement>('#status')!;
const container = document.querySelector<HTMLElement>('#terminal')!;
Terminal.strings.promptLabel = container.dataset.keyboard ?? '';
Terminal.strings.tooMuchOutput = container.dataset.toomuch ?? '';
const terminal = new Terminal({
  allowProposedApi: false,
  scrollback: 2000,
  fontSize: 14,
  screenReaderMode: true,
  linkHandler: { activate: () => {} },
  windowOptions: {},
  theme: { background: '#080B1E', foreground: '#D9C9FF', cursor: '#B45CFF' },
});
const fit = new FitAddon();
terminal.loadAddon(fit);
terminal.open(container);
// Output cannot access clipboard or launch links. No WebLinks/clipboard addon is installed.
terminal.parser.registerOscHandler(52, () => true);
terminal.parser.registerOscHandler(8, () => true);
terminal.parser.registerOscHandler(0, () => true);
terminal.parser.registerOscHandler(2, () => true);
let instanceId: string | undefined;
let cursor = 0;
let sequence = 0;
let attached = false;
let input = false;
let busy = false;
let polling = false;
let pollInFlight: Promise<void> | undefined;
let actionPending = false;
let interactionGeneration = 0;
let gap = false;
let pending = '';
let live = false;
let gesture = false;
let gestureEnd: ReturnType<typeof setTimeout> | undefined;
const actions = ['login', 'start', 'attach', 'input', 'detach', 'stop', 'kill'] as const;
// Finish a button gesture before starting another background request on the shared transport.
const beginGesture = () => {
  clearTimeout(gestureEnd);
  gesture = true;
};
const endGesture = () => {
  clearTimeout(gestureEnd);
  // Space activates on keyup, and pointerup precedes click. Let that same gesture finish first.
  gestureEnd = setTimeout(() => {
    gesture = false;
  }, 0);
};
window.addEventListener('pointerup', endGesture);
window.addEventListener('pointercancel', endGesture);
window.addEventListener('keyup', endGesture);
window.addEventListener('blur', endGesture);
// A release in another native view need not reach this document.
document.addEventListener('pointerleave', endGesture);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    endGesture();
    revoke();
  }
});
const updateButtons = () => {
  for (const action of actions) {
    let disabled =
      (busy && !polling) ||
      actionPending ||
      status.dataset.blocked === 'true' ||
      document.getElementById(action)!.dataset.unavailable === 'true';
    if (action === 'login' || action === 'start')
      disabled ||= live || status.dataset.state === 'ownership_lost';
    else if (action === 'attach')
      disabled ||=
        !instanceId || attached || !['running', 'exited'].includes(status.dataset.state ?? '');
    else if (action === 'detach') disabled ||= !attached;
    else if (action === 'input') disabled ||= !attached || !live || gap;
    else disabled ||= !live;
    (document.getElementById(action) as HTMLButtonElement).disabled = disabled;
  }
};
const show = (key: string) => {
  status.textContent = status.dataset[key] ?? '';
};
const revoke = () => {
  interactionGeneration++;
  input = false;
  pending = '';
  show('revoked');
};

async function send(request: TerminalNativeRequest): Promise<TerminalNativeWireReply | undefined> {
  if (busy) return;
  busy = true;
  status.dataset.pending = 'true';
  updateButtons();
  try {
    const reply = await client.request(request);
    if (reply.status !== 'ok') {
      if (request.action === 'write' || request.action === 'paste') revoke();
      show(reply.status);
      return reply;
    }
    if (request.action !== 'read' && request.action !== 'snapshot' && request.action !== 'resize')
      show('ok');
    if (instanceId !== reply.instanceId) {
      terminal.reset();
      instanceId = reply.instanceId;
      status.dataset.instanceId = instanceId;
      document.getElementById('instance')!.textContent = instanceId;
      cursor = sequence = 0;
      lastColumns = 80;
      lastRows = 24;
      attached = input = gap = false;
      pending = '';
    }
    if (reply.snapshot) {
      status.dataset.state = reply.snapshot.state;
      const lifecycle = document.getElementById('lifecycle')!;
      lifecycle.textContent = lifecycle.dataset[reply.snapshot.state] ?? '';
      live = ['starting', 'running'].includes(reply.snapshot.state);
      if (!live) {
        input = false;
        pending = '';
      }
    }
    if (request.action === 'attach') {
      attached = true;
      fit.fit();
    }
    if (request.action === 'detach') {
      attached = false;
      revoke();
    }
    if (request.action === 'input') {
      input = true;
      sequence = 0;
      terminal.focus();
    }
    if (request.action === 'write' || request.action === 'paste') sequence++;
    if (reply.output) {
      cursor = reply.output.nextCursor;
      if (reply.output.gap) {
        gap = true;
        terminal.reset();
        revoke();
        show('gap');
      }
      // An evicted screen cannot be reconstructed safely. Keep it stopped, visibly, until new start.
      if (!gap)
        await new Promise<void>((resolve) =>
          terminal.write(Uint8Array.from(reply.output!.bytes), resolve),
        );
    }
    return reply;
  } finally {
    busy = false;
    status.dataset.pending = 'false';
    updateButtons();
  }
}

async function flush(): Promise<void> {
  if (busy || !pending || !instanceId || !input || !attached || gap || !document.hasFocus()) return;
  const text = pending;
  pending = '';
  await send({ version: 1, action: 'write', instanceId, sequence, text });
  if (pending) void flush();
}

// onData also contains automatic emulator replies. Forward only a trusted keyboard event.
terminal.onKey(({ key, domEvent }) => {
  if (!domEvent.isTrusted || !input || !attached || gap) return;
  if (byteLength(pending + key) > 4096) {
    revoke();
    return;
  }
  pending += key;
  void flush();
});
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
container.addEventListener(
  'paste',
  (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const text = event.clipboardData?.getData('text/plain');
    if (!event.isTrusted || !text || !input || !attached || gap || !instanceId || busy || pending)
      return;
    // Native dialog displays the exact bounded text; no automatic clipboard read or hidden paste.
    void send({ version: 1, action: 'paste', instanceId, sequence, text });
  },
  true,
);
container.addEventListener('drop', (event) => event.preventDefault(), true);
for (const action of actions) {
  const button = document.getElementById(action)!;
  button.addEventListener('pointerdown', (event) => {
    if (event.isPrimary && event.button === 0) beginGesture();
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') beginGesture();
  });
  button.addEventListener('blur', endGesture);
  button.addEventListener('click', async () => {
    if (actionPending || (busy && !polling)) {
      show('busy');
      return;
    }
    const generation = interactionGeneration;
    const target = instanceId;
    actionPending = true;
    updateButtons();
    try {
      // Finish only the already dispatched background read before handling this gesture.
      // There is no native request queue/retry; activation and native focus are checked anew.
      await pollInFlight;
      if (generation !== interactionGeneration || target !== instanceId) return;
      if (action === 'start' || action === 'login') {
        if (!live)
          await send({
            version: 1,
            action: 'start',
            profileId:
              action === 'login'
                ? 'codex-login-v1'
                : document.querySelector<HTMLElement>('main')!.dataset.startProfile!,
          });
        return;
      }
      if (!instanceId) return;
      if (action === 'input' && gap) return;
      if (action === 'stop' || action === 'kill')
        await send({
          version: 1,
          action: 'stop',
          instanceId,
          signal: action === 'kill' ? 'SIGKILL' : 'SIGTERM',
        });
      else await send({ version: 1, action, instanceId });
    } finally {
      actionPending = false;
      updateButtons();
    }
  });
}
window.addEventListener('blur', revoke);
let resize: ReturnType<typeof setTimeout> | undefined;
window.addEventListener('resize', () => {
  clearTimeout(resize);
  resize = setTimeout(() => {
    fit.fit();
  }, 150);
});
let ticks = 0;
let lastColumns = 80;
let lastRows = 24;
const poll = (request: TerminalNativeRequest) => {
  polling = true;
  pollInFlight = send(request)
    .then(() => {})
    .catch(revoke)
    .finally(() => {
      polling = false;
      pollInFlight = undefined;
      updateButtons();
    });
};
const timer = setInterval(() => {
  if (busy || actionPending || gesture || !instanceId) return;
  if (pending) {
    void flush();
    return;
  }
  const columns = Math.max(20, Math.min(300, terminal.cols));
  const rows = Math.max(5, Math.min(100, terminal.rows));
  if (attached && live && (columns !== lastColumns || rows !== lastRows)) {
    lastColumns = columns;
    lastRows = rows;
    poll({ version: 1, action: 'resize', instanceId, columns, rows });
    return;
  }
  if (++ticks % 5 === 0) poll({ version: 1, action: 'snapshot', instanceId });
  else if (attached && !gap) poll({ version: 1, action: 'read', instanceId, cursor });
}, 100);
window.addEventListener(
  'pagehide',
  () => {
    clearInterval(timer);
    revoke();
    terminal.dispose();
  },
  { once: true },
);
fit.fit();

updateButtons();

const pane = (
  window as unknown as {
    orqstTerminalPane: {
      show(action: TerminalViewAction): Promise<boolean>;
      onLayout(listener: (state: TerminalLayoutState) => void): () => void;
    };
  }
).orqstTerminalPane;
const layoutActions = [
  ['dashboard', 'dashboard'],
  ['hide-pane', 'hide'],
  ['tab-a', 'tab-a'],
  ['tab-b', 'tab-b'],
  ['split-columns', 'split-columns'],
  ['split-rows', 'split-rows'],
  ['maximize', 'maximize'],
  ['restore', 'restore'],
  ['focus-other', 'focus-other'],
] as const;
const changeLayout = (action: TerminalViewAction) => {
  revoke();
  void pane.show(action);
};
for (const [id, action] of layoutActions)
  document.getElementById(id)?.addEventListener('click', () => changeLayout(action));
const splitSize = document.getElementById('split-size') as HTMLInputElement;
splitSize.addEventListener('input', () => changeLayout({ percent: Number(splitSize.value) }));
const unsubscribeLayout = pane.onLayout((state) => {
  splitSize.value = String(state.percent);
  splitSize.disabled = state.visible.length !== 2;
  document.getElementById('split-value')!.textContent = `${state.percent}%`;
  for (const axis of ['columns', 'rows'])
    document
      .getElementById(`split-${axis}`)!
      .setAttribute('aria-pressed', String(state.visible.length === 2 && state.axis === axis));
  (document.getElementById('maximize') as HTMLButtonElement).disabled = state.visible.length === 1;
  (document.getElementById('restore') as HTMLButtonElement).disabled =
    state.count !== 2 || state.visible.length === 2;
});
window.addEventListener('pagehide', unsubscribeLayout, { once: true });
