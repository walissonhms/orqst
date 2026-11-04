import { z } from 'zod';

// Navigation metadata only. Historical/path-like identities remain category-only alerts.
export const desktopNotificationSessionIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9:_-]+$/);

export const desktopNotificationAlertSchema = z.strictObject({
  category: z.enum(['completed', 'failed', 'intervention']),
  silent: z.boolean(),
  sessionId: desktopNotificationSessionIdSchema.optional(),
});

export const desktopNotificationSelectionSchema = z.strictObject({
  sessionId: desktopNotificationSessionIdSchema,
});

export const desktopNotificationFrameSchema = z.strictObject({
  connected: z.literal(true),
  pending: z.number().int().min(0).max(200),
  alerts: z.array(desktopNotificationAlertSchema).max(3),
});
