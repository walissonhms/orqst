import { terminalDisplayId } from './terminal-display.js';
import {
  communicationAuditSchema,
  ownedTurnAlertSchema,
  type FeatureNativeReply,
  type FeatureNativeSnapshot,
} from '@orqst/protocol';
import { z } from 'zod';
import { expiredWindow, type LimitCaps } from './account-limits-model';

export const liveAlertMs = 10_000;
const maxHistory = 200;
const maxSeen = 1000;

const kinds = [
  'completed',
  'failed',
  'waiting_for_user',
  'delivery_failed',
  'recipient_ended',
  'limit_threshold',
] as const;

const terminalTarget = z.strictObject({
  featureId: z.uuid().nullable(),
  terminalId: z.uuid(),
  label: z.string().regex(/^T-[0-9]{3,}$/),
  featureName: z.string().max(512).nullable(),
});

const alertSchema = z.strictObject({
  id: z.string().min(1).max(260),
  kind: z.enum(kinds),
  at: z.number().int().nonnegative().max(8_640_000_000_000_000),
  read: z.boolean(),
  target: terminalTarget.optional(),
  provider: z.enum(['codex', 'claude', 'opencode', 'antigravity']).optional(),
});

export type StudioAlert = z.infer<typeof alertSchema>;
export type StudioAlertKind = StudioAlert['kind'];

const historySchema = z.strictObject({
  items: z.array(alertSchema).max(maxHistory),
  seen: z.array(alertSchema.shape.id).max(maxSeen),
});
export type StudioAlertHistory = z.infer<typeof historySchema>;

export function parseAlertHistory(raw: unknown): StudioAlertHistory {
  const result = historySchema.safeParse(raw);
  return result.success ? result.data : { items: [], seen: [] };
}

export function addAlerts(
  history: StudioAlertHistory,
  incoming: StudioAlert[],
  now: number,
): StudioAlertHistory {
  const seen = new Set(history.seen);
  const ids = new Set(history.items.map(({ id }) => id));
  const items = [...history.items];
  for (const item of incoming) {
    if (!isLive(item.at, now) || seen.has(item.id) || ids.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  if (items.length === history.items.length) return history;
  return {
    items: items.sort((a, b) => b.at - a.at).slice(0, maxHistory),
    seen: Array.from(seen).slice(-maxSeen),
  };
}

function isLive(at: number, now: number) {
  return at <= now && now - at <= liveAlertMs;
}

/** Match the persisted Feature and UUID first. A reused display number grants no access. */
export function focusTarget(
  snapshot: FeatureNativeSnapshot | undefined,
  featureId: string | null,
  terminalId: string,
) {
  const slot = snapshot?.slots.find((entry) => entry.terminalId === terminalId && !entry.closed);
  if (!slot || !snapshot) return undefined;
  const owner = snapshot.features.find((feature) => feature.terminalIds.includes(terminalId));
  return (owner?.featureId ?? null) === featureId && owner?.status !== 'archived'
    ? slot
    : undefined;
}

function target(
  snapshot: FeatureNativeSnapshot,
  terminalId: string,
  featureId: string | null,
): StudioAlert['target'] {
  const slot = snapshot.slots.find((entry) => entry.terminalId === terminalId);
  const feature = snapshot.features.find((entry) => entry.terminalIds.includes(terminalId));
  const label = terminalDisplayId(feature, terminalId, slot?.slot);
  if (!label || (feature?.featureId ?? null) !== featureId) return undefined;
  return {
    featureId,
    terminalId,
    featureName: feature?.name ?? null,
    label,
  };
}

export function ownedTurnNotification(
  raw: unknown,
  snapshot: FeatureNativeSnapshot,
  now: number,
): StudioAlert | undefined {
  const parsed = ownedTurnAlertSchema.safeParse(raw);
  if (!parsed.success) return;
  const { category, terminalId, turnId, observedAt, slot } = parsed.data;
  if (
    category === 'completed' ||
    !isLive(observedAt, now) ||
    !snapshot.slots.some(
      (entry) => entry.terminalId === terminalId && entry.slot === slot && !entry.closed,
    )
  )
    return;
  const featureId =
    snapshot.features.find((feature) => feature.terminalIds.includes(terminalId))?.featureId ??
    null;
  const route = target(snapshot, terminalId, featureId);
  if (route)
    return {
      id: `turn:${terminalId}:${turnId}:${category}`,
      kind: category,
      target: route,
      at: observedAt,
      read: false,
    };
}

/** Only the signed pair broker's accepted submit_result reaches this projection. */
export function confirmedResults(
  communication: FeatureNativeReply['communication'],
  snapshot: FeatureNativeSnapshot,
  after: number,
  now: number,
): StudioAlert[] {
  return (communication?.events ?? []).flatMap((event) => {
    if (event.kind !== 'result' || event.at <= after || !isLive(event.at, now)) return [];
    const route = target(snapshot, event.from, snapshot.activeFeatureId);
    return route
      ? [{ id: `result:${event.id}`, kind: 'completed', target: route, at: event.at, read: false }]
      : [];
  });
}

/** Adapter for L4's live, Core-validated communication audit. */
export function communicationNotification(
  raw: unknown,
  snapshot: FeatureNativeSnapshot,
  now: number,
): StudioAlert | undefined {
  const parsed = communicationAuditSchema.safeParse(raw);
  if (!parsed.success) return;
  const { action, timestamp, workspaceId, featureId, paneId, messageId, deliveryState, taskState } =
    parsed.data;
  if (
    action !== 'state_changed' ||
    workspaceId !== snapshot.workspace.id ||
    !featureId ||
    !messageId ||
    !isLive(timestamp, now)
  )
    return;
  const route = target(snapshot, paneId, featureId);
  if (!route) return;
  const kind =
    deliveryState === 'delivery_failed'
      ? 'delivery_failed'
      : deliveryState === 'target_closed'
        ? 'recipient_ended'
        : taskState === 'completed'
          ? 'completed'
          : taskState === 'failed'
            ? 'failed'
            : taskState === 'waiting_approval'
              ? 'waiting_for_user'
              : undefined;
  if (kind)
    return { id: `message:${messageId}:${kind}`, kind, target: route, at: timestamp, read: false };
}

export function limitThresholds(
  previous: NonNullable<FeatureNativeReply['accountLimits']>,
  current: NonNullable<FeatureNativeReply['accountLimits']>,
  caps: LimitCaps,
  now: number,
): StudioAlert[] {
  if (!isLive(current.readAt, now) || previous.readAt >= current.readAt) return [];
  return current.accounts.flatMap((account) => {
    const prior = previous.accounts.find(
      (entry) => entry.id === account.id && entry.provider === account.provider,
    );
    const at = account.updatedAt;
    if (
      !prior ||
      at === undefined ||
      prior.updatedAt === undefined ||
      at <= prior.updatedAt ||
      !isLive(at, now)
    )
      return [];
    return account.windows.flatMap((window) => {
      const old = prior.windows.find((entry) => entry.id === window.id);
      if (
        old?.usedPercent === undefined ||
        window.usedPercent === undefined ||
        window.resetsAt === undefined ||
        old.resetsAt !== window.resetsAt ||
        expiredWindow(window, now)
      )
        return [];
      const threshold = window.usedPercent >= caps.critical ? caps.critical : caps.warn;
      return old.usedPercent < threshold && window.usedPercent >= threshold
        ? [
            {
              id: `limit:${account.id}:${window.id}:${window.resetsAt}:${threshold}`,
              kind: 'limit_threshold',
              provider: account.provider,
              at,
              read: false,
            },
          ]
        : [];
    });
  });
}
