import { eventSchema, type StoredEvent } from '@orqst/protocol';

export const observedToolLimits = Object.freeze({ inspected: 500, records: 100, text: 4000 });

export interface ObservedToolGroup {
  records: StoredEvent[];
  paired: boolean;
}

/** A display projection of loaded evidence, never a process or terminal state. */
export function observedTools(events: StoredEvent[], sessionId: string) {
  const candidates: StoredEvent[] = [];
  let invalid = false;
  for (const value of events.slice(-observedToolLimits.inspected)) {
    const parsed = eventSchema.safeParse(value);
    if (!parsed.success) {
      invalid = true;
      continue;
    }
    if (
      parsed.data.sessionId !== sessionId ||
      !['agent.tool.started', 'agent.tool.completed'].includes(parsed.data.type)
    )
      continue;
    if (
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 1 ||
      value.adapter !== 'codex' ||
      !supportedRecord(value)
    ) {
      invalid = true;
      continue;
    }
    candidates.push({ ...parsed.data, sequence: value.sequence });
  }
  candidates.sort((a, b) => a.sequence - b.sequence);
  const records = candidates.slice(-observedToolLimits.records);
  const byIdentity = new Map<string, StoredEvent[]>();
  for (const event of candidates) {
    const key = correlationKey(event);
    if (key) byIdentity.set(key, [...(byIdentity.get(key) ?? []), event]);
  }
  const displayedIds = new Set(records.map((event) => event.id));
  const groups: ObservedToolGroup[] = [];
  const pairedIds = new Set<string>();
  for (const event of records) {
    if (pairedIds.has(event.id)) continue;
    const key = correlationKey(event);
    const pair = key ? byIdentity.get(key) : undefined;
    // Ambiguity, missing identity or reversed source order never manufactures a pair.
    if (
      pair?.length === 2 &&
      pair[0]!.type === 'agent.tool.started' &&
      pair[1]!.type === 'agent.tool.completed' &&
      displayedIds.has(pair[0]!.id) &&
      displayedIds.has(pair[1]!.id) &&
      pair[0]!.sequence < pair[1]!.sequence &&
      pair[0]!.source.offset < pair[1]!.source.offset &&
      pair[0]!.source.line < pair[1]!.source.line &&
      pair[0]!.id !== pair[1]!.id
    ) {
      groups.push({ records: pair, paired: true });
      pairedIds.add(pair[0]!.id);
      pairedIds.add(pair[1]!.id);
    } else groups.push({ records: [event], paired: false });
  }
  return {
    groups: groups.reverse(),
    limited:
      events.length > observedToolLimits.inspected ||
      candidates.length > observedToolLimits.records,
    invalid,
  };
}

function supportedRecord(event: StoredEvent): boolean {
  const suffix = event.type === 'agent.tool.started' ? 'call' : 'call_output';
  return (
    event.source.recordType === `response_item:function_${suffix}` ||
    event.source.recordType === `response_item:custom_tool_${suffix}`
  );
}

function correlationKey(event: StoredEvent): string | undefined {
  const { callId, turnId } = event.correlation;
  if (!callId || !turnId || callId !== event.payload.callId) return undefined;
  return JSON.stringify([
    event.machineId,
    event.adapter,
    event.sessionId,
    event.agentId,
    turnId,
    callId,
    event.source.file,
    event.source.recordType.startsWith('response_item:custom_tool_') ? 'custom' : 'function',
  ]);
}

/** Escape controls visibly; never interpret terminal/OSC, bidi or zero-width sequences. */
export function toolDisplayText(value: string, limit: number = observedToolLimits.text) {
  const bounded = value.slice(0, limit);
  const escaped = bounded.replace(/[\s\S]/g, (character) => {
    const code = character.charCodeAt(0);
    const control = (code < 32 && code !== 9 && code !== 10) || (code >= 127 && code <= 159);
    const format =
      code === 0x061c ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff;
    return control || format ? `\\u${code.toString(16).padStart(4, '0')}` : character;
  });
  return {
    text: escaped.slice(0, limit),
    truncated: value.length > limit || escaped.length > limit,
  };
}
