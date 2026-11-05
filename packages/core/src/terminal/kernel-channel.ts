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
export const kernelLivenessReplySchema = z.strictObject({
  kind: z.literal('kernel-liveness-reply'),
  id: z.uuid(),
  exists: z.boolean().nullable(),
});
export const kernelLivenessQuerySchema = z.strictObject({
  kind: z.literal('kernel-liveness-query'),
  id: z.uuid(),
  identity: kernelProcessIdentitySchema,
});

/** Private native liveness answers; null and transport errors never prove absence. */
export function kernelLivenessClient(send: (query: object) => void) {
  const pending = new Map<
    string,
    {
      resolve(value: boolean): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let closed = false;
  return {
    query(identity: z.infer<typeof kernelProcessIdentitySchema>) {
      if (closed || pending.size >= 16) return Promise.reject(new Error('Kernel liveness budget'));
      const id = randomUUID();
      return new Promise<boolean>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Kernel liveness unconfirmed'));
        }, 5000);
        pending.set(id, { resolve, reject, timer });
        try {
          send({ kind: 'kernel-liveness-query', id, identity });
        } catch {
          clearTimeout(timer);
          pending.delete(id);
          reject(new Error('Kernel liveness unavailable'));
        }
      });
    },
    accept(raw: unknown) {
      const value = kernelLivenessReplySchema.safeParse(raw);
      if (!value.success) return false;
      const item = pending.get(value.data.id);
      if (!item) return false;
      pending.delete(value.data.id);
      clearTimeout(item.timer);
      if (value.data.exists === null) item.reject(new Error('Kernel liveness unavailable'));
      else item.resolve(value.data.exists);
      return true;
    },
    close() {
      closed = true;
      for (const value of pending.values()) {
        clearTimeout(value.timer);
        value.reject(new Error('Kernel liveness closed'));
      }
      pending.clear();
    },
  };
}

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
