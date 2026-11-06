import {
  terminalLayoutRecordSchema,
  featureCreateSchema,
  featureViewSaveSchema,
  featureUpdateSchema,
  featurePermissionSaveSchema,
  terminalTeamSaveSchema,
  TERMINAL_SLOT_CEILING,
  terminalEnrollmentInputSchema,
  composerMentionInputSchema,
} from '@orqst/protocol';
import { z } from 'zod';
import { terminalStartupIdSchema } from './startup-failure.js';

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
  action(
    'prepare',
    z.tuple([
      client,
      z.enum(['codex-login-v1', 'codex-terminal-v1', 'claude-terminal-v1', 'opencode-terminal-v1']),
    ]),
  ),
  action('launch', z.tuple([id, proof])),
  action('snapshot', z.tuple([id])),
  action('canvasSessionEvidence', z.tuple([id])),
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
  z.strictObject({ kind: z.literal('enrollmentInspect'), id, opId: id.optional() }),
  z.strictObject({
    kind: z.literal('enroll'),
    id,
    input: terminalEnrollmentInputSchema,
    // Private inherited IPC only. This path never comes from a renderer payload.
    manifestFile: z
      .string()
      .startsWith('/')
      .max(2048)
      .refine((value) => !value.includes('\0')),
  }),
  z.strictObject({
    kind: z.literal('terminal'),
    slot: z
      .number()
      .int()
      .min(0)
      .max(TERMINAL_SLOT_CEILING - 1),
    request: terminalRPCSchema,
  }),
  z.strictObject({
    kind: z.literal('closeSlot'),
    id,
    slot: z
      .number()
      .int()
      .min(0)
      .max(TERMINAL_SLOT_CEILING - 1),
  }),
  z.strictObject({ kind: z.literal('featureViewRead'), id }),
  z.strictObject({ kind: z.literal('featureViewSave'), id, input: featureViewSaveSchema }),
  z.strictObject({ kind: z.literal('featureList'), id }),
  z.strictObject({ kind: z.literal('communicationProjection'), id, featureId: id.nullable() }),
  z.strictObject({
    kind: z.literal('composerMention'),
    id,
    featureId: id.nullable(),
    input: composerMentionInputSchema,
  }),
  z.strictObject({ kind: z.literal('featureRead'), id, featureId: id }),
  z.strictObject({
    kind: z.literal('featureCreate'),
    id,
    input: featureCreateSchema.omit({ workspaceId: true }),
  }),
  z.strictObject({
    kind: z.literal('featureUpdate'),
    id,
    featureId: id,
    input: featureUpdateSchema,
  }),
  z.strictObject({
    kind: z.literal('featureAssign'),
    id,
    featureId: id,
    slot: z
      .number()
      .int()
      .min(0)
      .max(TERMINAL_SLOT_CEILING - 1),
    expectedRevision: z.number().int().positive().safe(),
  }),
  z.strictObject({ kind: z.literal('featurePermissionsRead'), id, featureId: id }),
  z.strictObject({
    kind: z.literal('featurePermissionsSave'),
    id,
    featureId: id,
    actorId: z.string().min(1).max(128),
    input: featurePermissionSaveSchema,
  }),
  z.strictObject({ kind: z.literal('featureTeamRead'), id, featureId: id }),
  z.strictObject({
    kind: z.literal('featureTeamSave'),
    id,
    featureId: id,
    input: terminalTeamSaveSchema,
  }),
  z.strictObject({ kind: z.literal('featureLayoutRead'), id, featureId: id }),
  z.strictObject({
    kind: z.literal('featureLayoutSave'),
    id,
    featureId: id,
    record: terminalLayoutRecordSchema,
  }),
  z.strictObject({ kind: z.literal('teamRead'), id }),
  z.strictObject({ kind: z.literal('teamSave'), id, input: terminalTeamSaveSchema }),
  z.strictObject({ kind: z.literal('layoutRead'), id }),
  z.strictObject({ kind: z.literal('layoutSave'), id, record: terminalLayoutRecordSchema }),
  z.strictObject({ kind: z.literal('layoutImport'), id, record: terminalLayoutRecordSchema }),
  z.strictObject({ kind: z.literal('beginOwnedShutdown'), id }),
  z.strictObject({ kind: z.literal('preserveOwnedShutdown'), id }),
  z.strictObject({ kind: z.literal('prepareRetire'), id }),
  z.strictObject({ kind: z.literal('retire'), id, proof }),
  z.strictObject({ kind: z.literal('prepareMcp'), id }),
  z.strictObject({ kind: z.literal('authorizeMcp'), id, proof }),
]);

export const terminalPairReadySchema = z.strictObject({
  type: z.literal('ready'),
  pendingOwnedExits: z
    .array(
      z.strictObject({
        id: z.uuid(),
        code: z.literal('owned_exit_pending'),
        principalCount: z.number().int().positive().max(1024),
      }),
    )
    .max(64)
    .optional(),
  id: terminalStartupIdSchema,
  epoch: id,
  admissionOwner: id,
  initialFiles: z
    .array(
      z
        .string()
        .startsWith('/')
        .min(1)
        .max(2048)
        .refine((value) => !value.includes('\0')),
    )
    .min(1)
    .max(TERMINAL_SLOT_CEILING),
  identities: z
    .array(
      z.strictObject({
        slot: z
          .number()
          .int()
          .min(0)
          .max(TERMINAL_SLOT_CEILING - 1),
        terminalId: id,
        alias: z.string().min(1).max(128).optional(),
        provider: z.enum(['codex', 'claude', 'opencode']),
      }),
    )
    .min(1)
    .max(TERMINAL_SLOT_CEILING),
});
