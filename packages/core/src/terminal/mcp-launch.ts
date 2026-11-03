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
