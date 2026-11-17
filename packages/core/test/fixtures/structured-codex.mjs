// Synthetic JSON-lines app-server. No real model, commands, credentials or MCP.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const lines = createInterface({ input: process.stdin });
const threadId = 'synthetic-thread';
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const notify = (method, params) => send({ method, params });
const rpc = (id, result) => send({ id, result });
let turnCount = 0;
let active;
let pending;
let initialized = false;
let descendant;
const turn = (status) => ({ id: active, status });
const lifecycle = (method, status) => notify(method, { threadId, turn: turn(status) });
const item = (method, item) => notify(`item/${method}`, { threadId, turnId: active, item });
function finish(text, status = 'completed') {
  if (text) {
    notify('item/agentMessage/delta', {
      threadId,
      turnId: active,
      itemId: 'answer',
      delta: 'Provisional',
    });
    item('completed', { type: 'agentMessage', id: 'answer', text, phase: 'final_answer' });
  }
  lifecycle('turn/completed', status);
  active = undefined;
  pending = undefined;
}
function waitForApproval(method, id, payload) {
  pending = { method, id };
  send({ method, id, params: { threadId, turnId: active, itemId: 'approval-item', ...payload } });
}

lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (!message.method) {
    if (!pending || pending.id !== message.id) return process.exit(91);
    notify('serverRequest/resolved', { threadId, requestId: message.id });
    if (pending.method === 'item/tool/call') {
      const result = message.result;
      if (!result.success) return finish('Synthetic delegation refused.');
      item('completed', {
        id: 'synthetic-call',
        type: 'dynamicToolCall',
        tool: 'orqst_delegate_task',
        status: 'completed',
        success: true,
      });
      const worker = JSON.parse(result.contentItems[0].text).untrustedWorkerResult;
      return finish(`Synthetic source received: ${worker}`);
    }
    if (message.result?.decision === 'accept') return finish('Synthetic approval accepted.');
    if (message.result?.decision === 'decline' || message.error)
      return finish('Synthetic approval declined.');
    return finish(undefined, 'interrupted');
  }

  const { id, method, params } = message;
  if (method === 'initialize') return rpc(id, { userAgent: 'synthetic' });
  if (method === 'initialized') {
    initialized = true;
    return;
  }
  if (method === 'thread/start') {
    if (
      !initialized ||
      params.approvalsReviewer !== 'user' ||
      !params.ephemeral ||
      params.dynamicTools?.[0]?.name !== 'orqst_delegate_task'
    )
      return process.exit(92);
    return rpc(id, {
      thread: { id: threadId, ephemeral: true },
      cwd: params.cwd,
      model: 'synthetic-model',
      approvalsReviewer: 'user',
      approvalPolicy: 'on-request',
      sandbox: { type: 'readOnly' },
    });
  }
  if (method === 'turn/interrupt') {
    if (params.turnId !== active || params.threadId !== threadId) return process.exit(93);
    rpc(id, {});
    return setTimeout(() => finish(undefined, 'interrupted'), 120);
  }
  if (method !== 'turn/start' || active) return process.exit(94);
  active = `synthetic-turn-${++turnCount}`;
  // These two notifications deliberately precede the RPC response.
  lifecycle('turn/started', 'inProgress');
  notify('item/agentMessage/delta', {
    threadId: 'unrelated-thread',
    turnId: active,
    itemId: 'bad',
    delta: 'Ignore this unrelated thread.',
  });
  rpc(id, { turn: turn('inProgress') });
  const text = params.input[0].text;
  if (text === 'approval:command') {
    item('started', {
      id: 'approval-item',
      type: 'commandExecution',
      status: 'inProgress',
      command: 'synthetic print',
    });
    return waitForApproval('item/commandExecution/requestApproval', 7, {
      kind: 'command',
      command: 'synthetic print',
      cwd: process.cwd(),
      availableDecisions: ['accept', 'decline', 'cancel'],
    });
  }
  if (text === 'approval:file') {
    item('started', {
      id: 'approval-item',
      type: 'fileChange',
      status: 'inProgress',
      changes: [{ path: 'synthetic.txt', kind: { type: 'add' }, diff: '+synthetic' }],
    });
    return waitForApproval('item/fileChange/requestApproval', 'file', { grantRoot: null });
  }
  if (text === 'approval:permissions') {
    return waitForApproval('item/permissions/requestApproval', 'permissions', { permissions: {} });
  }
  if (text === 'transport:lost') return process.exit(23);
  if (text === 'turn:wait') return;
  if (text === 'turn:descendant') {
    descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    return finish(`child:${descendant.pid}`);
  }
  if (text.startsWith('delegate:')) {
    const request = JSON.parse(text.slice('delegate:'.length));
    pending = { id: 'tool', method: 'item/tool/call' };
    return send({
      id: pending.id,
      method: pending.method,
      params: {
        threadId,
        turnId: active,
        callId: 'synthetic-call',
        tool: 'orqst_delegate_task',
        namespace: null,
        arguments: request,
      },
    });
  }
  setTimeout(() => finish(params.parentTurnId ? `worker:${text}` : `echo:${text}`), 160);
});

// Force the owner's shutdown path to reap a leader that ignores TERM and EOF.
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
