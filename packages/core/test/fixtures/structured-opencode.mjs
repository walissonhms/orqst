// Synthetic OpenCode 2.2.5 wire fixture. No login, model, or real tool execution.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

assert.deepEqual(process.argv.slice(2), [
  'serve',
  '--stdio',
  '--hostname',
  '127.0.0.1',
  '--port',
  '0',
]);
assert.match(process.env.OPENCODE_PASSWORD, /^[a-zA-Z0-9_-]{43}$/);
assert.equal(process.env.OPENCODE_SERVER_PASSWORD, undefined);
assert.equal(process.env.OTEL_EXPORTER_OTLP_ENDPOINT, undefined);
assert.equal(process.env.OPENCODE_DISABLE_AUTOUPDATE, '1');
assert.equal(process.env.OPENCODE_DISABLE_PROJECT_CONFIG, '1');
assert.ok(process.env.XDG_DATA_HOME.startsWith(process.env.HOME + '/'));
const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);
assert.equal(config.share, 'disabled');
for (const action of ['plugin.use', 'mcp.use'])
  assert.ok(config.policies.some((policy) => policy.action === action && policy.effect === 'deny'));

const sessionID = 'ses_synthetic';
const streams = new Set();
let sequence = 0;
const messages = [];
const time = {};
let outcome;
let tick = 0;
const trace = { prompts: [], returned: [], decisions: [], replays: 0, child: null };
let allowed;
let activeInput;

function frame(response, event) {
  // Fragment successive writes and use CRLF to exercise byte framing.
  response.write('data: ' + JSON.stringify(event) + '\r\n');
  response.write('\r\n');
}

function emit(type, data = {}, { durable = true, live = true } = {}) {
  const event = { type, data: { sessionID, ...data } };
  if (durable) event.durable = { aggregateID: sessionID, seq: sequence++, version: 1 };
  if (live) for (const stream of streams) frame(stream, event);
}

function result(text, { live = true } = {}) {
  const options = { live };
  const assistantMessageID = 'msg_a' + sequence;
  emit(
    'session.step.started',
    { assistantMessageID, model: { id: 'fake', providerID: 'synthetic' } },
    options,
  );
  emit(
    'session.text.delta',
    { assistantMessageID, ordinal: 0, delta: 'streamed ' },
    { live, durable: false },
  );
  emit('session.text.ended', { assistantMessageID, ordinal: 0, text }, options);
  emit('session.step.ended', { assistantMessageID, finish: 'stop' }, options);
  emit('session.execution.succeeded', {}, options);
  messages.unshift({
    id: assistantMessageID,
    type: 'assistant',
    finish: 'stop',
    model: { id: 'fake', providerID: 'synthetic' },
    time: { created: ++tick, completed: ++tick },
    content: [{ type: 'text', text }],
  });
  time.idle = ++tick;
  outcome = 'succeeded';
  activeInput = undefined;
}

function json(response, data) {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(data));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks));
}

function sse(response) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
}

