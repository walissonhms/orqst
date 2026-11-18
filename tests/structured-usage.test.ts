import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { StructuredCodexSession } from '../packages/core/src/structured-agents/codex-session.js';
import type { StructuredProcessTransport } from '../packages/core/src/structured-agents/codex-process.js';
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
