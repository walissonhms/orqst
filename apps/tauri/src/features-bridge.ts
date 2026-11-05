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
  allowArrangement = false,
): DesktopFeatures {
  let busy = false;
  let arrangement:
    | {
        input: Extract<Parameters<DesktopFeatures['request']>[0], { action: 'arrange' }>;
        attempts: number;
        resolve: (
          reply:
            | { status: 'busy' | 'unavailable' | 'denied' }
            | Awaited<ReturnType<DesktopFeatures['request']>>,
        ) => void;
      }
    | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = 0;
  const schedule = () => {
    if (timer || !arrangement) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        if (!arrangement) return;
        if (busy) {
          schedule();
          return;
        }
        const current = arrangement;
        arrangement = undefined;
        busy = true;
        last = Date.now();
        void Promise.resolve()
          .then(() => invoke(current.input))
          .then(
            (value) => {
              const result = featureNativeReplySchema.safeParse(value, { jitless: true });
              if (
                result.success &&
                result.data.status === 'busy' &&
                !arrangement &&
                current.attempts < 2
              ) {
                current.attempts++;
                arrangement = current;
              } else current.resolve(result.success ? result.data : { status: 'unavailable' });
            },
            () => current.resolve({ status: 'unavailable' }),
          )
          .finally(() => {
            busy = false;
            schedule();
          });
      },
      Math.max(1, 17 - (Date.now() - last)),
    );
  };
  return Object.freeze({
    contractVersion: 1 as const,
    ...(allowArrangement
      ? {
          async arrange(
            input: Extract<Parameters<DesktopFeatures['request']>[0], { action: 'arrange' }>,
          ) {
            if (!featureNativeRequestSchema.safeParse(input, { jitless: true }).success)
              return { status: 'denied' as const };
            return new Promise(
              (resolve: (reply: Awaited<ReturnType<DesktopFeatures['request']>>) => void) => {
                arrangement?.resolve({ status: 'busy' });
                arrangement = { input, resolve, attempts: 0 };
                schedule();
              },
            );
          },
        }
      : {}),
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