const server = createServer(async (request, response) => {
  try {
    if (
      request.headers.authorization !==
      'Basic ' + Buffer.from('opencode:' + process.env.OPENCODE_PASSWORD).toString('base64')
    ) {
      response.writeHead(401).end();
      return;
    }
    const { pathname, searchParams } = new URL(request.url, 'http://synthetic');
    if (pathname === '/api/info') return json(response, { version: '2.2.5' });
    if (pathname === '/api/event') {
      sse(response);
      streams.add(response);
      response.once('close', () => streams.delete(response));
      return frame(response, { type: 'server.connected', data: {} });
    }
    if (pathname === '/api/session' && request.method === 'POST') {
      const { location, permissions } = await body(request);
      assert.deepEqual(permissions, config.permissions);
      emit('session.created');
      return json(response, { data: { id: sessionID, location, permissions } });
    }
    if (pathname === '/synthetic-trace') return json(response, trace);
    const prefix = '/api/session/' + sessionID;
    assert.ok(pathname.startsWith(prefix));
    const route = pathname.slice(prefix.length);
    if (!route && request.method === 'GET')
      return json(response, { data: { id: sessionID, time, outcome } });
    if (route === '/message') {
      trace.replays++;
      assert.equal(searchParams.get('limit'), '32');
      assert.equal(searchParams.get('order'), 'desc');
      return json(response, { data: messages, cursor: {} });
    }
    if (route === '/prompt' || route === '/synthetic') {
      assert.equal(request.method, 'POST');
      const { id, text, delivery, resume } = await body(request);
      assert.equal(delivery, 'queue');
      assert.equal(resume, true);
      assert.equal(activeInput, undefined);
      activeInput = id;
      const kind = route === '/prompt' ? 'user' : 'synthetic';
      (kind === 'user' ? trace.prompts : trace.returned).push(text);
      time.busy = ++tick;
      if (text !== 'unbound history')
        messages.unshift({ id, type: kind, time: { created: ++tick } });
      emit('session.inbox.enqueued', { inboxID: id });
      emit('session.execution.started');
      emit('session.inbox.delivered', { inboxID: id });
      json(response, { data: { sessionID, id, type: kind } });

      if (text === 'permission once' || text === 'permission reject') {
        allowed = {
          id: 'per_' + id,
          sessionID,
          action: 'read',
          resources: ['example.txt'],
          source: { type: 'tool', id: 'read', messageID: 'msg_tool' },
        };
        emit('permission.asked', allowed, { durable: false });
      } else if (text === 'interrupt') {
        return;
      } else if (text === 'reconcile' || text === 'unknown' || text === 'unbound history') {
        if (text !== 'unknown') result('recorded while disconnected', { live: false });
        for (const stream of streams) stream.end();
      } else if (text === 'spawn child') {
        const child = spawn('/bin/sleep', ['60'], { stdio: 'ignore' });
        trace.child = child.pid;
        result('owned child launched');
      } else if (text === 'stream') {
        const assistantMessageID = 'msg_stream';
        emit('session.step.started', {
          assistantMessageID,
          model: { id: 'fake', providerID: 'synthetic' },
        });
        emit(
          'session.text.delta',
          { assistantMessageID, ordinal: 0, delta: 'partial text' },
          { durable: false },
        );
        await delay(125);
        emit('session.text.ended', { assistantMessageID, ordinal: 0, text: 'final text' });
        emit('session.step.ended', { assistantMessageID, finish: 'stop' });
        emit('session.execution.succeeded');
        time.idle = ++tick;
        outcome = 'succeeded';
        activeInput = undefined;
      } else if (text.includes('without Markdown: ')) {
        const fullMarker = text.split('without Markdown: ').at(-1);
        const marker = JSON.parse(fullMarker);
        result(
          text.startsWith('forged') ? JSON.stringify({ ...marker, task: 'changed' }) : fullMarker,
        );
      } else {
        await delay(35);
        result(kind === 'synthetic' ? 'final source answer' : 'synthetic result');
      }
      return;
    }
    if (route === '/interrupt') {
      assert.equal(searchParams.get('resume'), 'false');
      assert.ok(activeInput);
      json(response, { interrupted: true });
      await delay(75);
      emit('session.execution.interrupted', { reason: 'user' });
      time.idle = ++tick;
      outcome = 'interrupted';
      activeInput = undefined;
      return;
    }
    if (allowed && route === '/permission/' + allowed.id && request.method === 'GET')
      return json(response, { data: allowed });
    if (allowed && route === '/permission/' + allowed.id + '/reply') {
      const { decision } = await body(request);
      assert.ok(decision === 'once' || decision === 'reject');
      trace.decisions.push(decision);
      emit('permission.replied', { requestID: allowed.id, reply: decision }, { durable: false });
      allowed = undefined;
      response.writeHead(204).end();
      result(decision);
      return;
    }
    response.writeHead(404).end();
  } catch {
    response.writeHead(500).end();
  }
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({ url: 'http://127.0.0.1:' + server.address().port }) + '\n');
});

process.stdin.resume();
process.stdin.on('end', () => {
  for (const stream of streams) stream.end();
  server.close(() => process.exit(0));
});
