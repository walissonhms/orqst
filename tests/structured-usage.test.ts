import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { StructuredCodexSession } from '../packages/core/src/structured-agents/codex-session.js';
import type { StructuredProcessTransport } from '../packages/core/src/structured-agents/codex-process.js';
import { StructuredClaudeSession } from '../packages/core/src/structured-agents/claude-session.js';
import { openCodePermissions } from '../packages/core/src/structured-agents/opencode-process.js';
import { StructuredOpenCodeSession } from '../packages/core/src/structured-agents/opencode-session.js';

const workspace = { workspaceId: 'test-workspace', featureId: 'test-feature', label: 'Test' };
const cwd = '/synthetic/project';
const threadId = 'thread-1';
const exit = { code: 0, signal: null };
const never = new Promise<typeof exit>(() => {});
const delegate = () => Promise.reject(new Error('Unexpected delegation'));

test('structured Codex replaces cumulative snapshots and ignores last usage and other threads', async () => {
  let receive: (chunk: Uint8Array) => void;
  const emit = (value: object) => receive(Buffer.from(JSON.stringify(value) + '\n'));
  const transport: StructuredProcessTransport = {
    pid: undefined,
    exited: never,
    terminate: async () => exit,
    signal() {},
    detach() {},
    listen(data) {
      receive = data;
      return () => {};
    },
    send(line) {
      const request = JSON.parse(line);
      if (request.id === undefined) return;
      const result =
        request.method === 'thread/start'
          ? {
              thread: { id: threadId, ephemeral: true },
              model: 'test-model',
              cwd,
              approvalPolicy: 'on-request',
              approvalsReviewer: 'user',
              sandbox: { type: 'readOnly' },
            }
          : {};
      queueMicrotask(() => emit({ id: request.id, result }));
    },
  };
  const session = new StructuredCodexSession(workspace, transport, delegate);
  try {
    await session.initialize(cwd);
    assert.equal(session.snapshot().usage, undefined);
    const send = (input: number, output: number, cached: number, thread = threadId) =>
      emit({
        method: 'thread/tokenUsage/updated',
        params: {
          threadId: thread,
          turnId: 'turn-1',
          tokenUsage: {
            total: {
              inputTokens: input,
              outputTokens: output,
              cachedInputTokens: cached,
              totalTokens: input + output,
            },
            last: { inputTokens: 99, outputTokens: 99, cachedInputTokens: 10, totalTokens: 198 },
          },
        },
      });
    send(50, 5, 10);
    send(80, 10, 20);
    send(80, 10, 20);
    send(70, 8, 10);
    send(100, 30, 101);
    send(200, 20, 50, 'other-thread');
    assert.deepEqual(session.snapshot().usage, {
      usage: { input: 80, output: 10, cached: 20, total: 90 },
      usageKind: 'session_cumulative',
      turnId: 'turn-1',
    });
  } finally {
    await session.stop();
  }
});

test('structured OpenCode uses its thread-specific cumulative snapshots and positive USD estimate', async () => {
  const feed = new EventTarget();
  const signals: AbortSignal[] = [];
  const session = new StructuredOpenCodeSession(
    workspace,
    {
      verify: async () => {},
      exited: never,
      terminate: async () => exit,
      json: async () => ({
        data: { id: threadId, location: { directory: cwd }, permissions: openCodePermissions },
      }),
      async *events(_path, signal) {
        signals.push(signal);
        yield { type: 'server.connected' };
        while (!signal.aborted) {
          const [event] = (await once(feed, 'record', { signal })) as [CustomEvent];
          yield event.detail;
        }
      },
    },
    delegate,
  );
  try {
    await session.initialize(cwd);
    await setImmediate();
    assert.equal(session.snapshot().usage, undefined);
    const send = async (input: number, cost: number, sessionID = threadId) => {
      feed.dispatchEvent(
        new CustomEvent('record', {
          detail: {
            type: 'session.usage.updated',
            data: {
              sessionID,
              tokens: { input, output: 5, reasoning: 3, cache: { read: 11, write: 7 } },
              cost,
            },
          },
        }),
      );
      await setImmediate();
    };
    await send(2, 0);
    assert.deepEqual(session.snapshot().usage, {
      usage: { input: 20, output: 8, cached: 11, total: 28 },
      usageKind: 'session_cumulative',
    });
    await send(12, 0.0031);
    await send(12, 0.0031);
    await send(99, 2, 'other-session');
    assert.deepEqual(session.snapshot().usage, {
      usage: { input: 30, output: 8, cached: 11, total: 38 },
      usageKind: 'session_cumulative',
      cost: { amount: 0.0031, currency: 'USD', source: 'opencode_estimate' },
    });
  } finally {
    await session.stop();
    assert.ok(signals.at(-1)?.aborted);
  }
});

