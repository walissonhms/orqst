import {
  tauriStudioReplySchema,
  tauriStudioRequestSchema,
  type TauriStudio,
} from '@orqst/protocol';

/** Validation is defense in depth; native Webview identity/focus remain authoritative. */
export function createTauriStudioClient(
  send: (request: unknown) => Promise<unknown>,
  activated: () => boolean,
): TauriStudio {
  return Object.freeze({
    contractVersion: 1 as const,
    async request(input: Parameters<TauriStudio['request']>[0]) {
      const request = tauriStudioRequestSchema.safeParse(input, { jitless: true });
      if (!request.success) return { status: 'denied' as const };
      if (!['snapshot', 'catalog'].includes(request.data.action) && !activated())
        return { status: 'focus_required' as const };
      try {
        const reply = tauriStudioReplySchema.safeParse(await send(request.data), { jitless: true });
        if (reply.success && reply.data.status === 'batch') {
          if (request.data.action !== 'create-batch') return { status: 'unavailable' as const };
          const requests = request.data.requests;
          if (
            reply.data.items.length !== requests.length ||
            reply.data.items.some((item, index) => item.id !== requests[index]?.id)
          )
            return { status: 'unavailable' as const };
        }
        return reply.success ? reply.data : { status: 'unavailable' as const };
      } catch {
        return { status: 'unavailable' as const };
      }
    },
  });
}
