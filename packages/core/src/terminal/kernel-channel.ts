import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { kernelProcessIdentitySchema } from '../managed-codex/kernel-lifecycle-receipt.js';

export const kernelIdentityQuerySchema = z.strictObject({
  kind: z.literal('kernel-identity-query'),
  id: z.uuid(),
  pid: z.number().int().positive().max(2_147_483_647),
});
export const kernelIdentityReplySchema = z.discriminatedUnion('ok', [
  z.strictObject({
    kind: z.literal('kernel-identity-reply'),
    id: z.uuid(),
    ok: z.literal(true),
    identity: kernelProcessIdentitySchema,
  }),
  z.strictObject({ kind: z.literal('kernel-identity-reply'), id: z.uuid(), ok: z.literal(false) }),
]);

/** Only the inherited Core transport may submit or fulfill these queries. */
export function kernelIdentityClient(
  send: (query: z.infer<typeof kernelIdentityQuerySchema>) => void,
) {
  const pending = new Map<
    string,
    {
      pid: number;
      resolve: (value: z.infer<typeof kernelProcessIdentitySchema>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let closed = false;
  return {
    query(pid: number) {
      return new Promise<z.infer<typeof kernelProcessIdentitySchema>>((resolve, reject) => {
        if (closed || pending.size >= 16) return reject(new Error('Kernel identity unavailable'));
        const query = kernelIdentityQuerySchema.parse({
          kind: 'kernel-identity-query',
          id: randomUUID(),
          pid,
        });
        const timer = setTimeout(() => {
          pending.delete(query.id);
          reject(new Error('Kernel identity unconfirmed'));
        }, 5000);
        pending.set(query.id, { pid, resolve, reject, timer });
        try {
          send(query);
        } catch {
          clearTimeout(timer);
          pending.delete(query.id);
          reject(new Error('Kernel identity transport unavailable'));
        }
      });
    },
    accept(raw: unknown) {
      const result = kernelIdentityReplySchema.safeParse(raw);
      if (!result.success) return false;
      const request = pending.get(result.data.id);
      if (!request) return false;
      pending.delete(result.data.id);
      clearTimeout(request.timer);
      if (!result.data.ok || result.data.identity.pid !== request.pid)
        request.reject(new Error('Kernel identity unavailable'));
      else request.resolve(result.data.identity);
      return true;
    },
    close() {
      closed = true;
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Kernel identity transport closed'));
      }
      pending.clear();
    },
  };
}
