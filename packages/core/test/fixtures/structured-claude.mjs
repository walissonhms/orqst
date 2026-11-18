// Synthetic Claude 2.1.318 stream-json wire fixture. No login, model, or real tool execution.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const sessionId = flag('--session-id');
assert.ok(sessionId && /^[0-9a-f-]{36}$/i.test(sessionId));
assert.deepEqual(args, [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--setting-sources',
  'user',
  '--session-id',
  sessionId,
  '--no-session-persistence',
  '--permission-mode',
  'default',
  '--permission-prompt-tool',
  'stdio',
  '--permission-prompts',
  'host',
  '--strict-mcp-config',
  '--settings',
  JSON.stringify({
    disableAllHooks: true,
    permissions: {
      defaultMode: 'default',
      ask: ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch'],
    },
  }),
  '--allowedTools',
  'mcp__orqst__orqst_delegate_task',
  '--disallowedTools',
  'Agent,AskUserQuestion',
  '--disable-slash-commands',
  '--no-chrome',
]);

for (const forbidden of [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_PROFILE',
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_HOST_SESSION_ID',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'ELECTRON_RUN_AS_NODE',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
]) {
  assert.equal(process.env[forbidden], undefined, `Unexpected forwarded env ${forbidden}`);
}
assert.equal(process.env.DISABLE_AUTOUPDATER, '1');
assert.equal(process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
assert.equal(process.env.DISABLE_TELEMETRY, '1');
assert.equal(process.env.DISABLE_ERROR_REPORTING, '1');
assert.equal(process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE, '1');
assert.equal(process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY, '1');

const model = 'claude-synthetic-5';
const pendingRequests = new Map();
let requestSeq = 0;
let turnSeq = 0;
let activeTurn = null;
let inputClosed = false;

function send(frame) {
  process.stdout.write(JSON.stringify(frame) + '\n');
}

function sendControlRequest(request) {
  const requestId = `srv_req_${++requestSeq}`;
  return new Promise((resolve) => {
    pendingRequests.set(requestId, resolve);
    send({ type: 'control_request', request_id: requestId, request });
  });
}

function emitInit() {
  send({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    cwd: process.cwd(),
    model,
    permissionMode: 'default',
    claude_code_version: '2.1.318',
  });
}

function finishTurn(turnUuid, text, options = {}) {
  const { error = false, terminalReason = 'completed', costUsd = 0 } = options;
  if (text !== undefined && !error) {
    const msgId = `msg_final_${turnSeq}`;
    send({
      type: 'assistant',
      session_id: sessionId,
      parent_tool_use_id: null,
      message: {
        id: msgId,
        model,
        content: [{ type: 'text', text }],
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_creation_input_tokens: 4,
          cache_read_input_tokens: 6,
        },
      },
    });
  }
  send({
    type: 'result',
    subtype: error ? 'error_during_execution' : 'success',
    is_error: error,
    terminal_reason: terminalReason,
    session_id: sessionId,
    result: text ?? '',
    user_message_uuids: turnUuid ? [turnUuid] : [],
    usage: { output_tokens: error ? 0 : 12 },
    total_cost_usd: costUsd,
  });
  activeTurn = null;
  if (inputClosed) process.exit(0);
}

