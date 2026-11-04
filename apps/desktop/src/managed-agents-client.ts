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
let latest: ManagedAgentsSnapshot | undefined;
const identities = new Map<number, string>();
const select = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!;
const checkbox = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
function suggestions() {
  const container = document.querySelector<HTMLElement>('#mention-options')!;
  const signature = JSON.stringify([
    field('task').value,
    select('source').value,
    latest?.slots.map((s) => s?.pane),
    busy,
  ]);
  if (container.dataset.signature === signature) return;
  container.dataset.signature = signature;
  container.replaceChildren();
  const match = field('task').value.match(/(?:^|\s)@([a-z0-9_-]*)$/i);
  if (!match || !latest || busy) return;
  const source = latest.slots[Number(select('source').value)]?.pane;
  for (const entry of latest.slots) {
    const pane = entry?.pane;
    if (
      !pane?.routing ||
      !source?.routing?.allowedTargetPaneIds.includes(pane.paneId) ||
      !pane.routing.handle.startsWith(match[1]!.toLowerCase())
    )
      continue;
    const option = document.createElement('button');
    option.type = 'button';
    option.textContent = inert(
      `@${pane.routing.handle} · ${pane.name} · ${pane.provider} · ${container.dataset[pane.state] ?? ''} · ${select('role-0').querySelector<HTMLOptionElement>(`option[value="${pane.routing.role}"]`)?.textContent ?? ''}`,
    );
    option.onclick = () => {
      field('task').value =
        field('task').value.slice(0, field('task').value.length - match[1]!.length) +
        pane.routing!.handle +
        ' ';
      container.replaceChildren();
      field('task').focus();
    };
    container.append(option);
  }
}
const button = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!;
const field = (id: string) =>
  document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
const inert = (text: string) =>
  text.replace(/[\p{Cc}\p{Cf}]/gu, (c) =>
    c === '\n' || c === '\t' ? c : `\\u{${c.codePointAt(0)!.toString(16)}}`,
  );
function render(s: ManagedAgentsSnapshot) {
  latest = s;
  const retired = s.admission === 'retired';
  const lifetime = document.querySelector<HTMLElement>('#lifetime')!;
  const state =
    s.admission === 'unclaimed'
      ? 'idle'
      : retired
        ? 'retired'
        : s.slots.some((p) => p?.state === 'ownership_lost')
          ? 'uncertain'
          : s.slots.some((p) => p && ['starting', 'running'].includes(p.state))
            ? 'active'
            : 'reserved';
  lifetime.textContent = lifetime.dataset[state] ?? '';
  button('retire').disabled = busy || !s.canRetire || retired;
  document.querySelector('#project')!.textContent = inert(s.project);
  for (const slot of [0, 1]) {
    const pane = s.slots[slot];
    document.querySelector(`#identity-${slot}`)!.textContent = pane
      ? inert(JSON.stringify(pane, null, 2))
      : '';
    const signature = JSON.stringify([pane?.pane?.name, pane?.pane?.routing]);
    if (pane?.pane?.routing && identities.get(slot) !== signature) {
      identities.set(slot, signature);
      field(`name-${slot}`).value = pane.pane.name;
      field(`handle-${slot}`).value = pane.pane.routing.handle;
      select(`role-${slot}`).value = pane.pane.routing.role;
      checkbox(`route-${slot}`).checked = pane.pane.routing.allowedTargetPaneIds.length > 0;
    }
    const routingDisabled =
      busy ||
      retired ||
      !pane?.available ||
      s.root?.state === 'running' ||
      s.root?.state === 'outcome_unknown';
    for (const id of ['name', 'handle']) field(`${id}-${slot}`).disabled = routingDisabled;
    select(`role-${slot}`).disabled = routingDisabled;
    checkbox(`route-${slot}`).disabled = routingDisabled || !s.slots[1 - slot]?.pane;
    button(`routing-${slot}`).disabled = routingDisabled;
    select('source').options[slot]!.textContent = pane?.pane?.routing
      ? inert(`@${pane.pane.routing.handle} · ${pane.pane.name}`)
      : slot === 0
        ? 'A'
        : 'B';
    const admitted = !retired && !!pane && pane.state !== 'prepared';
    button(`start-${slot}`).disabled = busy || admitted;
    field(`model-${slot}`).disabled = busy || admitted;
    button(`stop-${slot}`).disabled = busy || retired || pane?.state !== 'running';
    const message = s.messages.at(-1);
    const text =
      pane?.pane?.paneId === message?.sourcePaneId
        ? s.root?.resultText
        : message?.targetPaneId === pane?.pane?.paneId
          ? message?.resultText
          : null;
    document.querySelector(`#output-${slot}`)!.textContent = inert(text ?? '');
  }
  select('source').disabled = busy || retired || s.root?.state === 'running';
  const source = s.slots[Number(select('source').value)]?.pane;
  button('delegate').disabled =
    !source?.routing?.allowedTargetPaneIds.length ||
    busy ||
    retired ||
    !s.slots.every((p) => p?.available && p.pane?.state === 'ready') ||
    s.root?.state === 'running' ||
    s.root?.state === 'outcome_unknown';
  suggestions();
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
    // Focus refusal is not lifecycle evidence. Keep controls revoked until a fresh snapshot.
    if (reply.status === 'focus_required' && !reply.snapshot) return;
    if (reply.snapshot) render(reply.snapshot);
    else if (!busy && reply.empty) {
      for (const slot of [0, 1]) button(`start-${slot}`).disabled = false;
      const lifetime = document.querySelector<HTMLElement>('#lifetime')!;
      lifetime.textContent = lifetime.dataset.idle ?? '';
    } else if (!busy) {
      // No snapshot is not evidence of an empty pair. Revoke stale mutation controls.
      document.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = true));
      const lifetime = document.querySelector<HTMLElement>('#lifetime')!;
      lifetime.textContent = lifetime.dataset.uncertain ?? '';
    }
  } finally {
    if (r.action !== 'snapshot') busy = false;
  }
}
for (const slot of [0, 1]) {
  button(`routing-${slot}`).onclick = () => {
    const other = latest?.slots[1 - slot]?.pane;
    void request({
      version: 1,
      action: 'routing',
      slot,
      update: {
        name: field(`name-${slot}`).value,
        handle: field(`handle-${slot}`).value,
        role: select(`role-${slot}`).value as 'worker' | 'reviewer' | 'orchestrator',
        allowedTargetPaneIds: checkbox(`route-${slot}`).checked && other ? [other.paneId] : [],
      },
    });
  };
  button(`start-${slot}`).onclick = () =>
    void request({ version: 1, action: 'start', slot, model: field(`model-${slot}`).value });
  button(`stop-${slot}`).onclick = () => void request({ version: 1, action: 'stop', slot });
}
button('retire').onclick = () => void request({ version: 1, action: 'retire' });
button('delegate').onclick = () =>
  void request({
    version: 1,
    action: 'delegate',
    sourceSlot: Number(select('source').value),
    text: field('instructions').value,
    task: field('task').value,
  });
field('task').addEventListener('input', suggestions);
select('source').addEventListener('change', () => {
  if (latest) render(latest);
});
void request({ version: 1, action: 'snapshot' });
let polling = false;
const timer = setInterval(() => {
  if (polling || document.hidden) return;
  polling = true;
  void request({ version: 1, action: 'snapshot' }).finally(() => {
    polling = false;
  });
}, 1000);
window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
