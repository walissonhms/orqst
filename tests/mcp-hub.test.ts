// Synthetic members only. No socket, PTY, provider or native app.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HUB_LIMITS,
  HubRefusal,
  OWNER_SENDER,
  TerminalMessageHub,
  truncateText,
  type HubEvidence,
  type HubMember,
} from '../packages/core/src/terminal/mcp-hub.js';

const ids = {
  a: '00000000-0000-4000-8000-00000000000a',
  b: '00000000-0000-4000-8000-00000000000b',
  c: '00000000-0000-4000-8000-00000000000c',
  x: '00000000-0000-4000-8000-0000000000ff',
};
function fixture() {
  const members: HubMember[] = [
    {
      terminalId: ids.a,
      alias: 'T-001',
      name: 'Codex 1',
      provider: 'codex',
      featureId: 'f1',
      running: true,
    },
    {
      terminalId: ids.b,
      alias: 'T-002',
      name: 'Claude 1',
      provider: 'claude',
      featureId: 'f1',
      running: true,
    },
    {
      terminalId: ids.c,
      alias: 'T-003',
      name: 'OpenCode 1',
      provider: 'opencode',
      featureId: 'f1',
      running: true,
    },
    {
      terminalId: ids.x,
      alias: 'T-004',
      name: 'Other',
      provider: 'codex',
      featureId: 'f2',
      running: true,
    },
  ];
  const evidence: HubEvidence[] = [];
  let now = 1_000_000;
  const hub = new TerminalMessageHub(
    () => members,
    (event) => evidence.push(event),
    () => now,
  );
  return { hub, members, evidence, advance: (ms: number) => (now += ms) };
}
const send = (to: string | string[], text: string) => ({
  name: 'send_message',
  arguments: { to, text },
});
const read = { name: 'read_messages', arguments: {} };
const refused = async (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error: unknown) => error instanceof HubRefusal && error.code === code);

test('terminals in one Feature message each other by @alias; the audit has no content', async () => {
  const f = fixture();
  const listed = (await f.hub.call(ids.a, { name: 'list_terminals', arguments: {} })) as {
    terminals: { handle: string }[];
  };
  assert.deepEqual(
    listed.terminals.map((t) => t.handle),
    ['T-002', 'T-003'],
  );
  await f.hub.call(ids.a, send('@T-002', 'please review'));
  const inbox = (await f.hub.call(ids.b, read)) as {
    messages: { from: string; text: string; kind: string }[];
  };
  assert.deepEqual(
    inbox.messages.map(({ from, text, kind }) => ({ from, text, kind })),
    [{ from: 'T-001', text: 'please review', kind: 'message' }],
  );
  assert.equal(f.evidence.length, 1);
  assert.equal(JSON.stringify(f.evidence).includes('please review'), false);
  assert.deepEqual(
    { from: f.evidence[0]!.from, to: f.evidence[0]!.to, featureId: f.evidence[0]!.featureId },
    { from: ids.a, to: ids.b, featureId: 'f1' },
  );
});

test('other Features, self, unknown handles and unassigned terminals are refused alike', async () => {
  const f = fixture();
  await refused(f.hub.call(ids.a, send('@T-004', 'x')), 'unknown_terminal');
  await refused(f.hub.call(ids.a, send('@T-001', 'x')), 'unknown_terminal');
  await refused(f.hub.call(ids.a, send('@T-999', 'x')), 'unknown_terminal');
  f.members[0]!.featureId = null;
  await refused(f.hub.call(ids.a, send('@T-002', 'x')), 'unknown_terminal');
  await refused(f.hub.call('00000000-0000-4000-8000-000000000999', read), 'not_member');
  assert.equal(f.evidence.length, 0);
});

