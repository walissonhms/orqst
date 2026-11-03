// Private synthetic Node-host protocol. No provider/executable/cwd/env field is accepted.
import { z } from 'zod';

export const syntheticCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('write'), text: z.string().min(1).max(4096) }),
  z.strictObject({
    action: z.literal('resize'),
    columns: z.number().int().min(20).max(300),
    rows: z.number().int().min(5).max(100),
  }),
  z.strictObject({ action: z.literal('signal'), signal: z.enum(['SIGTERM', 'SIGKILL']) }),
]);
export const syntheticEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('started') }),
  z.strictObject({ type: z.literal('data'), text: z.string().max(64 * 1024) }),
  z.strictObject({
    type: z.literal('exit'),
    exitCode: z.number().int().safe(),
    signal: z.number().int().safe().optional(),
  }),
]);
