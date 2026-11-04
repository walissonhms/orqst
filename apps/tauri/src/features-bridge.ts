import {
  featureNativeRequestSchema,
  featureNativeReplySchema,
  type DesktopFeatures,
} from '@orqst/protocol';

/** The native command authenticates the actual Webview. Activation here is defense in depth. */
export function createFeatureClient(
  invoke: (request: unknown) => Promise<unknown>,
  activated: () => boolean,
): DesktopFeatures {
  let busy = false;
  return Object.freeze({
    contractVersion: 1 as const,
    async request(input: Parameters<DesktopFeatures['request']>[0]) {
      if (!featureNativeRequestSchema.safeParse(input, { jitless: true }).success)
        return { status: 'denied' as const };
      if (input.action !== 'snapshot' && !activated()) return { status: 'denied' as const };
      if (busy) return { status: 'busy' as const };
      busy = true;
      try {
        const reply = featureNativeReplySchema.safeParse(await invoke(input), { jitless: true });
        return reply.success ? reply.data : { status: 'unavailable' as const };
      } catch {
        return { status: 'unavailable' as const };
      } finally {
        busy = false;
      }
    },
  });
}
