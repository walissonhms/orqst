import { z } from 'zod';
import { featureScopeSchema } from './features.js';
import { TERMINAL_SLOT_CEILING } from './terminal-capacity.js';

export const featurePermissionOperationSchema = z.enum(['delegate', 'execute', 'view']);
export type FeaturePermissionOperation = z.infer<typeof featurePermissionOperationSchema>;
export const featurePermissionRuleSchema = z.strictObject({
  sourceTerminalId: z.uuid(),
  targetTerminalId: z.uuid(),
  operations: z.array(featurePermissionOperationSchema).max(3),
});
export const featurePermissionConfigurationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    rules: z
      .array(featurePermissionRuleSchema)
      .max(TERMINAL_SLOT_CEILING * (TERMINAL_SLOT_CEILING - 1)),
  })
  .superRefine(({ rules }, ctx) => {
    const pairs = new Set<string>();
    const graph = new Map<string, string[]>();
    let invalid = false;
    for (const rule of rules) {
      const key = `${rule.sourceTerminalId}:${rule.targetTerminalId}`;
      if (
        pairs.has(key) ||
        rule.sourceTerminalId === rule.targetTerminalId ||
        new Set(rule.operations).size !== rule.operations.length
      )
        invalid = true;
      pairs.add(key);
      if (rule.operations.includes('delegate')) {
        const targets = graph.get(rule.sourceTerminalId) ?? [];
        targets.push(rule.targetTerminalId);
        graph.set(rule.sourceTerminalId, targets);
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const cycle = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      if ((graph.get(id) ?? []).some(cycle)) return true;
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    if (invalid || [...graph.keys()].some(cycle))
      ctx.addIssue({ code: 'custom', message: 'Invalid directed Feature permission policy' });
  });
export type FeaturePermissionConfiguration = z.infer<typeof featurePermissionConfigurationSchema>;
export const featurePermissionStateSchema = featureScopeSchema
  .extend({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative().safe(),
    configuration: featurePermissionConfigurationSchema.nullable(),
  })
  .refine(
    (state) => (state.revision === 0) === (state.configuration === null),
    'Invalid Feature permission revision',
  );
export type FeaturePermissionState = z.infer<typeof featurePermissionStateSchema>;
export const featurePermissionSaveSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative().safe(),
  configuration: featurePermissionConfigurationSchema,
});
export type FeaturePermissionSave = z.infer<typeof featurePermissionSaveSchema>;
export const featurePermissionEventSchema = featureScopeSchema
  .extend({
    schemaVersion: z.literal(1),
    sequence: z.number().int().positive().safe(),
    timestamp: z.number().int().nonnegative().safe(),
    actorId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    action: z.literal('feature.permissions.updated'),
    previousRevision: z.number().int().nonnegative().safe(),
    revision: z.number().int().positive().safe(),
    previousConfiguration: featurePermissionConfigurationSchema.nullable(),
    configuration: featurePermissionConfigurationSchema,
  })
  .refine(
    (event) =>
      event.revision === event.previousRevision + 1 &&
      (event.previousRevision === 0) === (event.previousConfiguration === null),
    'Invalid Feature permission audit revision',
  );
