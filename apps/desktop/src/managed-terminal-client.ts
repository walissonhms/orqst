import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
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
let gap = false;
let pending = '';
let live = false;
const actions = ['login', 'start', 'attach', 'input', 'detach', 'stop', 'kill'] as const;
const updateButtons = () => {
  for (const action of actions) {
    let disabled =
      busy ||
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
  document.getElementById(action)!.addEventListener('click', () => {
    if (busy) {
      show('busy');
      return;
    }
    if (action === 'start' || action === 'login') {
      if (!live)
        void send({
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
      void send({
        version: 1,
        action: 'stop',
        instanceId,
        signal: action === 'kill' ? 'SIGKILL' : 'SIGTERM',
      });
    else void send({ version: 1, action, instanceId });
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
const timer = setInterval(() => {
  if (busy || !instanceId) return;
  if (pending) {
    void flush();
    return;
  }
  const columns = Math.max(20, Math.min(300, terminal.cols));
  const rows = Math.max(5, Math.min(100, terminal.rows));
  if (attached && live && (columns !== lastColumns || rows !== lastRows)) {
    lastColumns = columns;
    lastRows = rows;
    void send({ version: 1, action: 'resize', instanceId, columns, rows });
    return;
  }
  if (++ticks % 5 === 0) void send({ version: 1, action: 'snapshot', instanceId });
  else if (attached && !gap) void send({ version: 1, action: 'read', instanceId, cursor });
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
