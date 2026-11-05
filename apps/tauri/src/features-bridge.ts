import {
  featureNativeRequestSchema,
  featureNativeReplySchema,
  featurePreparationRequestSchema,
  featurePreparationReplySchema,
  type DesktopFeatures,
} from '@orqst/protocol';

/** The native command authenticates the actual Webview. Activation here is defense in depth. */
export function createFeatureClient(
  invoke: (request: unknown) => Promise<unknown>,
  activated: () => boolean,
  showPreparation?: (request: unknown) => Promise<unknown>,
): DesktopFeatures {
  let busy = false;
  return Object.freeze({
    contractVersion: 1 as const,
    ...(showPreparation
      ? {
          async showPreparationDrawer(
            input: Parameters<NonNullable<DesktopFeatures['showPreparationDrawer']>>[0],
          ) {
            if (
              !featurePreparationRequestSchema.safeParse(input, { jitless: true }).success ||
              !activated()
            )
              return { status: 'denied' as const };
            if (busy) return { status: 'busy' as const };
            busy = true;
            try {
              const reply = featurePreparationReplySchema.safeParse(await showPreparation(input), {
                jitless: true,
              });
              return reply.success ? reply.data : { status: 'unavailable' as const };
            } catch {
              return { status: 'unavailable' as const };
            } finally {
              busy = false;
            }
          },
        }
      : {}),
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