test('chains stop after three hops from one owner message, and a stale chain starts over', async () => {
  const f = fixture();
  f.hub.ownerSend('f1', '@T-001', 'start');
  await f.hub.call(ids.a, read);
  await f.hub.call(ids.a, send('@T-002', 'hop 1'));
  await f.hub.call(ids.b, read);
  await f.hub.call(ids.b, send('@T-003', 'hop 2'));
  await f.hub.call(ids.c, read);
  await f.hub.call(ids.c, send('@T-001', 'hop 3'));
  await f.hub.call(ids.a, read);
  await refused(f.hub.call(ids.a, send('@T-002', 'hop 4')), 'chain_too_deep');
  f.advance(5 * 60_000);
  await f.hub.call(ids.a, send('@T-002', 'new chain'));
});

test('rate, inbox and recipient limits refuse with explicit codes', async () => {
  const f = fixture();
  for (let index = 0; index < HUB_LIMITS.inbox; index++)
    f.hub.ownerSend('f1', '@T-002', `owner ${index}`);
  await refused(f.hub.call(ids.a, send('@T-002', 'one more')), 'inbox_full');
  await f.hub.call(ids.b, read);
  for (let index = 0; index < HUB_LIMITS.sendsPerMinute; index++) {
    await f.hub.call(ids.a, send('@T-003', `m${index}`));
    await f.hub.call(ids.c, read);
  }
  await refused(f.hub.call(ids.a, send('@T-002', 'over budget')), 'rate_limited');
  await assert.rejects(
    f.hub.call(ids.a, send(['@T-002', '@T-003', '@T-002', '@T-003'], 'too many')),
  );
});

test('delegation answers at once and the result returns to the delegator', async () => {
  const f = fixture();
  const delegated = (await f.hub.call(ids.a, {
    name: 'delegate_task',
    arguments: { to: '@T-002', task: 'write tests' },
  })) as { taskId: string; state: string };
  assert.equal(delegated.state, 'delivered');
  const task = (await f.hub.call(ids.b, read)) as { messages: { kind: string; taskId: string }[] };
  assert.equal(task.messages[0]!.kind, 'task');
  await refused(
    f.hub.call(ids.c, {
      name: 'submit_result',
      arguments: { taskId: delegated.taskId, status: 'done', summary: 'not mine' },
    }),
    'unknown_task',
  );
  await f.hub.call(ids.b, {
    name: 'submit_result',
    arguments: { taskId: delegated.taskId, status: 'done', summary: 'tests added' },
  });
  const result = (await f.hub.call(ids.a, read)) as {
    messages: { kind: string; status: string; text: string }[];
  };
  assert.deepEqual(
    {
      kind: result.messages[0]!.kind,
      status: result.messages[0]!.status,
      text: result.messages[0]!.text,
    },
    { kind: 'result', status: 'done', text: 'tests added' },
  );
  const status = (await f.hub.call(ids.a, {
    name: 'task_status',
    arguments: { taskId: delegated.taskId },
  })) as { state: string };
  assert.equal(status.state, 'done');
  await refused(
    f.hub.call(ids.b, {
      name: 'submit_result',
      arguments: { taskId: delegated.taskId, status: 'failed', summary: 'again' },
    }),
    'already_submitted',
  );
});

test('wait_messages returns when a message arrives and empty on timeout, never an error', async () => {
  const f = fixture();
  const waiting = f.hub.call(ids.b, { name: 'wait_messages', arguments: { timeout_ms: 5000 } });
  await f.hub.call(ids.a, send('@T-002', 'wake up'));
  const woke = (await waiting) as { messages: { text: string }[] };
  assert.equal(woke.messages[0]!.text, 'wake up');
  const empty = (await f.hub.call(ids.b, {
    name: 'wait_messages',
    arguments: { timeout_ms: 1 },
  })) as { messages: unknown[] };
  assert.deepEqual(empty.messages, []);
});

test('long text is cut on a UTF-8 boundary and marked, not refused', async () => {
  assert.deepEqual(truncateText('ação', 2), { text: 'a', truncated: true });
  const f = fixture();
  await f.hub.call(ids.a, send('@T-002', 'x'.repeat(HUB_LIMITS.textBytes + 10)));
  const inbox = (await f.hub.call(ids.b, read)) as {
    messages: { text: string; truncated?: boolean }[];
  };
  assert.equal(inbox.messages[0]!.text.length, HUB_LIMITS.textBytes);
  assert.equal(inbox.messages[0]!.truncated, true);
});