test('structured Claude counts each main-thread response ID once and reconciles turn output', async () => {
  let receive: (chunk: Uint8Array) => void;
  const claudeSessionId = '550e8400-e29b-41d4-a716-446655440000';
  const emit = (value: object) => receive(Buffer.from(JSON.stringify(value) + '\n'));
  const sent: Array<Record<string, unknown>> = [];
  const transport: StructuredProcessTransport = {
    pid: undefined,
    exited: never,
    terminate: async () => exit,
    signal() {},
    detach() {},
    listen(data) {
      receive = data;
      return () => {};
    },
    send(line) {
      const frame = JSON.parse(line) as Record<string, unknown>;
      sent.push(frame);
      if (
        frame.type === 'control_request' &&
        (frame.request as { subtype?: string })?.subtype === 'initialize'
      ) {
        queueMicrotask(() =>
          emit({
            type: 'control_response',
            response: {
              subtype: 'success',
              request_id: frame.request_id,
              response: { claude_code_version: '2.1.318' },
              pending_permission_requests: [],
            },
          }),
        );
      }
    },
  };
  const session = new StructuredClaudeSession(
    workspace,
    { sessionId: claudeSessionId, transport },
    delegate,
  );
  try {
    await session.initialize(cwd);
    assert.equal(session.snapshot().usage, undefined);
    await session.startTurn('Hello', 'human');
    const turnId = session.snapshot().turn!.turnId;

    // Parallel tool-call chunks share msg_1; subagent and foreign-session frames must be ignored.
    const step1 = {
      type: 'assistant',
      session_id: claudeSessionId,
      parent_tool_use_id: null,
      message: {
        id: 'msg_1',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'Working' }],
        usage: {
          input_tokens: 10,
          output_tokens: 1,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
        },
      },
    };
    emit(step1);
    emit(step1);
    emit({ ...step1, parent_tool_use_id: 'toolu_sub', message: { ...step1.message, id: 'msg_s' } });
    emit({ ...step1, session_id: 'other-session', message: { ...step1.message, id: 'msg_o' } });
    emit({ ...step1, isSidechain: true, message: { ...step1.message, id: 'msg_side' } });
    emit({
      ...step1,
      message: { ...step1.message, id: 'msg_syn', model: '<synthetic>' },
    });

    assert.deepEqual(session.snapshot().usage, {
      usage: { input: 60, output: 1, cached: 30, total: 61 },
      usageKind: 'session_cumulative',
      turnId,
    });

    emit({
      type: 'assistant',
      session_id: claudeSessionId,
      parent_tool_use_id: null,
      message: {
        id: 'msg_2',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'Done' }],
        usage: {
          input_tokens: 5,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 60,
        },
      },
    });
    // Result reconciles placeholder output (1 + 1 -> 45) without double-counting input/cache.
    emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: claudeSessionId,
      result: 'Done',
      user_message_uuids: [turnId],
      usage: { output_tokens: 45 },
      total_cost_usd: 0.0084,
    });

    assert.deepEqual(session.snapshot().usage, {
      usage: { input: 125, output: 45, cached: 90, total: 170 },
      usageKind: 'session_cumulative',
      turnId,
      cost: { amount: 0.0084, currency: 'USD', source: 'claude_estimate' },
    });
  } finally {
    await session.stop();
  }
});
