// Fixed local lab UI. Plain inert text, no emulator, links, clipboard or automatic terminal replies.
import type { DesktopTerminal, TerminalNativeRequest } from '@orqst/protocol';

const client = (window as unknown as { orqstTerminal: DesktopTerminal }).orqstTerminal;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const output = document.querySelector<HTMLPreElement>('#output')!;
const paste = document.querySelector<HTMLTextAreaElement>('#paste')!;
let instanceId: string | undefined;
let sequence = 0;
let cursor = 0;
let attached = false;
let busy = false;
const decoder = new TextDecoder();
const show = (text: string) => {
  // Escape all terminal/format controls, preserving newline/tab. Never interpret output as HTML.
  output.textContent = (output.textContent + text)
    .replace(/[\p{Cc}\p{Cf}]/gu, (value) =>
      value === '\n' || value === '\t' ? value : `\\u{${value.codePointAt(0)!.toString(16)}}`,
    )
    .slice(-16 * 1024);
};
const send = async (request: TerminalNativeRequest) => {
  if (busy) return;
  busy = true;
  try {
    const reply = await client.request(request);
    status.textContent = status.dataset[reply.status] ?? '';
    if (reply.status !== 'ok') return;
    instanceId = reply.instanceId;
    status.dataset.instanceId = reply.instanceId;
    if (reply.snapshot) status.dataset.state = reply.snapshot.state;
    if (request.action === 'attach') attached = true;
    if (request.action === 'detach') attached = false;
    if (request.action === 'input') sequence = 0;
    if (request.action === 'paste') sequence++;
    if (reply.output) {
      if (reply.output.gap) {
        output.textContent = '';
        decoder.decode();
      }
      cursor = reply.output.nextCursor;
      show(decoder.decode(Uint8Array.from(reply.output.bytes), { stream: true }));
    }
  } finally {
    busy = false;
  }
};
for (const action of ['start', 'attach', 'input', 'detach', 'stop', 'send'] as const) {
  document.getElementById(action)!.addEventListener('click', () => {
    if (action === 'start') {
      void send({ version: 1, action, profileId: 'synthetic-native-v1' });
      return;
    }
    if (!instanceId) return;
    const base = { version: 1 as const, instanceId };
    if (action === 'send') void send({ ...base, action: 'paste', sequence, text: paste.value });
    else if (action === 'stop') void send({ ...base, action, signal: 'SIGTERM' });
    else void send({ ...base, action });
  });
}
const timer = setInterval(() => {
  if (attached && instanceId) void send({ version: 1, action: 'read', instanceId, cursor });
}, 100);
window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
