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
