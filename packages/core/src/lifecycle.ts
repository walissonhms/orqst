import {
  artifactReferenceResultSchema,
  observedSessionEvidenceResultSchema,
  type ArtifactReferenceResult,
  type ObservedSessionEvidence,
  type ObservedSessionEvidenceResult,
  type StoredEvent,
} from '@orqst/protocol';

/** Only the Codex source/event/status combinations already emitted by the adapter qualify. */
function turnState(event: StoredEvent): ObservedSessionEvidence['turn']['state'] {
  const { type, source, payload } = event;
  let value: 'running' | 'waiting_for_user' | 'completed' | 'failed' | 'interrupted' | undefined;
  if (
    type === 'agent.started' &&
    source.recordType === 'event_msg:task_started' &&
    payload.status === 'running'
  )
    value = 'running';
  if (
    type === 'agent.completed' &&
    source.recordType === 'event_msg:task_complete' &&
    payload.status === 'completed'
  )
    value = 'completed';
  if (
    type === 'agent.failed' &&
    ['event_msg:error', 'event_msg:task_failed'].includes(source.recordType) &&
    payload.status === 'failed'
  )
    value = 'failed';
  if (
    type === 'agent.updated' &&
    source.recordType === 'event_msg:turn_aborted' &&
    payload.status === 'interrupted'
  )
    value = 'interrupted';
  if (
    type === 'agent.intervention.required' &&
    ['response_item:function_call', 'response_item:custom_tool_call'].includes(source.recordType) &&
    ['request_user_input', 'functions.request_user_input'].includes(payload.name ?? '') &&
    payload.status === 'waiting_for_user'
  )
    value = 'waiting_for_user';
  return value
    ? { availability: 'available', value }
    : { availability: 'unavailable', reason: 'no_turn_state_evidence' };
}

export function projectObservedSession(event: StoredEvent): ObservedSessionEvidenceResult {
  if (event.adapter !== 'codex')
    return { availability: 'unavailable', reason: 'unsupported_adapter' };
  const parsed = observedSessionEvidenceResultSchema.safeParse({
    availability: 'available',
    value: {
      contract: 'orqst.lifecycle',
      contractVersion: 1,
      type: 'observed_session.evidence',
      mode: 'observed',
      identity: {
        sessionRef: {
          machineId: event.machineId,
          adapterId: event.adapter,
          nativeSessionId: event.sessionId,
        },
        workspaceId: event.workspaceId,
        observedAgent: { id: event.agentId, basis: 'v1_agent_id' },
        agentInstanceId: { availability: 'unavailable', reason: 'not_recorded' },
      },
      evidence: {
        kind: 'retained_v1_event',
        eventId: event.id,
        sequence: event.sequence,
        occurredAt: event.timestamp,
        observedAt: { availability: 'unavailable', reason: 'not_recorded' },
        sourceVerification: 'not_rechecked',
        source: {
          file: event.source.file,
          offset: event.source.offset,
          line: event.source.line,
          hash: event.source.hash,
          recordType: event.source.recordType,
        },
      },
      session: { state: 'discoverable', basis: 'retained_history' },
      turn: {
        identity:
          event.correlation.turnId === undefined
            ? { availability: 'unavailable', reason: 'not_recorded' }
            : { availability: 'available', value: event.correlation.turnId },
        state: turnState(event),
      },
      task: { availability: 'unavailable', reason: 'task_evidence_not_recorded' },
      process: { availability: 'unavailable', reason: 'process_not_observed' },
    },
  });
  // Never include validation input, captured content or source paths in public errors.
  if (!parsed.success) throw new Error('Invalid retained lifecycle evidence');
  return parsed.data;
}

export function projectArtifactReference(event: StoredEvent): ArtifactReferenceResult {
  const observation = projectObservedSession(event);
  if (observation.availability === 'unavailable') return observation;
  const role = event.payload.role;
  if (
    event.type !== 'agent.message' ||
    !(
      (role === 'assistant' && event.source.recordType === 'response_item:message') ||
      (role === 'agent' && event.source.recordType === 'response_item:agent_message')
    ) ||
    !event.payload.text?.trim()
  )
    return { availability: 'unavailable', reason: 'not_artifact_message' };
  const { identity, evidence, turn } = observation.value;
  const parsed = artifactReferenceResultSchema.safeParse({
    availability: 'available',
    value: {
      contract: 'orqst.lifecycle',
      contractVersion: 1,
      type: 'artifact.reference',
      kind: 'message_reference',
      identity,
      evidence,
      turnIdentity: turn.identity,
      role,
      content: { availability: 'unavailable', reason: 'reference_only' },
    },
  });
  if (!parsed.success) throw new Error('Invalid retained lifecycle evidence');
  return parsed.data;
}
