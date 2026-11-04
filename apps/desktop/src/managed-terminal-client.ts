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
const palette = getComputedStyle(document.documentElement);
const terminal = new Terminal({
  allowProposedApi: false,
  scrollback: 2000,
  fontSize: 14,
  screenReaderMode: true,
  linkHandler: { activate: () => {} },
  windowOptions: {},
  theme: {
    background: palette.getPropertyValue('--orqst-background').trim(),
    foreground: palette.getPropertyValue('--orqst-text').trim(),
    cursor: palette.getPropertyValue('--orqst-neon').trim(),
  },
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
const updateGuidance = () => {
  const guidance = document.getElementById('guidance');
  if (!guidance) return;
  const state = status.dataset.state;
  const key =
    status.dataset.blocked === 'true'
      ? 'blocked'
      : state === 'ownership_lost'
        ? 'uncertain'
        : gap
          ? 'gap'
          : state === 'exited' || state === 'start_failed'
            ? 'exited'
            : !live
              ? 'start'
              : !attached
                ? 'attach'
                : input
                  ? 'typing'
                  : 'input';
  const main = document.querySelector('main');
  if (main) main.dataset.next = key;
  const message = guidance.dataset[key] ?? '';
  if (guidance.textContent !== message) guidance.textContent = message;
};
const updateButtons = () => {
  updateGuidance();
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
  // Focus loss must never replace a relevant refusal or output gap with a benign notice.
  if (key === 'revoked' && status.dataset.feedback === 'error') return;
  status.dataset.feedback = [
    'denied',
    'cancelled',
    'gap',
    'focus_required',
    'unavailable',
  ].includes(key)
    ? 'error'
    : 'info';
  status.textContent = status.dataset[key] ?? '';
};
const revoke = () => {
  interactionGeneration++;
  input = false;
  pending = '';
  show('revoked');
  updateGuidance();
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
      lifecycle.textContent = lifecycle.getAttribute(`data-short-${reply.snapshot.state}`) ?? '';
      lifecycle.title = lifecycle.dataset[reply.snapshot.state] ?? '';
      lifecycle.dataset.state = reply.snapshot.state;
      live = ['starting', 'running'].includes(reply.snapshot.state);
      if (!live) {
        input = false;
        pending = '';
      }
    }
    if (request.action === 'attach') {
      attached = true;
      fit.fit();
      // Compact chrome can place output below the outer scroll viewport. xterm pauses
      // painting/accessibility updates while off-screen; explicit attach reveals it
      // without changing the emulator's own scrollback position or buffer.
      container.scrollIntoView({ block: 'nearest' });
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
  } catch {
    revoke();
    show('unavailable');
    return undefined;
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
// Adapted from Anywh TerminalView.tsx at 546f189c04415c3c5af5f40e3931a0a90b9aba31
// (Apache-2.0). Observe the container, debounce fitting, and retain ORQST's bounded
// native resize polling instead of the upstream WebSocket/tmux resize operation.
const resizeObserver = new ResizeObserver(() => {
  clearTimeout(resize);
  resize = setTimeout(() => {
    fit.fit();
  }, 150);
});
resizeObserver.observe(container);
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
    clearTimeout(resize);
    resizeObserver.disconnect();
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
  ['split-columns', 'split-columns'],
  ['split-rows', 'split-rows'],
  ['maximize', 'maximize'],
  ['restore', 'restore'],
  ['focus-other', 'focus-other'],
  ['show-all', 'show-all'],
  ['move-earlier', 'move-earlier'],
  ['move-later', 'move-later'],
] as const;
const changeLayout = (action: TerminalViewAction) => {
  revoke();
  void pane
    .show(action)
    .then((accepted) => {
      if (!accepted) show('focus_required');
    })
    .catch(() => show('denied'));
};
for (const [id, action] of layoutActions)
  document.getElementById(id)?.addEventListener('click', () => changeLayout(action));
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
const slot = Number(document.querySelector<HTMLElement>('main')!.dataset.slot);
const heading = document.getElementById('pane-title')!;
const nameInput = document.getElementById('pane-name') as HTMLInputElement;
const columnChoice = document.getElementById('column-choice') as HTMLSelectElement;
const feedback = document.getElementById('layout-feedback')!;
let draggingOwnPane = false;
heading.addEventListener('dragstart', (event) => {
  draggingOwnPane = true;
  event.dataTransfer?.setData('text/plain', String(slot));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
});
heading.addEventListener('dragend', () => {
  draggingOwnPane = false;
});
for (const tab of tabs) {
  tab.dataset.provider = tab.textContent ?? '';
  tab.addEventListener('click', () => changeLayout({ tab: Number(tab.dataset.tab) }));
  tab.addEventListener('dragover', (event) => {
    if (draggingOwnPane) event.preventDefault();
  });
  tab.addEventListener('drop', (event) => {
    if (!draggingOwnPane) return;
    event.preventDefault();
    draggingOwnPane = false;
    changeLayout({ moveTo: Number(tab.dataset.tab) });
  });
}
columnChoice.addEventListener('change', () =>
  changeLayout({ columns: Number(columnChoice.value) as TerminalLayoutState['columns'] }),
);
document.getElementById('rename-pane')!.addEventListener('submit', (event) => {
  event.preventDefault();
  changeLayout({ name: nameInput.value });
});
const splitSize = document.getElementById('split-size') as HTMLInputElement;
splitSize.addEventListener('input', () => changeLayout({ percent: Number(splitSize.value) }));
const unsubscribeLayout = pane.onLayout((state) => {
  const strip = document.querySelector('.pane-tabs')!;
  const order = state.order.map((index) => tabs.find((tab) => Number(tab.dataset.tab) === index)!);
  const currentOrder = [...strip.children];
  if (order.some((tab, index) => tab !== currentOrder[index])) {
    const focused = document.activeElement;
    for (const tab of order) strip.appendChild(tab);
    if (focused instanceof HTMLButtonElement && tabs.includes(focused)) focused.focus();
  }
  for (const tab of tabs) {
    const index = Number(tab.dataset.tab);
    tab.setAttribute('aria-pressed', String(state.visible.includes(index)));
    tab.dataset.active = String(index === state.active);
    tab.textContent = state.names[index]
      ? `${state.names[index]} · ${tab.dataset.provider}`
      : tab.dataset.provider!;
  }
  heading.textContent = state.names[slot] || heading.dataset.slotName!;
  heading.title = `${heading.textContent} · ${heading.dataset.provider}`;
  if (document.activeElement !== nameInput) nameInput.value = state.names[slot] ?? '';
  columnChoice.value = String(state.columns);
  splitSize.value = String(state.percent);
  splitSize.disabled =
    state.visible.length !== 2 || (state.axis === 'columns' && state.columns === 1);
  document.getElementById('split-value')!.textContent = `${state.percent}%`;
  for (const axis of ['columns', 'rows'])
    document
      .getElementById(`split-${axis}`)!
      .setAttribute('aria-pressed', String(state.axis === axis));
  const focused = document.activeElement as HTMLElement | null;
  (document.getElementById('maximize') as HTMLButtonElement).hidden = state.maximized === slot;
  (document.getElementById('restore') as HTMLButtonElement).hidden = state.maximized === null;
  if (focused?.hidden && ['maximize', 'restore'].includes(focused.id))
    document.getElementById(focused.id === 'maximize' ? 'restore' : 'maximize')!.focus();
  const position = state.order.indexOf(slot);
  (document.getElementById('move-earlier') as HTMLButtonElement).disabled = position === 0;
  (document.getElementById('move-later') as HTMLButtonElement).disabled =
    position === state.count - 1;
  if (
    focused instanceof HTMLButtonElement &&
    focused.disabled &&
    ['move-earlier', 'move-later'].includes(focused.id)
  )
    document.getElementById(focused.id === 'move-earlier' ? 'move-later' : 'move-earlier')!.focus();
  feedback.textContent = (state.persisted ? feedback.dataset.summary! : feedback.dataset.memory!)
    .replaceAll('{{visible}}', String(state.visible.length))
    .replaceAll('{{shown}}', String(state.shown.length))
    .replaceAll('{{position}}', String(position + 1))
    .replaceAll('{{count}}', String(state.count));
});
window.addEventListener('pagehide', unsubscribeLayout, { once: true });

// Native disclosure semantics retain keyboard navigation without intercepting xterm keys.
const paneMenu = document.getElementById('pane-menu') as HTMLDetailsElement;
const menuToggle = document.getElementById('pane-menu-toggle')!;
paneMenu.addEventListener('toggle', () => {
  menuToggle.setAttribute('aria-expanded', String(paneMenu.open));
});
paneMenu.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !paneMenu.open) return;
  event.preventDefault();
  event.stopPropagation();
  paneMenu.open = false;
  menuToggle.focus();
});
// A header drag starts outside the disclosure; keep its drop targets until a click occurs.
document.addEventListener('click', (event) => {
  if (paneMenu.open && event.target instanceof Node && !paneMenu.contains(event.target))
    paneMenu.open = false;
});
