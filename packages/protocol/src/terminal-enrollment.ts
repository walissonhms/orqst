import { z } from 'zod';
import { TERMINAL_SLOT_CEILING, terminalSlotLimitSchema } from './terminal-capacity.js';

const revision = z.number().int().nonnegative().safe();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const terminalEnrollmentInputSchema = z.strictObject({
  version: z.literal(1),
  epoch: z.uuid(),
  opId: z.uuid(),
  expectedRevision: revision,
  workspaceId: digest,
  featureId: z.uuid().nullable(),
});
export type TerminalEnrollmentInput = z.infer<typeof terminalEnrollmentInputSchema>;

/** Admission metadata only. No process, attachment or keyboard authority is conveyed. */
export const terminalEnrollmentMemberSchema = z.strictObject({
  slot: z
    .number()
    .int()
    .min(0)
    .max(TERMINAL_SLOT_CEILING - 1),
  terminalId: z.uuid(),
  alias: z.string().min(1).max(128).optional(),
  provider: z.enum(['codex', 'claude', 'opencode']),
  requestedModel: z.string().min(1).max(160).nullable().optional(),
  workspaceId: digest,
  featureId: z.uuid().nullable(),
  admissionRevision: revision,
  bindingDigest: digest,
  status: z.enum(['ready', 'uncertain']),
});
export type TerminalEnrollmentMember = z.infer<typeof terminalEnrollmentMemberSchema>;
export const terminalEnrollmentReceiptSchema = z
  .strictObject({
    ...terminalEnrollmentInputSchema.shape,
    revision,
    status: z.enum(['ready', 'rejected', 'uncertain']),
    reason: z.enum([
      'admitted',
      'revision_conflict',
      'capacity',
      'invalid_profile',
      'effect_uncertain',
    ]),
    member: terminalEnrollmentMemberSchema.nullable(),
  })
  .superRefine((receipt, context) => {
    if (receipt.status === 'rejected') {
      if (receipt.member !== null || receipt.reason === 'admitted')
        context.addIssue({
          code: 'custom',
          message: 'Rejected enrollment cannot convey admission',
        });
      return;
    }
    const member = receipt.member;
    if (
      !member ||
      member.status !== receipt.status ||
      receipt.revision !== receipt.expectedRevision + 1 ||
      member.admissionRevision !== receipt.revision ||
      member.workspaceId !== receipt.workspaceId ||
      member.featureId !== receipt.featureId ||
      receipt.reason !== (receipt.status === 'ready' ? 'admitted' : 'effect_uncertain')
    )
      context.addIssue({ code: 'custom', message: 'Enrollment receipt binding changed' });
  });
export type TerminalEnrollmentReceipt = z.infer<typeof terminalEnrollmentReceiptSchema>;
export const terminalEnrollmentInspectionSchema = z
  .strictObject({
    version: z.literal(1),
    epoch: z.uuid(),
    revision,
    capacity: terminalSlotLimitSchema,
    reservedSlots: z.number().int().min(1).max(TERMINAL_SLOT_CEILING),
    members: z.array(terminalEnrollmentMemberSchema).min(1).max(TERMINAL_SLOT_CEILING),
    receipt: terminalEnrollmentReceiptSchema.nullable(),
  })
  .superRefine((inspection, context) => {
    if (
      inspection.reservedSlots !== inspection.members.length ||
      inspection.reservedSlots > inspection.capacity ||
      inspection.members.some(
        (member, index) => member.slot !== index || member.admissionRevision > inspection.revision,
      ) ||
      (inspection.receipt &&
        (inspection.receipt.epoch !== inspection.epoch ||
          inspection.receipt.revision > inspection.revision))
    )
      context.addIssue({ code: 'custom', message: 'Enrollment inspection continuity changed' });
  });
export type TerminalEnrollmentInspection = z.infer<typeof terminalEnrollmentInspectionSchema>;
