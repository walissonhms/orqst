import { z } from 'zod';

export * from './analytics.js';
export * from './analytics-export.js';
export * from './lifecycle.js';
export * from './artifacts.js';
export * from './desktop-artifacts.js';
export * from './desktop-analytics.js';
export * from './live-metrics.js';
export * from './model-history.js';

export const statusSchema = z.enum([
  'running',
  'waiting_for_user',
  'completed',
  'failed',
  'interrupted',
  'unknown',
]);
export type AgentStatus = z.infer<typeof statusSchema>;
export const usageSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cached: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof usageSchema>;
export const eventTypes = [
  'session.started',
  'session.updated',
  'session.completed',
  'agent.started',
  'agent.updated',
  'agent.completed',
  'agent.failed',
  'agent.message',
  'agent.tool.started',
  'agent.tool.completed',
  'agent.intervention.required',
  'agent.tokens.updated',
  'workspace.updated',
] as const;
export const payloadSchema = z.object({
  status: statusSchema.optional(),
  text: z.string().optional(),
  role: z.enum(['user', 'assistant', 'agent', 'tool']).optional(),
  phase: z.string().optional(),
  name: z.string().optional(),
  callId: z.string().optional(),
  model: z.string().optional(),
  cwd: z.string().optional(),
  parentSessionId: z.string().optional(),
  agentName: z.string().optional(),
  recipient: z.string().optional(),
  result: z.string().optional(),
  usage: usageSchema.optional(),
  usageKind: z.enum(['session_cumulative', 'response_incremental', 'turn_cumulative']).optional(),
  responseId: z.string().optional(),
  turnUsage: usageSchema.optional(),
  responseUsage: usageSchema.optional(),
});
export const eventSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  type: z.enum(eventTypes),
  timestamp: z.iso.datetime({ offset: true }),
  adapter: z.enum(['codex', 'claude', 'opencode', 'manual']),
  machineId: z.string().min(1),
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  correlation: z.object({
    turnId: z.string().optional(),
    rootTurnId: z.string().optional(),
    callId: z.string().optional(),
  }),
  source: z.object({
    file: z.string(),
    offset: z.number().int().nonnegative(),
    line: z.number().int().nonnegative(),
    hash: z.string(),
    recordType: z.string(),
  }),
  payload: payloadSchema,
});
export type AgentEvent = z.infer<typeof eventSchema>;
export type StoredEvent = AgentEvent & { sequence: number };
export interface AdapterCapabilities {
  sessionDiscovery: boolean;
  realtimeEvents: boolean;
  messages: boolean;
  toolCalls: boolean;
  subagents: boolean;
  tokenUsage: boolean;
  taskResults: boolean;
  userIntervention: boolean;
  remoteControl: boolean;
}
export interface AdapterDescriptor {
  id: string;
  implemented: boolean;
  capabilities: AdapterCapabilities;
  evidence: string;
}
export interface SessionView {
  id: string;
  workspaceId: string;
  cwd: string;
  agentName: string;
  adapter: string;
  status: AgentStatus;
  startedAt: string;
  lastActivity: string;
  task: string | null;
  result: string | null;
  model: string | null;
  parentSessionId: string | null;
  usage: Usage;
  manualWorkspace: boolean;
}
export interface WorkspaceView {
  id: string;
  name: string;
  path: string;
  sessions: number;
  usage: Usage;
}
export interface NotificationView {
  id: string;
  sessionId: string;
  type: string;
  timestamp: string;
  read: boolean;
}
export const preferencesSchema = z.object({
  sound: z.boolean(),
  completed: z.boolean(),
  failed: z.boolean(),
  intervention: z.boolean(),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export interface Snapshot {
  cursor: number;
  workspaces: WorkspaceView[];
  sessions: SessionView[];
  events: StoredEvent[];
  notifications: NotificationView[];
  preferences: Preferences;
  adapters: AdapterDescriptor[];
  diagnostics: {
    files: number;
    malformed: number;
    skipped: number;
    oversized: number;
    errors: number;
    lastScan: string | null;
    scanning: boolean;
  };
}
export type StreamMessage =
  | { type: 'event'; event: StoredEvent; live: boolean }
  | { type: 'ready'; cursor: number }
  | { type: 'resync'; cursor: number };
export const emptyUsage = (): Usage => ({ input: 0, output: 0, cached: 0, total: 0 });
