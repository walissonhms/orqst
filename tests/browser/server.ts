// Disposable, explicitly synthetic browser-test environment. Never used by pnpm dev/start.
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createBridge } from '../../apps/bridge/src/app.js';
import { browserPort } from '../helpers/browser-port.js';
const dir = await mkdtemp(join(tmpdir(), 'orqst-browser-'));
const root = join(dir, 'sessions');
await mkdir(root);
const stateFile = process.env.ORQST_BROWSER_STATE;
if (!stateFile) throw new Error('Browser fixture state path is required');
await writeFile(stateFile, JSON.stringify({ file: join(root, 'synthetic.jsonl') }), {
  mode: 0o600,
});
const stamp = new Date().toISOString();
const record = (type: string, payload: unknown) =>
  JSON.stringify({ type, timestamp: stamp, payload }) + '\n';
await writeFile(
  join(root, 'synthetic.jsonl'),
  [
    record('session_meta', {
      id: 'synthetic-browser-session',
      cwd: '/synthetic/browser-test',
      agent_nickname: 'Synthetic browser agent',
    }),
    record('turn_context', { turn_id: 'synthetic-turn', model: 'synthetic-test-model' }),
    record('event_msg', { type: 'task_started', turn_id: 'synthetic-turn' }),
    record('response_item', {
      type: 'message',
      id: 'synthetic-user',
      role: 'user',
      content: [{ type: 'input_text', text: 'Synthetic browser task — no real user activity' }],
    }),
    record('response_item', {
      type: 'function_call',
      name: 'synthetic_tool',
      call_id: 'synthetic-call',
      arguments: '<img src=x onerror="window.orqstInjected=true">',
    }),
    record('response_item', {
      type: 'function_call_output',
      call_id: 'synthetic-call',
      output: 'Synthetic tool output',
    }),
    record('token_usage_record', {
      thread_id: 'synthetic-browser-session',
      response_id: 'synthetic-response',
      thread_token_usage: {
        input_tokens: 100,
        output_tokens: 20,
        cached_input_tokens: 40,
        total_tokens: 120,
      },
      turn_token_usage: {
        input_tokens: 100,
        output_tokens: 20,
        cached_input_tokens: 40,
        total_tokens: 120,
      },
    }),
    record('response_item', {
      type: 'message',
      id: 'synthetic-final',
      role: 'assistant',
      phase: 'final_answer',
      content: [
        {
          type: 'output_text',
          text: 'Synthetic browser result — <script>window.orqstInjected=true</script>',
        },
      ],
    }),
    record('event_msg', {
      type: 'task_complete',
      last_agent_message: 'Synthetic browser result — <script>window.orqstInjected=true</script>',
    }),
  ].join(''),
);
const app = createBridge({
  port: browserPort,
  dataDir: dir,
  sessionsDir: root,
  dashboardDir: resolve('apps/dashboard/dist'),
  retentionDays: 30,
  pollMs: 500,
  dev: false,
});
await app.start();
async function stop() {
  await app.stop();
  await rm(dir, { recursive: true, force: true });
  await rm(stateFile!, { force: true });
}
process.on('SIGTERM', () => {
  void stop();
});
process.on('SIGINT', () => {
  void stop();
});
