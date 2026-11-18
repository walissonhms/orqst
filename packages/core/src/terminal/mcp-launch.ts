import { isAbsolute } from 'node:path';
import { z } from 'zod';

const path = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => isAbsolute(value) && !value.includes('\0'));
export const terminalMcpLaunchSchema = z.strictObject({
  serverName: z.string().regex(/^orqst_[a-f0-9]{32}$/),
  socketPath: path,
  capabilityFile: path,
  relay: z.strictObject({ path, sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
});
export type TerminalMcpLaunch = z.infer<typeof terminalMcpLaunchSchema>;

// Explicit provider approval lists for the catalogs in mcp-relay.ts. New tools require review.
export const hubRelayTools = [
  'list_terminals',
  'send_message',
  'read_messages',
  'wait_messages',
  'delegate_task',
  'submit_result',
  'task_status',
] as const;
// The authenticated relay advertises only its source or worker subset.
export const pairRelayTools = ['delegate_task', 'wait_task', 'submit_result'] as const;
