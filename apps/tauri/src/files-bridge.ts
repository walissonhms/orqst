import {
  analyticsNativeRequestSchema,
  artifactSaveRequestSchema,
  type DesktopAnalytics,
  type DesktopArtifacts,
} from '@orqst/protocol';

type Invoke = (request: unknown) => Promise<unknown>;
const statuses = new Set([
  'saved',
  'saved_opened',
  'saved_open_failed',
  'cancelled',
  'failed',
  'write_failed',
  'stale',
  'unavailable',
  'busy',
  'acknowledged',
]);

// Initialization scripts can run before response CSP is applied; never use Zod JIT here.
export function createFileClients(invoke: Invoke, activated: () => boolean) {
  let busy = false;
  let generation = 0;
  const send = async (request: unknown) => {
    try {
      const value = await invoke(request);
      if (
        value &&
        typeof value === 'object' &&
        'status' in value &&
        typeof value.status === 'string' &&
        statuses.has(value.status)
      )
        return { status: value.status };
    } catch {
      /* Native diagnostics and paths never reach the dashboard. */
    }
    return { status: 'failed' as const };
  };
  const artifacts: DesktopArtifacts = {
    contractVersion: 1,
    async saveMarkdown(input) {
      if (
        busy ||
        !activated() ||
        !artifactSaveRequestSchema.safeParse(input, { jitless: true }).success
      )
        return { status: 'failed' };
      busy = true;
      try {
        const result = await send({ kind: 'artifact', input });
        return [
          'saved',
          'saved_opened',
          'saved_open_failed',
          'cancelled',
          'failed',
          'write_failed',
        ].includes(result.status)
          ? {
              status: result.status as Awaited<
                ReturnType<DesktopArtifacts['saveMarkdown']>
              >['status'],
            }
          : { status: 'failed' };
      } finally {
        busy = false;
      }
    },
  };
  const analytics: DesktopAnalytics = {
    contractVersion: 1,
    async setReading(reading) {
      const current = ++generation;
      const input = { contractVersion: 1, action: 'context', generation: current, reading };
      const valid = analyticsNativeRequestSchema.safeParse(input, { jitless: true }).success;
      const result = await send({
        kind: 'analytics',
        input: valid ? input : { ...input, reading: null },
      });
      return {
        generation: current,
        status:
          valid && generation === current && result.status === 'acknowledged'
            ? 'acknowledged'
            : 'failed',
      };
    },
    async save(format, current, reading) {
      if (!activated()) return { status: 'failed' };
      if (busy) return { status: 'busy' };
      const input = { contractVersion: 1, action: 'save', generation: current, reading, format };
      if (
        current !== generation ||
        !analyticsNativeRequestSchema.safeParse(input, { jitless: true }).success
      )
        return { status: 'stale' };
      busy = true;
      try {
        const result = await send({ kind: 'analytics', input });
        return [
          'saved',
          'cancelled',
          'failed',
          'write_failed',
          'stale',
          'unavailable',
          'busy',
        ].includes(result.status)
          ? { status: result.status as Awaited<ReturnType<DesktopAnalytics['save']>>['status'] }
          : { status: 'failed' };
      } finally {
        busy = false;
      }
    },
  };
  return { artifacts: Object.freeze(artifacts), analytics: Object.freeze(analytics) };
}
