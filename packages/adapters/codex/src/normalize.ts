import { basename, normalize } from 'node:path';
import { eventSchema, type AgentEvent, type Usage } from '@orqst/protocol';
import { object, str, safeText, stableId } from '@orqst/shared';

export interface CodexState {
  sessionId?: string;
  workspaceId?: string;
  cwd?: string;
  agentName?: string;
  parentSessionId?: string;
  minOrdinal?: number;
  turnId?: string;
  rootTurnId?: string;
  model?: string;
}
export interface SourceRecord {
  file: string;
  offset: number;
  line: number;
  hash: string;
}
function usage(value: unknown): Usage | undefined {
  const u = object(value);
  if (typeof u.input_tokens !== 'number' || typeof u.output_tokens !== 'number') return undefined;
  const input = u.input_tokens,
    output = u.output_tokens,
    cached = u.cached_input_tokens ?? 0,
    total = u.total_tokens ?? input + output;
  if (
    ![input, output, cached, total].every(
      (n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0,
    )
  )
    return undefined;
  if (Number(cached) > input || Number(total) !== input + output) return undefined;
  return { input, output, cached: Number(cached), total: Number(total) };
}
export function normalizeRecord(
  value: unknown,
  state: CodexState,
  source: SourceRecord,
  machineId: string,
): AgentEvent[] {
  const record = object(value),
    p = object(record.payload),
    type = str(record.type);
  const timestamp = str(record.timestamp);
  if (!type || !timestamp || !Number.isFinite(Date.parse(timestamp))) return [];
  if (type === 'session_meta') {
    // A fork can contain the parent's session_meta after the child's. Only the first is identity.
    if (state.sessionId) return [];
    const sessionId = str(p.id) ?? str(p.session_id);
    if (!sessionId) return [];
    state.sessionId = sessionId;
    state.cwd = str(p.cwd) ? normalize(str(p.cwd)!) : undefined;
    state.workspaceId = stableId('workspace', state.cwd ?? `unknown:${sessionId}`);
    const parent = object(object(object(p.source).subagent).thread_spawn);
    state.parentSessionId = str(p.parent_thread_id) ?? str(parent.parent_thread_id);
    state.agentName =
      safeText(p.agent_nickname, 100) ??
      safeText(parent.agent_nickname, 100) ??
      safeText(p.agent_path, 150) ??
      basename(state.cwd ?? '') + ' · ' + sessionId.slice(0, 8);
    state.minOrdinal =
      typeof p.subagent_history_start_ordinal === 'number'
        ? p.subagent_history_start_ordinal
        : undefined;
  } else if (
    state.minOrdinal !== undefined &&
    typeof record.ordinal === 'number' &&
    record.ordinal < state.minOrdinal
  )
    return [];
  if (!state.sessionId || !state.workspaceId) return [];
  const turn = object(p.internal_chat_message_metadata_passthrough);
  if (type === 'turn_context' || p.type === 'task_started') {
    state.turnId = str(p.turn_id) ?? state.turnId;
    state.rootTurnId = str(p.root_turn_id) ?? state.rootTurnId;
    state.model = str(p.model) ?? state.model;
  }
  function emit(eventType: AgentEvent['type'], payload: AgentEvent['payload']): AgentEvent[] {
    const event = {
      schemaVersion: 1,
      id: stableId(
        'codex',
        machineId,
        state.sessionId!,
        type!,
        str(p.type) ?? '',
        str(p.response_id) ?? str(p.id) ?? source.hash,
        eventType,
      ),
      type: eventType,
      timestamp: new Date(timestamp!).toISOString(),
      adapter: 'codex',
      machineId,
      workspaceId: state.workspaceId!,
      sessionId: state.sessionId!,
      agentId: stableId(machineId, state.sessionId!),
      correlation: {
        turnId: str(p.turn_id) ?? str(turn.turn_id) ?? state.turnId,
        rootTurnId: str(p.root_turn_id) ?? state.rootTurnId,
        callId: str(p.call_id),
      },
      source: {
        ...source,
        recordType:
          type === 'event_msg' || type === 'response_item'
            ? `${type}:${String(p.type ?? 'unknown')}`
            : type!,
      },
      payload: { cwd: state.cwd, agentName: state.agentName, ...payload },
    };
    const result = eventSchema.safeParse(event);
    return result.success ? [result.data] : [];
  }
  if (type === 'session_meta')
    return emit('session.started', { status: 'unknown', parentSessionId: state.parentSessionId });
  if (type === 'turn_context') return emit('session.updated', { model: state.model });
  if (type === 'token_usage_record') {
    if (str(p.thread_id) && p.thread_id !== state.sessionId) return [];
    const snapshot = usage(p.thread_token_usage);
    if (!snapshot) return [];
    return emit('agent.tokens.updated', {
      usage: snapshot,
      usageKind: 'session_cumulative',
      turnUsage: usage(p.turn_token_usage),
      responseUsage: usage(p.usage),
      responseId: str(p.response_id),
      model: state.model,
    });
  }
  if (type === 'event_msg') {
    if (p.type === 'task_started')
      return emit('agent.started', { status: 'running', model: state.model });
    if (p.type === 'task_complete')
      return emit('agent.completed', {
        status: 'completed',
        result: safeText(p.last_agent_message),
      });
    if (p.type === 'turn_aborted') return emit('agent.updated', { status: 'interrupted' });
    if (p.type === 'error' || p.type === 'task_failed')
      return emit('agent.failed', {
        status: 'failed',
        text: safeText(p.message) ?? safeText(object(p.error).message),
      });
    if (p.type === 'token_count') {
      const snapshot = usage(object(p.info).total_token_usage);
      return snapshot
        ? emit('agent.tokens.updated', {
            usage: snapshot,
            usageKind: 'session_cumulative',
            model: state.model,
          })
        : [];
    }
  }
  if (type === 'response_item') {
    if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
      const text = safeText(p.content);
      if (!text) return [];
      return emit('agent.message', { text, role: p.role, phase: str(p.phase) });
    }
    if (p.type === 'agent_message') {
      const text = safeText(p.content);
      if (!text) return [];
      // Paths are source identifiers, not proof of cross-session identity.
      return emit('agent.message', {
        role: 'agent',
        text,
        recipient: safeText(p.recipient, 150),
        name: safeText(p.author, 150),
      });
    }
    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      const name = safeText(p.name, 150);
      const requiresInput =
        name === 'request_user_input' || name === 'functions.request_user_input';
      return emit(requiresInput ? 'agent.intervention.required' : 'agent.tool.started', {
        status: requiresInput ? 'waiting_for_user' : undefined,
        name,
        callId: str(p.call_id),
        text: safeText(p.arguments) ?? safeText(p.input),
      });
    }
    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output')
      return emit('agent.tool.completed', {
        status: 'running',
        role: 'tool',
        callId: str(p.call_id),
        text: safeText(p.output),
      });
  }
  return [];
}
