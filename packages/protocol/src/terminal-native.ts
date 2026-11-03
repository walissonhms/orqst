import { z } from 'zod';

// Experimental native-only contract. No Bridge route or preload exposes it.
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
