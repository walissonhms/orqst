import { confirmedUsageSchema, type Usage } from '@orqst/protocol';
import { z } from 'zod';

const count = z.int().nonnegative();
const assistant = z.object({
  type: z.literal('assistant'),
  isSidechain: z.boolean().optional(),
  isApiErrorMessage: z.boolean().optional(),
  sessionId: z.string(),
  cwd: z.string(),
  message: z.object({
    id: z.string().min(1).max(200),
    model: z.string().min(1).max(200),
    usage: z.unknown(),
  }),
});
const reportedCounters = z.object({
  input_tokens: count,
  output_tokens: count,
  cache_creation_input_tokens: count.nullish(),
  cache_read_input_tokens: count.nullish(),
});

/** Claude transcript fragments can repeat the same response's usage. Each response counts once. */
export function claudeTranscriptUsage(
  lines: string[],
  sessionId: string,
  cwd: string,
): Usage | undefined {
  const responses = new Map<string, { model: string; usage: Usage }>();
  for (const line of lines) {
    if (!line) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return undefined;
    }
    const parsed = assistant.safeParse(raw);
    if (!parsed.success) continue;
    const record = parsed.data;
    if (
      record.isSidechain ||
      record.isApiErrorMessage ||
      record.sessionId !== sessionId ||
      record.cwd !== cwd ||
      record.message.model === '<synthetic>' ||
      record.message.usage == null
    )
      continue;
    const { id, model } = record.message;
    const parsedCounters = reportedCounters.safeParse(record.message.usage);
    if (!parsedCounters.success) return undefined;
    const counters = parsedCounters.data;
    const cached = counters.cache_read_input_tokens ?? 0;
    const input = counters.input_tokens + (counters.cache_creation_input_tokens ?? 0) + cached;
    const output = counters.output_tokens;
    const usage = confirmedUsageSchema.safeParse({ input, output, cached, total: input + output });
    if (!usage.success) return undefined;
    const previous = responses.get(id);
    if (previous) {
      if (previous.model !== model) return undefined;
      const fields = ['input', 'output', 'cached'] as const;
      if (fields.every((field) => usage.data[field] <= previous.usage[field])) continue;
      if (!fields.every((field) => usage.data[field] >= previous.usage[field])) return undefined;
    }
    responses.set(id, { model, usage: usage.data });
  }
  if (!responses.size) return undefined;
  const sum = { input: 0, output: 0, cached: 0, total: 0 };
  for (const { usage } of responses.values()) {
    sum.input += usage.input;
    sum.output += usage.output;
    sum.cached += usage.cached;
    sum.total += usage.total;
  }
  const result = confirmedUsageSchema.safeParse(sum);
  return result.success ? result.data : undefined;
}
