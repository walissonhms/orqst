import { basename, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventSchema, type AgentEvent } from '@orqst/protocol';
import { object, safeText, stableId, str } from '@orqst/shared';

export interface AntigravityState {
  sessionId?: string;
  workspaceId?: string;
  cwd?: string;
  explicitAgentName?: string;
  agentName?: string;
  started?: boolean;
  turnId?: string;
  model?: string;
  pendingToolCallIds?: string[];
}

export interface AntigravitySessionMetadata {
  cwd?: string;
  agentName?: string;
  updatedAt?: string;
}

export interface SourceRecord {
  file: string;
  offset: number;
  line: number;
  hash: string;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function sessionIdFromSourceFile(file: string): string | undefined {
  const parts = file.split('/');
  if (
    parts.length !== 5 ||
    parts[0] !== 'brain' ||
    parts[2] !== '.system_generated' ||
    parts[3] !== 'logs' ||
    (parts[4] !== 'transcript_full.jsonl' && parts[4] !== 'transcript.jsonl')
  )
    return undefined;
  const id = parts[1];
  if (
    !id ||
    id === '.' ||
    id === '..' ||
    id.length > 200 ||
    id.includes('\\') ||
    id.includes(':') ||
    hasControlCharacters(id)
  )
    return undefined;
  return id;
}

function workspacePathFromUri(uri: unknown): string | undefined {
  const raw = str(uri);
  if (!raw || hasControlCharacters(raw)) return undefined;
  if (raw.startsWith('file://')) {
    try {
      const resolved = fileURLToPath(raw);
      return resolved ? normalize(resolved) : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function parseConversationMetadata(value: unknown): Map<string, AntigravitySessionMetadata> {
  const result = new Map<string, AntigravitySessionMetadata>();
  const projects = object(value);
  for (const group of Object.values(projects)) {
    const conversations = object(group);
    for (const [conversationId, rawEntry] of Object.entries(conversations)) {
      if (
        !conversationId ||
        conversationId.length > 200 ||
        conversationId.includes('/') ||
        conversationId.includes('\\') ||
        conversationId.includes(':') ||
        hasControlCharacters(conversationId)
      )
        continue;
      const entry = object(rawEntry);
      const summary = object(entry.summary);
      const summaryId = str(summary.ID);
      if (summaryId && summaryId !== conversationId) continue;
      const uris = Array.isArray(summary.WorkspaceURIs) ? summary.WorkspaceURIs : [];
      const cwd = workspacePathFromUri(uris[0]);
      const agentName = safeText(summary.AgentName, 100)?.trim() || undefined;
      const updatedAt = str(summary.UpdatedAt) ?? str(entry.last_modified_time);
      result.set(conversationId, {
        cwd,
        agentName,
        updatedAt: updatedAt && Number.isFinite(Date.parse(updatedAt)) ? updatedAt : undefined,
      });
    }
  }
  return result;
}

function applyMetadata(state: AntigravityState, metadata?: AntigravitySessionMetadata): boolean {
  if (!state.sessionId) return false;
  const previousCwd = state.cwd;
  const previousAgentName = state.agentName;
  if (metadata?.cwd) state.cwd = normalize(metadata.cwd);
  if (metadata?.agentName) {
    const cleaned = safeText(metadata.agentName, 100)?.trim();
    if (cleaned) state.explicitAgentName = cleaned;
  }
  state.workspaceId = stableId('workspace', state.cwd ?? `unknown:${state.sessionId}`);
  state.agentName =
    state.explicitAgentName ??
    (state.cwd
      ? `${basename(state.cwd)} · ${state.sessionId.slice(0, 8)}`
      : `antigravity · ${state.sessionId.slice(0, 8)}`);
  return state.cwd !== previousCwd || state.agentName !== previousAgentName;
}

function serializeArgs(value: unknown): string | undefined {
  if (typeof value === 'string') return safeText(value);
  if (value !== undefined) {
    try {
      return safeText(JSON.stringify(value));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function normalizeMetadataUpdate(
  state: AntigravityState,
  metadata: AntigravitySessionMetadata | undefined,
  source: SourceRecord,
  machineId: string,
): AgentEvent[] {
  if (!state.sessionId || !state.started || !metadata?.updatedAt) return [];
  if (!Number.isFinite(Date.parse(metadata.updatedAt))) return [];
  const changed = applyMetadata(state, metadata);
  if (!changed || !state.workspaceId) return [];
  const event = {
    schemaVersion: 1,
    id: stableId(
      'antigravity',
      machineId,
      state.sessionId,
      'conversation_metadata',
      source.hash,
      'session.updated',
    ),
    type: 'session.updated' as const,
    timestamp: new Date(metadata.updatedAt).toISOString(),
    adapter: 'antigravity' as const,
    machineId,
    workspaceId: state.workspaceId,
    sessionId: state.sessionId,
    agentId: stableId(machineId, state.sessionId),
    correlation: {
      turnId: state.turnId,
    },
    source: {
      ...source,
      recordType: 'conversation_metadata',
    },
    payload: {
      cwd: state.cwd,
      agentName: state.agentName,
    },
  };
  const parsed = eventSchema.safeParse(event);
  return parsed.success ? [parsed.data] : [];
}

export function normalizeRecord(
  value: unknown,
  state: AntigravityState,
  source: SourceRecord,
  machineId: string,
  metadata?: AntigravitySessionMetadata,
): AgentEvent[] {
  if (!state.sessionId) {
    const resolved = sessionIdFromSourceFile(source.file);
    if (!resolved) return [];
    state.sessionId = resolved;
  }
  applyMetadata(state, metadata);
  if (!state.workspaceId) return [];

  const record = object(value);
  const stepIndex = record.step_index;
  const type = str(record.type);
  const timestamp = str(record.created_at);
  if (
    typeof stepIndex !== 'number' ||
    !Number.isSafeInteger(stepIndex) ||
    stepIndex < 0 ||
    !type ||
    hasControlCharacters(type) ||
    !timestamp ||
    !Number.isFinite(Date.parse(timestamp))
  )
    return [];

  const stepSource = str(record.source);
  if (stepSource && hasControlCharacters(stepSource)) return [];
  const stepStatus = str(record.status);
  const recordType = stepSource ? `${stepSource}:${type}` : type;
  const isoTimestamp = new Date(timestamp).toISOString();

  function emit(
    eventType: AgentEvent['type'],
    payload: AgentEvent['payload'],
    discriminator = '',
    callId?: string,
  ): AgentEvent[] {
    const id =
      eventType === 'session.started'
        ? stableId('antigravity', machineId, state.sessionId!, 'session.started')
        : stableId(
            'antigravity',
            machineId,
            state.sessionId!,
            String(stepIndex),
            recordType,
            stepStatus ?? '',
            discriminator,
            source.hash,
            eventType,
          );
    const event = {
      schemaVersion: 1,
      id,
      type: eventType,
      timestamp: isoTimestamp,
      adapter: 'antigravity',
      machineId,
      workspaceId: state.workspaceId!,
      sessionId: state.sessionId!,
      agentId: stableId(machineId, state.sessionId!),
      correlation: {
        turnId: state.turnId,
        callId,
      },
      source: {
        ...source,
        recordType,
      },
      payload: {
        cwd: state.cwd,
        agentName: state.agentName,
        ...payload,
      },
    };
    const result = eventSchema.safeParse(event);
    return result.success ? [result.data] : [];
  }

  const events: AgentEvent[] = [];
  if (!state.started) {
    state.started = true;
    events.push(...emit('session.started', { status: 'unknown' }, 'session'));
  }

  if (type === 'USER_INPUT') {
    state.turnId = `turn-${stepIndex}`;
    state.pendingToolCallIds = [];
    events.push(...emit('agent.started', { status: 'running', model: state.model }, 'turn'));
    const text = safeText(record.content);
    if (text) events.push(...emit('agent.message', { role: 'user', text }, 'message'));
    return events;
  }

  if (type === 'SYSTEM_MESSAGE') {
    state.turnId = `turn-${stepIndex}`;
    events.push(...emit('agent.started', { status: 'running', model: state.model }, 'turn'));
    return events;
  }

  if (type === 'ERROR_MESSAGE') {
    const text =
      safeText(record.error) ?? safeText(object(record.error).message) ?? safeText(record.content);
    events.push(...emit('agent.failed', { status: 'failed', text }, 'error'));
    return events;
  }

  if (type === 'ASK_QUESTION') {
    if (stepStatus === 'WAITING' || stepStatus === 'RUNNING' || stepStatus === 'PENDING') {
      events.push(
        ...emit(
          'agent.intervention.required',
          {
            status: 'waiting_for_user',
            name: 'ask_question',
            text: safeText(record.content),
          },
          'ask',
        ),
      );
    }
    return events;
  }

  // Per-step `input_tokens`, `output_tokens` and `cache_read_tokens` in Antigravity JSONL are
  // single-response counters where `input_tokens` is uncached and `cache_read_tokens` can exceed
  // `input_tokens`. No cumulative session snapshot or plan/quota record is present, so no
  // `agent.tokens.updated` event is fabricated. `thinking` is omitted by policy.
  if (type === 'PLANNER_RESPONSE') {
    const stepModel = str(record.model);
    if (stepModel && !hasControlCharacters(stepModel)) {
      state.model = stepModel;
      events.push(...emit('session.updated', { model: stepModel }, 'model'));
    }
    if (stepStatus === 'ERROR') {
      const text =
        safeText(record.error) ??
        safeText(object(record.error).message) ??
        safeText(record.content);
      events.push(...emit('agent.failed', { status: 'failed', text }, 'error'));
      return events;
    }
    if (stepStatus === 'CANCELED' || stepStatus === 'INTERRUPTED' || stepStatus === 'HALTED') {
      events.push(...emit('agent.updated', { status: 'interrupted' }, 'interrupted'));
      return events;
    }
    if (stepStatus === 'WAITING') {
      events.push(
        ...emit(
          'agent.intervention.required',
          { status: 'waiting_for_user', text: safeText(record.content) },
          'waiting',
        ),
      );
      return events;
    }
    if (
      stepStatus === 'RUNNING' ||
      stepStatus === 'GENERATING' ||
      stepStatus === 'PENDING' ||
      stepStatus === 'QUEUED'
    ) {
      events.push(...emit('agent.updated', { status: 'running' }, 'running'));
      return events;
    }
    if (stepStatus === 'DONE') {
      const rawToolCalls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
      const toolCalls = rawToolCalls
        .map((item) => object(item))
        .filter((item) => Boolean(str(item.name)));
      const text = safeText(record.content);
      if (toolCalls.length > 0) {
        if (text) {
          events.push(
            ...emit('agent.message', { role: 'assistant', text, phase: 'commentary' }, 'message'),
          );
        }
        state.pendingToolCallIds ??= [];
        for (const [toolIndex, toolCall] of toolCalls.entries()) {
          const rawName = str(toolCall.name)!;
          const name = safeText(rawName, 150);
          const callId = str(toolCall.id) ?? `step-${stepIndex}-call-${toolIndex}`;
          state.pendingToolCallIds.push(callId);
          const argsText = serializeArgs(toolCall.args);
          const requiresInput = rawName === 'ask_question';
          events.push(
            ...emit(
              requiresInput ? 'agent.intervention.required' : 'agent.tool.started',
              {
                status: requiresInput ? 'waiting_for_user' : 'running',
                name,
                callId,
                text: argsText,
              },
              `tool-${toolIndex}`,
              callId,
            ),
          );
        }
        return events;
      }
      if (text) {
        events.push(
          ...emit('agent.message', { role: 'assistant', text, phase: 'final_answer' }, 'message'),
        );
      }
      events.push(...emit('agent.completed', { status: 'completed', result: text }, 'completed'));
      return events;
    }
    return events;
  }

  if (type === 'GENERIC' && (!stepSource || stepSource === 'MODEL')) {
    if (stepStatus === 'CANCELED' || stepStatus === 'INTERRUPTED' || stepStatus === 'HALTED') {
      events.push(...emit('agent.updated', { status: 'interrupted' }, 'interrupted'));
      return events;
    }
    if (
      stepStatus === 'RUNNING' ||
      stepStatus === 'GENERATING' ||
      stepStatus === 'PENDING' ||
      stepStatus === 'QUEUED'
    ) {
      events.push(...emit('agent.updated', { status: 'running' }, 'running'));
      return events;
    }
    if (stepStatus === 'DONE' || stepStatus === 'ERROR') {
      const callId = state.pendingToolCallIds?.shift() ?? `step-${stepIndex}-result`;
      const text =
        safeText(record.error) ??
        safeText(object(record.error).message) ??
        safeText(record.content);
      events.push(
        ...emit(
          'agent.tool.completed',
          { status: 'running', role: 'tool', callId, text },
          'tool-result',
          callId,
        ),
      );
      return events;
    }
  }

  return events;
}
