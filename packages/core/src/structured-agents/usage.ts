import { confirmedUsageSchema, type StructuredSessionUsage } from '@orqst/protocol';
import { z } from 'zod';

const count = z.int().nonnegative();
const id = z.string().min(1).max(200);
const codexSnapshot = z.object({
  threadId: id,
  turnId: id,
  tokenUsage: z.object({
    total: z.object({
      inputTokens: count,
      outputTokens: count,
      cachedInputTokens: count,
      totalTokens: count,
    }),
  }),
});

export function codexThreadUsage(
  raw: unknown,
  threadId: string | null,
): StructuredSessionUsage | undefined {
  const snapshot = codexSnapshot.safeParse(raw);
  if (!snapshot.success || snapshot.data.threadId !== threadId) return undefined;
  const { inputTokens, outputTokens, cachedInputTokens, totalTokens } =
    snapshot.data.tokenUsage.total;
  const usage = confirmedUsageSchema.safeParse({
    input: inputTokens,
    output: outputTokens,
    cached: cachedInputTokens,
    total: totalTokens,
  });
  if (usage.success)
    return { usage: usage.data, usageKind: 'session_cumulative', turnId: snapshot.data.turnId };
}

const openCodeSnapshot = z.object({
  tokens: z.object({
    input: count,
    output: count,
    reasoning: count,
    cache: z.object({ read: count, write: count }),
  }),
  cost: z.unknown().optional(),
});

export function openCodeSessionUsage(raw: unknown): StructuredSessionUsage | undefined {
  const snapshot = openCodeSnapshot.safeParse(raw);
  if (!snapshot.success) return undefined;
  const { tokens, cost } = snapshot.data;
  const input = tokens.input + tokens.cache.read + tokens.cache.write;
  const output = tokens.output + tokens.reasoning;
  const usage = confirmedUsageSchema.safeParse({
    input,
    output,
    cached: tokens.cache.read,
    total: input + output,
  });
  if (!usage.success) return undefined;
  // OpenCode emits zero both for unpriced models and for zero-cost usage.
  const amount = z.number().finite().positive().safeParse(cost);
  return {
    usage: usage.data,
    usageKind: 'session_cumulative',
    ...(amount.success && {
      cost: { amount: amount.data, currency: 'USD', source: 'opencode_estimate' },
    }),
  };
}

const claudeCounters = z.object({
  input_tokens: count,
  output_tokens: count,
  cache_creation_input_tokens: count.nullish(),
  cache_read_input_tokens: count.nullish(),
});
const claudeMessage = z.object({
  id,
  model: id,
  usage: claudeCounters,
});
const claudeAssistantEvent = z.object({
  type: z.literal('assistant'),
  session_id: id,
  parent_tool_use_id: z.string().nullish(),
  isSidechain: z.boolean().optional(),
  isApiErrorMessage: z.boolean().optional(),
  message: claudeMessage,
});
const claudeStreamEvent = z.object({
  type: z.literal('stream_event'),
  session_id: id,
  parent_tool_use_id: z.string().nullish(),
  event: z.discriminatedUnion('type', [
    z.object({ type: z.literal('message_start'), message: claudeMessage }),
    z.object({ type: z.literal('message_delta'), usage: z.object({ output_tokens: count }) }),
  ]),
});
const claudeResultEvent = z.object({
  type: z.literal('result'),
  session_id: id,
  usage: z.object({ output_tokens: count }).optional(),
  total_cost_usd: z.unknown().optional(),
});

interface ClaudeResponseEntry {
  model: string;
  input: number;
  output: number;
  cached: number;
  turnId?: string;
}

/**
 * Deduplicates main-thread Claude stream-json usage by API response ID so parallel
 * tool-call fragments sharing one message ID are counted once, then reconciles
 * placeholder step output tokens against the turn result without double-counting.
 */
export class ClaudeUsageTracker {
  private readonly responses = new Map<string, ClaudeResponseEntry>();
  private streamResponseId: string | undefined;
  private lastTurnId: string | undefined;
  private costUsd: number | undefined;
  private saturated = false;

