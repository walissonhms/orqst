import { z } from 'zod';
import { terminalStateSchema } from './terminal-journal.js';

// Experimental native-only contract. Never exposed by the observer Bridge or preload.
const instance = { instanceId: z.string().uuid() };
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const action = <Name extends string, T extends z.ZodRawShape>(name: Name, fields: T) =>
  z.strictObject({ version: z.literal(1), action: z.literal(name), ...fields });

export const terminalNativeRequestSchema = z.discriminatedUnion('action', [
  action('start', { profileId: z.string().min(1).max(128) }),
  action('attach', instance),
  action('input', instance),
  action('write', { ...instance, sequence, text: z.string().min(1).max(4096) }),
  action('paste', {
    ...instance,
    sequence,
    text: z
      .string()
      .min(1)
      .max(16 * 1024),
  }),
  action('resize', {
    ...instance,
    columns: z.number().int().min(20).max(300),
    rows: z.number().int().min(5).max(100),
  }),
  action('read', { ...instance, cursor: sequence }),
  action('snapshot', instance),
  action('detach', instance),
  action('stop', { ...instance, signal: z.enum(['SIGTERM', 'SIGKILL']) }),
]);
export type TerminalNativeRequest = z.infer<typeof terminalNativeRequestSchema>;

export const terminalNativeReplySchema = z.union([
  z.strictObject({ status: z.enum(['denied', 'cancelled', 'busy']) }),
  z.strictObject({
    status: z.literal('ok'),
    instanceId: z.string().uuid(),
    snapshot: z
      .strictObject({
        instanceId: z.string().uuid(),
        epoch: z.string().uuid(),
        state: terminalStateSchema,
        exit: z
          .strictObject({
            exitCode: z.number().int().safe(),
            signal: z.number().int().safe().optional(),
          })
          .optional(),
      })
      .optional(),
    output: z
      .strictObject({
        bytes: z.array(z.number().int().min(0).max(255)).max(64 * 1024),
        nextCursor: sequence,
        gap: z.boolean(),
      })
      .optional(),
  }),
]);
export type TerminalNativeWireReply = z.infer<typeof terminalNativeReplySchema>;
export interface DesktopTerminal {
  readonly contractVersion: 1;
  request(request: TerminalNativeRequest): Promise<TerminalNativeWireReply>;
}

/** Trusted native-only presentation data, never accepted from a renderer. */
export interface TerminalNativeConfirmation {
  readonly operation: 'start' | 'attach' | 'input' | 'paste' | 'stop';
  readonly instanceId: string;
  readonly profile: Readonly<{
    id: string;
    projectId: string;
    executable: string;
    executableSha256: string;
    executableVersion: string;
    argv: readonly string[];
    cwd: string;
    environmentProfile: string;
    permissions: string;
  }>;
  readonly policy: Readonly<Record<string, number | readonly number[]>>;
  readonly signal?: 'SIGTERM' | 'SIGKILL';
  readonly paste?: string;
}