async function runTurn(userFrame) {
  turnSeq++;
  const turnUuid = userFrame.uuid;
  const blocks = Array.isArray(userFrame.message?.content) ? userFrame.message.content : [];
  const text = blocks[0]?.text ?? '';
  let resolveInterrupt;
  const interrupted = new Promise((resolve) => {
    resolveInterrupt = resolve;
  });
  activeTurn = { interrupt: () => resolveInterrupt?.() };
  emitInit();

  if (text === 'env:view') {
    const { HOME, TMPDIR, CLAUDE_CONFIG_DIR } = process.env;
    finishTurn(turnUuid, JSON.stringify({ HOME, TMPDIR, CLAUDE_CONFIG_DIR }));
    return;
  }
  if (text === 'peers:view') {
    const peerBlock = blocks.find(
      (entry) =>
        typeof entry?.text === 'string' &&
        entry.text.startsWith('ORQST peer sessions at dispatch '),
    );
    const roster = peerBlock ? peerBlock.text.slice(peerBlock.text.indexOf('\n') + 1) : '[]';
    finishTurn(turnUuid, roster);
    return;
  }
  if (text === 'crash') {
    process.exit(17);
  }
  if (text === 'spawn child') {
    const child = spawn('/bin/sleep', ['60'], { stdio: 'ignore' });
    finishTurn(turnUuid, `child:${child.pid}`);
    return;
  }
  if (text === 'interrupt') {
    await interrupted;
    await delay(40);
    send({
      type: 'assistant',
      session_id: sessionId,
      parent_tool_use_id: null,
      message: {
        id: `msg_int_${turnSeq}`,
        model,
        content: [{ type: 'text', text: '[Request interrupted by user]' }],
      },
    });
    finishTurn(turnUuid, undefined, { error: true, terminalReason: 'aborted_tools' });
    return;
  }
  if (text === 'stream') {
    const msgId = `msg_stream_${turnSeq}`;
    send({
      type: 'stream_event',
      session_id: sessionId,
      parent_tool_use_id: null,
      event: {
        type: 'message_start',
        message: {
          id: msgId,
          model,
          usage: {
            input_tokens: 15,
            output_tokens: 1,
            cache_creation_input_tokens: 5,
            cache_read_input_tokens: 20,
          },
        },
      },
    });
    send({
      type: 'stream_event',
      session_id: sessionId,
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'partial text' },
      },
    });
    // Subagent and foreign-session noise must be ignored by projection and usage accounting.
    send({
      type: 'assistant',
      session_id: sessionId,
      parent_tool_use_id: 'toolu_subagent',
      message: {
        id: 'msg_subagent_ignored',
        model,
        content: [{ type: 'text', text: 'subagent internal output' }],
        usage: { input_tokens: 999, output_tokens: 999 },
      },
    });
    send({
      type: 'assistant',
      session_id: 'foreign-session-id',
      parent_tool_use_id: null,
      message: {
        id: 'msg_foreign_ignored',
        model,
        content: [{ type: 'text', text: 'foreign session output' }],
        usage: { input_tokens: 888, output_tokens: 888 },
      },
    });
    await delay(100);
    // Emit the same response ID twice (parallel chunks) to verify count-once deduplication.
    for (const chunk of [
      { type: 'tool_use', id: 'toolu_read_1', name: 'Read', input: { file_path: 'README.md' } },
      {
        type: 'text',
        text: `${String.fromCharCode(0x1b)}[31mfinal text${String.fromCharCode(0x1b)}[0m\u202e`,
      },
    ]) {
      send({
        type: 'assistant',
        session_id: sessionId,
        parent_tool_use_id: null,
        message: {
          id: msgId,
          model,
          content: [chunk],
          usage: {
            input_tokens: 15,
            output_tokens: 1,
            cache_creation_input_tokens: 5,
            cache_read_input_tokens: 20,
          },
        },
      });
    }
    send({
      type: 'user',
      session_id: sessionId,
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'toolu_read_1', is_error: false }],
      },
    });
    send({
      type: 'stream_event',
      session_id: sessionId,
      parent_tool_use_id: null,
      event: { type: 'message_delta', usage: { output_tokens: 18 } },
    });
    send({
      type: 'result',
      subtype: 'success',
      is_error: false,
      terminal_reason: 'completed',
      session_id: sessionId,
      result: 'final text',
      user_message_uuids: [turnUuid],
      usage: { output_tokens: 18 },
      total_cost_usd: 0.0042,
    });
    activeTurn = null;
    if (inputClosed) process.exit(0);
    return;
  }
  if (text.startsWith('approval:')) {
    const mode = text.slice('approval:'.length);
    const toolUseId = `toolu_${mode}_${turnSeq}`;
    if (mode === 'withdraw') {
      const requestId = `srv_req_${++requestSeq}`;
      send({
        type: 'control_request',
        request_id: requestId,
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Bash',
          tool_use_id: toolUseId,
          input: { command: 'echo withdrawn' },
        },
      });
      await delay(60);
      send({ type: 'control_cancel_request', request_id: requestId });
      finishTurn(turnUuid, 'withdrawn');
      return;
    }
    const spec =
      mode === 'bash'
        ? {
            tool_name: 'Bash',
            input: { command: 'ls -la', description: 'List files' },
            decision_reason: `${String.fromCharCode(0x1b)}[33mManual mode check${String.fromCharCode(0x1b)}[0m`,
          }
        : mode === 'edit'
          ? {
              tool_name: 'Edit',
              input: { file_path: 'notes.txt', old_string: 'old', new_string: 'new' },
            }
          : mode === 'read'
            ? {
                tool_name: 'Read',
                input: { file_path: '../outside/notes.txt' },
                blocked_path: '/synthetic/outside/notes.txt',
              }
            : {
                tool_name: 'AskUserQuestion',
                input: { questions: [] },
                requires_user_interaction: true,
              };
    send({
      type: 'assistant',
      session_id: sessionId,
      parent_tool_use_id: null,
      message: {
        id: `msg_ask_${turnSeq}`,
        model,
        content: [{ type: 'tool_use', id: toolUseId, name: spec.tool_name, input: spec.input }],
        usage: { input_tokens: 6, output_tokens: 1 },
      },
    });
    const reply = await sendControlRequest({
      subtype: 'can_use_tool',
      tool_use_id: toolUseId,
      ...spec,
    });
    const outcome = reply.response ?? {};
    assert.equal(outcome.updatedPermissions, undefined);
    send({
      type: 'user',
      session_id: sessionId,
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            is_error: outcome.behavior !== 'allow',
          },
        ],
      },
    });
    if (outcome.interrupt) {
      finishTurn(turnUuid, undefined, { error: true, terminalReason: 'aborted_tools' });
      return;
    }
    finishTurn(turnUuid, `${mode}:${outcome.behavior}`);
    return;
  }
  if (text.startsWith('delegate:') || text.startsWith('delegate-crash:')) {
    const crashBeforeReceipt = text.startsWith('delegate-crash:');
    const payload = JSON.parse(text.slice(text.indexOf(':') + 1));
    const toolUseId = `toolu_delegate_${turnSeq}`;
    send({
      type: 'assistant',
      session_id: sessionId,
      parent_tool_use_id: null,
      message: {
        id: `msg_del_${turnSeq}`,
        model,
        content: [
          {
            type: 'tool_use',
            id: toolUseId,
            name: 'mcp__orqst__orqst_delegate_task',
            input: payload,
          },
        ],
        usage: { input_tokens: 8, output_tokens: 1 },
      },
    });
    const mcpReply = await sendControlRequest({
      subtype: 'mcp_message',
      server_name: 'orqst',
      message: {
        jsonrpc: '2.0',
        id: `call_${turnSeq}`,
        method: 'tools/call',
        params: {
          name: 'orqst_delegate_task',
          arguments: payload,
        },
      },
    });
    if (crashBeforeReceipt) process.exit(19);
    const toolResult = mcpReply.response?.mcp_response?.result;
    const isError = toolResult?.isError === true;
    const resultText = toolResult?.content?.[0]?.text ?? '';
    send({
      type: 'user',
      session_id: sessionId,
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            is_error: isError,
            content: resultText,
          },
        ],
      },
    });
    if (isError) {
      finishTurn(turnUuid, 'delegation refused');
      return;
    }
    const worker = JSON.parse(resultText).untrustedWorkerResult;
    finishTurn(turnUuid, `claude-source:${worker}`);
    return;
  }

  await delay(30);
  finishTurn(turnUuid, `claude-worker:${text}`);
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const frame = JSON.parse(line);
  if (frame.type === 'control_response') {
    const resolver = pendingRequests.get(frame.response?.request_id);
    if (resolver) {
      pendingRequests.delete(frame.response.request_id);
      resolver(frame.response);
    }
    return;
  }
  if (frame.type === 'control_request') {
    const { subtype } = frame.request ?? {};
    if (subtype === 'initialize') {
      assert.deepEqual(frame.request.sdkMcpServers, ['orqst']);
      void (async () => {
        const initReply = await sendControlRequest({
          subtype: 'mcp_message',
          server_name: 'orqst',
          message: {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-11-25' },
          },
        });
        assert.equal(initReply.response?.mcp_response?.result?.serverInfo?.name, 'orqst');
        await sendControlRequest({
          subtype: 'mcp_message',
          server_name: 'orqst',
          message: { jsonrpc: '2.0', method: 'notifications/initialized' },
        });
        const listReply = await sendControlRequest({
          subtype: 'mcp_message',
          server_name: 'orqst',
          message: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        });
        assert.equal(
          listReply.response?.mcp_response?.result?.tools?.[0]?.name,
          'orqst_delegate_task',
        );
        send({
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: frame.request_id,
            response: {
              claude_code_version: '2.1.318',
              commands: [],
              agents: [],
              models: [],
            },
            pending_permission_requests: [],
          },
        });
      })();
      return;
    }
    if (subtype === 'interrupt') {
      send({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: frame.request_id,
          response: {},
        },
      });
      activeTurn?.interrupt();
      return;
    }
  }
  if (frame.type === 'user' && !activeTurn) {
    void runTurn(frame);
  }
});

process.stdin.on('end', () => {
  inputClosed = true;
  if (!activeTurn) process.exit(0);
});

setInterval(() => {}, 60_000);