test('the owner sends as owner to a Feature member only', async () => {
  const f = fixture();
  f.hub.ownerSend('f1', 'T-003', 'hello from owner');
  const inbox = (await f.hub.call(ids.c, read)) as { messages: { from: string }[] };
  assert.equal(inbox.messages[0]!.from, 'owner');
  assert.equal(f.evidence[0]!.from, OWNER_SENDER);
  assert.throws(() => f.hub.ownerSend('f1', 'T-004', 'other feature'), HubRefusal);
});

test('a hub endpoint serves one terminal over its private socket, refusals included', async () => {
  const { mkdtempSync, realpathSync, rmSync, statSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openHubEndpoint } = await import('../packages/core/src/terminal/mcp-hub-socket.js');
  const { connectMcpInstance } = await import('../packages/core/src/terminal/mcp-socket.js');
  // Short parent: Unix socket paths are limited to about 100 bytes.
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'oh-')));
  const f = fixture();
  const endpoint = await openHubEndpoint(f.hub, ids.a, parent);
  try {
    assert.equal(statSync(endpoint.capabilityFile).mode & 0o777, 0o600);
    const client = await connectMcpInstance(endpoint.socketPath, endpoint.capabilityFile);
    assert.equal(client.role, 'terminal');
    const listed = (await client.call(crypto.randomUUID(), {
      name: 'list_terminals',
      arguments: {},
    })) as { terminals: { handle: string }[] };
    assert.equal(listed.terminals.length, 2);
    await client.call(crypto.randomUUID(), send('@T-002', 'over the socket'));
    const inbox = (await f.hub.call(ids.b, read)) as { messages: { text: string }[] };
    assert.equal(inbox.messages[0]!.text, 'over the socket');
    const refusal = (await client.call(crypto.randomUUID(), send('@T-004', 'x'))) as {
      refused: string;
      message: string;
    };
    assert.equal(refusal.refused, 'unknown_terminal');
    assert.match(refusal.message, /list_terminals/);
    client.close();
  } finally {
    await endpoint.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('replying hands the chain to the recipient; the sender can start a new one', async () => {
  const f = fixture();
  f.hub.ownerSend('f1', '@T-001', 'start');
  await f.hub.call(ids.a, read);
  await f.hub.call(ids.a, send('@T-002', 'hop 1'));
  // The sender's own next message starts a fresh chain instead of being muted.
  await f.hub.call(ids.a, send('@T-003', 'unrelated'));
});

test('more than 64 tasks over time keep working while only open ones count', async () => {
  const f = fixture();
  for (let index = 0; index < 70; index++) {
    const task = (await f.hub.call(ids.a, {
      name: 'delegate_task',
      arguments: { to: '@T-002', task: `t${index}` },
    })) as { taskId: string };
    await f.hub.call(ids.b, read);
    await f.hub.call(ids.b, {
      name: 'submit_result',
      arguments: { taskId: task.taskId, status: 'done', summary: 'ok' },
    });
    await f.hub.call(ids.a, read);
    f.advance(2_100);
  }
});

test('the durable hub journal keeps metadata only, privately', async () => {
  const { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, chmodSync } =
    await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { hubMessageJournal } = await import('../packages/core/src/terminal/mcp-hub-journal.js');
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-hub-journal-')));
  chmodSync(directory, 0o700);
  try {
    const epoch = '00000000-0000-4000-8000-0000000000e1';
    const journal = hubMessageJournal(directory, epoch);
    const f = fixture();
    const hub = new TerminalMessageHub(
      () => f.members,
      (event) => journal.append(event),
    );
    await hub.call(ids.a, send('@T-002', 'secret content'));
    hub.ownerSend('f1', 'T-003', 'owner secret');
    journal.close();
    const file = join(directory, 'hub-communication', `${epoch}.jsonl`);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const text = readFileSync(file, 'utf8');
    assert.equal(text.includes('secret'), false);
    const lines = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { from: string });
    assert.deepEqual(
      lines.map((line) => line.from),
      [ids.a, OWNER_SENDER],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
