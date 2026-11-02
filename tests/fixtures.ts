// All fixtures in this file are synthetic and never loaded by the application.
import { createHash } from 'node:crypto';
import { normalizeRecord, type CodexState } from '../packages/adapters/codex/src/normalize.js';
import type { AgentEvent } from '@orqst/protocol';
export const stamp = '2026-11-02T15:00:00.000Z';
export const record = (type: string, payload: unknown, ordinal = 1) => ({
  type,
  timestamp: stamp,
  ordinal,
  payload,
});
export const meta = (id = 'synthetic-session', cwd = '/synthetic/project', extra = {}) =>
  record('session_meta', { id, cwd, ...extra }, 0);
export const token = (input: number, output: number, cached = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cached_input_tokens: cached,
  total_tokens: input + output,
});
export function normalized(records: unknown[], state: CodexState = {}): AgentEvent[] {
  return records.flatMap((value, index) =>
    normalizeRecord(
      value,
      state,
      {
        file: 'synthetic.jsonl',
        offset: index * 100,
        line: index + 1,
        hash: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
      },
      'synthetic-machine',
    ),
  );
}
