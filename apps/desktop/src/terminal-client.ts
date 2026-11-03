import {
  terminalNativeReplySchema,
  terminalNativeRequestSchema,
  type DesktopTerminal,
} from '@orqst/protocol';

/** Dedicated isolated preload only. No generic IPC, authority, subscriptions or offline queue. */
export function createTerminalClient(
  invoke: (request: unknown) => Promise<unknown>,
  activated: () => boolean,
): DesktopTerminal {
  let busy = false;
  return Object.freeze({
    contractVersion: 1 as const,
    async request(raw: unknown) {
      const parsed = terminalNativeRequestSchema.safeParse(raw);
      if (!parsed.success) return { status: 'denied' as const };
      const request = parsed.data;
      if (!['read', 'snapshot', 'resize', 'detach'].includes(request.action) && !activated())
        return { status: 'denied' as const };
      if (busy) return { status: 'busy' as const };
      busy = true;
      try {
        const reply = terminalNativeReplySchema.safeParse(await invoke(request));
        return reply.success ? reply.data : { status: 'denied' as const };
      } catch {
        return { status: 'denied' as const };
      } finally {
        busy = false;
      }
    },
  });
}
