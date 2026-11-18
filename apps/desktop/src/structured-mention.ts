import {
  resolveStructuredHandle,
  type DesktopStructuredAgentsRequest,
  type StructuredAgentsRequest,
  type StructuredAgentsScope,
  type StructuredAgentsSnapshot,
} from '@orqst/protocol';

/** The owner reviews the same exact task and destination as a regular structured grant. */
export function structuredMentionGrant(
  scope: StructuredAgentsScope,
  sessions: StructuredAgentsSnapshot['sessions'],
  request: Extract<DesktopStructuredAgentsRequest, { action: 'mention' }>,
): Extract<StructuredAgentsRequest, { action: 'grant' }> | undefined {
  const target = resolveStructuredHandle(scope, sessions, request.handle);
  if (target !== request.targetSessionId || target === request.sourceSessionId) return;
  return {
    action: 'grant',
    sourceSessionId: request.sourceSessionId,
    targetSessionId: target,
    task: request.task,
  };
}
