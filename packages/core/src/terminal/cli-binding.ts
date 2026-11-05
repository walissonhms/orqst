import { z } from 'zod';

export const v2CliBindingSchema = z.strictObject({
  version: z.literal(2),
  provider: z.enum(['codex', 'claude', 'opencode']),
  mode: z.enum(['tui', 'mcp']),
  teamId: z.string().min(1).max(64),
  identifier: z.string().min(1).max(256),
  contractRevision: z.string().min(1).max(128),
  authorizationEpoch: z.uuid(),
  policyRevision: z.number().int().positive().max(4096),
});

export type V2CliBinding = z.infer<typeof v2CliBindingSchema>;