  observeAssistant(
    raw: unknown,
    sessionId: string | null,
    turnId?: string,
  ): StructuredSessionUsage | undefined {
    const parsed = claudeAssistantEvent.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.session_id !== sessionId ||
      parsed.data.parent_tool_use_id != null ||
      parsed.data.isSidechain ||
      parsed.data.isApiErrorMessage ||
      parsed.data.message.model === '<synthetic>'
    )
      return this.snapshot();
    this.upsert(parsed.data.message, turnId);
    return this.snapshot();
  }

  observeStreamEvent(
    raw: unknown,
    sessionId: string | null,
    turnId?: string,
  ): StructuredSessionUsage | undefined {
    const parsed = claudeStreamEvent.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.session_id !== sessionId ||
      parsed.data.parent_tool_use_id != null
    )
      return this.snapshot();
    const { event } = parsed.data;
    if (event.type === 'message_start') {
      if (event.message.model === '<synthetic>') return this.snapshot();
      if (this.upsert(event.message, turnId)) this.streamResponseId = event.message.id;
    } else if (this.streamResponseId) {
      const entry = this.responses.get(this.streamResponseId);
      if (entry && event.usage.output_tokens >= entry.output) {
        entry.output = event.usage.output_tokens;
        if (turnId) {
          entry.turnId ??= turnId;
          this.lastTurnId = turnId;
        }
      }
    }
    return this.snapshot();
  }

  observeResult(
    raw: unknown,
    sessionId: string | null,
    turnId?: string,
  ): StructuredSessionUsage | undefined {
    const parsed = claudeResultEvent.safeParse(raw);
    if (!parsed.success || parsed.data.session_id !== sessionId) return this.snapshot();
    if (turnId && parsed.data.usage) {
      let turnOutput = 0;
      let latest: ClaudeResponseEntry | undefined;
      for (const entry of this.responses.values()) {
        if (entry.turnId === turnId) {
          turnOutput += entry.output;
          latest = entry;
        }
      }
      if (latest && parsed.data.usage.output_tokens > turnOutput) {
        latest.output += parsed.data.usage.output_tokens - turnOutput;
        this.lastTurnId = turnId;
      }
    }
    const amount = z.number().finite().positive().safeParse(parsed.data.total_cost_usd);
    if (amount.success && amount.data >= (this.costUsd ?? 0) && this.responses.size > 0)
      this.costUsd = amount.data;
    return this.snapshot();
  }

  snapshot(): StructuredSessionUsage | undefined {
    if (!this.responses.size) return undefined;
    let input = 0;
    let output = 0;
    let cached = 0;
    for (const entry of this.responses.values()) {
      input += entry.input;
      output += entry.output;
      cached += entry.cached;
    }
    const usage = confirmedUsageSchema.safeParse({ input, output, cached, total: input + output });
    if (!usage.success || usage.data.total === 0) return undefined;
    return {
      usage: usage.data,
      usageKind: 'session_cumulative',
      ...(this.lastTurnId && { turnId: this.lastTurnId }),
      ...(this.costUsd !== undefined && {
        cost: { amount: this.costUsd, currency: 'USD', source: 'claude_estimate' },
      }),
    };
  }

  private upsert(message: z.infer<typeof claudeMessage>, turnId?: string): boolean {
    const cached = message.usage.cache_read_input_tokens ?? 0;
    const input =
      message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + cached;
    const output = message.usage.output_tokens;
    const usage = confirmedUsageSchema.safeParse({ input, output, cached, total: input + output });
    if (!usage.success) return false;
    const previous = this.responses.get(message.id);
    if (previous) {
      if (previous.model !== message.model) return false;
      const fields = ['input', 'output', 'cached'] as const;
      if (fields.every((field) => usage.data[field] <= previous[field])) return true;
      if (!fields.every((field) => usage.data[field] >= previous[field])) return false;
      previous.input = usage.data.input;
      previous.output = usage.data.output;
      previous.cached = usage.data.cached;
      if (turnId) {
        previous.turnId ??= turnId;
        this.lastTurnId = turnId;
      }
      return true;
    }
    if (this.saturated || this.responses.size >= 512) {
      this.saturated = true;
      return false;
    }
    this.responses.set(message.id, {
      model: message.model,
      input: usage.data.input,
      output: usage.data.output,
      cached: usage.data.cached,
      turnId,
    });
    if (turnId) this.lastTurnId = turnId;
    return true;
  }
}
