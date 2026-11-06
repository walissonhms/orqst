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
  /** Diagnostics only: why a request stopped here, before reaching native code. */
  note: (code: string) => void = () => {},
): DesktopFeatures {
  let busy = false;
  // The New terminal dialog has its own latch: a slow snapshot poll must not refuse it.
  let preparing = false;
  let busyAction = '';
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
        if (busy || preparing) {
          schedule();
          return;
        }
        const current = arrangement;
        arrangement = undefined;
        busy = true;
        busyAction = 'arrange';
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
            if (!featurePreparationRequestSchema.safeParse(input, { jitless: true }).success) {
              note('bridge:prepare:invalid');
              return { status: 'denied' as const };
            }
            if (!activated()) {
              note('bridge:prepare:inactive');
              return { status: 'denied' as const };
            }
            // Serialized with metadata, except a background snapshot read: it never edits,
            // so it must not refuse the owner's click.
            if (preparing || (busy && busyAction !== 'snapshot')) {
              note('bridge:prepare:busy');
              return { status: 'busy' as const };
            }
            preparing = true;
            try {
              const reply = featurePreparationReplySchema.safeParse(await showPreparation(input), {
                jitless: true,
              });
              if (!reply.success) note('bridge:prepare:reply-invalid');
              return reply.success ? reply.data : { status: 'unavailable' as const };
            } catch {
              note('bridge:prepare:invoke-failed');
              return { status: 'unavailable' as const };
            } finally {
              preparing = false;
            }
          },
        }
      : {}),
    async request(input: Parameters<DesktopFeatures['request']>[0]) {
      if (!featureNativeRequestSchema.safeParse(input, { jitless: true }).success)
        return { status: 'denied' as const };
      if (input.action !== 'snapshot' && !activated()) {
        note(`bridge:${input.action.toLowerCase()}:inactive`);
        return { status: 'denied' as const };
      }
      if (busy || preparing) {
        if (input.action !== 'snapshot') note(`bridge:${input.action.toLowerCase()}:busy`);
        return { status: 'busy' as const };
      }
      busy = true;
      busyAction = input.action;
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
