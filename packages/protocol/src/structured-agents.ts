import { z } from 'zod';

export const structuredAgentsLimits = Object.freeze({
  sessions: 4,
  items: 120,
  itemText: 4096,
  turnText: 2600,
  label: 64,
  delegations: 32,
  delegationTask: 2048,
});

const uuid = z.uuid();
const id = z.string().min(1).max(200);
const decision = z.enum(['accept', 'decline', 'cancel']);
export type StructuredDecision = z.infer<typeof decision>;

export interface StructuredItem {
  turnId: string;
  id: string;
  kind: 'user_message' | 'agent_message' | 'command' | 'file_change' | 'tool_call';
  text: string;
  status?: 'in_progress' | 'completed' | 'failed' | 'declined';
}

export interface StructuredApproval {
  approvalId: string;
  turnId: string;
  kind: 'command' | 'file_change' | 'unsupported';
  detail: string;
  decisions: StructuredDecision[];
  state: 'pending' | 'answered' | 'resolved' | 'unavailable';
}

export interface StructuredTurn {
  turnId: string;
  state: 'accepted' | 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown';
  origin: 'human' | 'delegation';
}

export interface StructuredSession {
  sessionId: string;
  provider: 'codex';
  workspaceId: string;
  featureId: string;
  label: string;
  lifecycle: 'starting' | 'ready' | 'stopping' | 'exited' | 'failed';
  reportedModel: string | null;
  threadId: string | null;
  exit: { code: number | null; signal: string | null } | null;
  items: StructuredItem[];
  droppedItems: number;
  approvals: StructuredApproval[];
  turn: StructuredTurn | null;
  busy: boolean;
}

export interface StructuredDelegation {
  delegationId: string;
  sourceSessionId: string;
  targetSessionId: string;
  targetTurnId: string | null;
  state:
    | 'requested'
    | 'accepted'
    | 'running'
    | 'completed'
    | 'returned'
    | 'failed'
    | 'interrupted'
    | 'unknown';
}

export interface StructuredAgentsSnapshot {
  sessions: StructuredSession[];
  delegations: StructuredDelegation[];
}

const sessionId = uuid;
export const structuredAgentsRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('snapshot') }),
  z.strictObject({
    action: z.literal('start'),
    label: z.string().trim().min(1).max(structuredAgentsLimits.label),
  }),
  z.strictObject({
    action: z.literal('turn'),
    sessionId,
    text: z.string().trim().min(1).max(structuredAgentsLimits.turnText),
  }),
  z.strictObject({ action: z.literal('approval'), sessionId, approvalId: uuid, decision }),
  z.strictObject({ action: z.literal('interrupt'), sessionId }),
  z.strictObject({
    action: z.literal('grant'),
    sourceSessionId: sessionId,
    targetSessionId: sessionId,
    task: z.string().trim().min(1).max(structuredAgentsLimits.delegationTask),
  }),
  z.strictObject({ action: z.literal('stop'), sessionId }),
]);
export type StructuredAgentsRequest = z.infer<typeof structuredAgentsRequestSchema>;

export const structuredAgentsScopeSchema = z.strictObject({
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/),
  featureId: uuid,
});
export type StructuredAgentsScope = z.infer<typeof structuredAgentsScopeSchema>;

export const structuredAgentsReviewSchema = z.object({
  token: id,
  detail: z.string().min(1).max(4096),
});

export type StructuredAgentsReply =
  | { status: 'ok'; snapshot?: StructuredAgentsSnapshot }
  | { status: 'disabled' | 'denied' | 'cancelled' | 'busy' | 'unavailable' };

export interface DesktopStructuredAgents {
  request(
    scope: StructuredAgentsScope,
    request: StructuredAgentsRequest,
  ): Promise<StructuredAgentsReply>;
}
