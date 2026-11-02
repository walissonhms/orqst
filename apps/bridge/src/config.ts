import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
export interface Config {
  port: number;
  dataDir: string;
  sessionsDir: string;
  dashboardDir: string;
  retentionDays: number;
  pollMs: number;
  dev: boolean;
}
function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    throw new Error('Invalid numeric ORQST configuration');
  return parsed;
}
export function loadConfig(): Config {
  return {
    port: integer(process.env.ORQST_PORT, 4317, 1024, 65535),
    dataDir: resolve(process.env.ORQST_DATA_DIR ?? join(homedir(), '.orqst')),
    sessionsDir: resolve(
      process.env.ORQST_CODEX_SESSIONS ??
        join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions'),
    ),
    dashboardDir: resolve('apps/dashboard/dist'),
    retentionDays: integer(process.env.ORQST_RETENTION_DAYS, 30, 1, 3650),
    pollMs: integer(process.env.ORQST_POLL_MS, 3000, 500, 60000),
    dev: process.env.ORQST_DEV === '1',
  };
}
