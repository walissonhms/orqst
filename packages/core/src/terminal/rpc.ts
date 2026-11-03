import { z } from 'zod';

const id = z.string().uuid();
const proof = z.strictObject({ challengeId: id, signature: z.string().min(1).max(128) });
const number = z.number().int().nonnegative().safe();
const signal = z.enum(['SIGTERM', 'SIGKILL']);
export const terminalRPCOutputSchema = z.strictObject({
  bytes: z.array(z.number().int().min(0).max(255)).max(64 * 1024),
  nextCursor: number,
  gap: z.boolean(),
});
const action = <Name extends string, Args extends z.ZodType>(operation: Name, args: Args) =>
  z.strictObject({ id, operation: z.literal(operation), args });
const client = z.literal('desktop-managed');
const text = z
  .string()
  .min(1)
  .max(16 * 1024);

/** Private inherited transport, never HTTP or renderer IPC. Only existing supervisor operations. */
export const terminalRPCSchema = z.discriminatedUnion('operation', [
  action('prepare', z.tuple([client, z.enum(['codex-login-v1', 'codex-terminal-v1'])])),
  action('launch', z.tuple([id, proof])),
  action('snapshot', z.tuple([id])),
  action('requestAttach', z.tuple([client, id])),
  action('attach', z.tuple([id, proof])),
  action('requestInput', z.tuple([id, id])),
  action('enableInput', z.tuple([id, id, proof])),
  action('requestPaste', z.tuple([id, id, id, number, text])),
  action('paste', z.tuple([id, id, id, number, text, proof])),
  action('requestStop', z.tuple([client, id, signal])),
  action('stop', z.tuple([id, signal, proof])),
  action('write', z.tuple([id, id, id, number, z.string().min(1).max(4096)])),
  action(
    'resize',
    z.tuple([id, id, z.number().int().min(20).max(300), z.number().int().min(5).max(100)]),
  ),
  action('read', z.tuple([id, id, number])),
  action('detach', z.tuple([id, id])),
  action('revokeInput', z.tuple([id, id])),
]);
export const terminalRPCReplySchema = z.union([
  z.strictObject({ id, ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ id, ok: z.literal(false) }),
]);

/** Private Node pair transport. Renderer requests never select this slot or carry proofs. */
export const terminalPairRPCSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('terminal'),
    slot: z.number().int().min(0).max(1),
    request: terminalRPCSchema,
  }),
  z.strictObject({ kind: z.literal('closeSlot'), id, slot: z.number().int().min(0).max(1) }),
  z.strictObject({ kind: z.literal('prepareRetire'), id }),
  z.strictObject({ kind: z.literal('retire'), id, proof }),
  z.strictObject({ kind: z.literal('prepareMcp'), id }),
  z.strictObject({ kind: z.literal('authorizeMcp'), id, proof }),
]);

export const terminalPairReadySchema = z.strictObject({
  type: z.literal('ready'),
  epoch: id,
  identities: z
    .array(
      z.strictObject({
        slot: z.number().int().min(0).max(1),
        terminalId: id,
        provider: z.literal('codex'),
      }),
    )
    .min(1)
    .max(2),
});
