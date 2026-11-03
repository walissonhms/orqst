import type {
  ManagedAgentsRequest,
  ManagedAgentsReply,
  ManagedAgentsSnapshot,
} from '@orqst/protocol';
const client = (
  window as unknown as {
    orqstManagedAgentsClient: { request(r: ManagedAgentsRequest): Promise<ManagedAgentsReply> };
  }
).orqstManagedAgentsClient;
const status = document.querySelector<HTMLElement>('#status')!;
let busy = false;
const button = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!;
const field = (id: string) =>
  document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
const inert = (text: string) =>
  text.replace(/[\p{Cc}\p{Cf}]/gu, (c) =>
    c === '\n' || c === '\t' ? c : `\\u{${c.codePointAt(0)!.toString(16)}}`,
  );
function render(s: ManagedAgentsSnapshot) {
  document.querySelector('#project')!.textContent = inert(s.project);
  for (const slot of [0, 1]) {
    const pane = s.slots[slot];
    document.querySelector(`#identity-${slot}`)!.textContent = pane
      ? inert(JSON.stringify(pane, null, 2))
      : '';
    const admitted = !!pane && pane.state !== 'prepared';
    button(`start-${slot}`).disabled = busy || admitted;
    field(`model-${slot}`).disabled = busy || admitted;
    button(`stop-${slot}`).disabled = busy || pane?.state !== 'running';
    const text = slot === 0 ? s.root?.resultText : s.messages.at(-1)?.resultText;
    document.querySelector(`#output-${slot}`)!.textContent = inert(text ?? '');
  }
  button('delegate').disabled =
    busy ||
    !s.slots.every((p) => p?.available && p.pane?.state === 'ready') ||
    s.root?.state === 'running' ||
    s.root?.state === 'outcome_unknown';
  document.querySelector('#communication')!.textContent = inert(
    JSON.stringify({ root: s.root, messages: s.messages }, null, 2),
  );
}
async function request(r: ManagedAgentsRequest) {
  if (busy && r.action !== 'snapshot') return;
  if (r.action !== 'snapshot') {
    busy = true;
    status.textContent = status.dataset.working ?? '';
    document.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = true));
  }
  try {
    const reply = await client.request(r);
    if (r.action !== 'snapshot' || reply.status !== 'ok')
      status.textContent = status.dataset[reply.status] ?? '';
    if (r.action !== 'snapshot') busy = false;
    if (reply.snapshot) render(reply.snapshot);
    else if (!busy) for (const slot of [0, 1]) button(`start-${slot}`).disabled = false;
  } finally {
    if (r.action !== 'snapshot') busy = false;
  }
}
for (const slot of [0, 1]) {
  button(`start-${slot}`).onclick = () =>
    void request({ version: 1, action: 'start', slot, model: field(`model-${slot}`).value });
  button(`stop-${slot}`).onclick = () => void request({ version: 1, action: 'stop', slot });
}
button('delegate').onclick = () =>
  void request({
    version: 1,
    action: 'delegate',
    text: field('instructions').value,
    task: field('task').value,
  });
let polling = false;
const timer = setInterval(() => {
  if (polling || document.hidden) return;
  polling = true;
  void request({ version: 1, action: 'snapshot' }).finally(() => {
    polling = false;
  });
}, 1000);
window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
