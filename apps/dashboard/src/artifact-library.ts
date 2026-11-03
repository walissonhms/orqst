import {
  artifactExtractionRequestSchema,
  artifactTextLimit,
  eventSchema,
  type ArtifactExtractionRequest,
  type StoredEvent,
} from '@orqst/protocol';

export const artifactLibraryLimits = { page: 200, observations: 2000, sources: 200 } as const;

/** Selection of retained provider messages only; never automatic document detection. */
export function artifactSelection(event: StoredEvent): ArtifactExtractionRequest | undefined {
  if (
    event.adapter !== 'codex' ||
    event.type !== 'agent.message' ||
    !(
      (event.payload.role === 'assistant' && event.source.recordType === 'response_item:message') ||
      (event.payload.role === 'agent' && event.source.recordType === 'response_item:agent_message')
    ) ||
    !event.payload.text?.trim() ||
    new TextEncoder().encode(event.payload.text).byteLength > artifactTextLimit
  )
    return undefined;
  const result = artifactExtractionRequestSchema.safeParse({
    contractVersion: 1,
    sequence: event.sequence,
    eventId: event.id,
    sessionId: event.sessionId,
    machineId: event.machineId,
    adapter: event.adapter,
    workspaceId: event.workspaceId,
    agentId: event.agentId,
    sourceHash: event.source.hash,
  });
  return result.success ? result.data : undefined;
}

/** Fail closed on malformed, unordered or cross-session pages from the existing event API. */
export function parseArtifactPage(data: unknown, before: number, sessionId: string): StoredEvent[] {
  if (!data || typeof data !== 'object' || !('events' in data))
    throw new Error('Invalid artifact source page');
  const events = data.events;
  if (!Array.isArray(events) || events.length > artifactLibraryLimits.page)
    throw new Error('Invalid artifact source page');
  let previous = 0;
  const ids = new Set<string>();
  return events.map((value: unknown) => {
    const event = eventSchema.parse(value);
    const sequence =
      value && typeof value === 'object' ? Reflect.get(value, 'sequence') : undefined;
    if (
      !Number.isSafeInteger(sequence) ||
      sequence <= previous ||
      sequence >= before ||
      ids.has(event.id) ||
      (sessionId && event.sessionId !== sessionId)
    )
      throw new Error('Invalid artifact source page');
    previous = sequence as number;
    ids.add(event.id);
    return { ...event, sequence: sequence as number };
  });
}
