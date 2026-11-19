import { z } from 'zod';
import { terminalDisplayNameSchema } from './terminal-workspace.js';
import { TERMINAL_SLOT_CEILING, terminalDisplayIdSchema } from './terminal-capacity.js';

export const featureScopeSchema = z.strictObject({
  workspaceId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  featureId: z.uuid(),
});
export type FeatureScope = z.infer<typeof featureScopeSchema>;
export const featureStatusSchema = z.enum([
  'planned',
  'active',
  'blocked',
  'completed',
  'archived',
]);
export type FeatureStatus = z.infer<typeof featureStatusSchema>;
export const featureCreateSchema = z.strictObject({
  workspaceId: featureScopeSchema.shape.workspaceId,
  name: terminalDisplayNameSchema,
  description: z.string().max(2048).default(''),
  status: featureStatusSchema.default('planned'),
});
export const featureUpdateSchema = z
  .strictObject({
    expectedRevision: z.number().int().positive().safe(),
    name: terminalDisplayNameSchema.optional(),
    description: z.string().max(2048).optional(),
    status: featureStatusSchema.optional(),
    orchestratorTerminalId: z.uuid().nullable().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.status !== undefined ||
      value.orchestratorTerminalId !== undefined,
    'Feature update is empty',
  );
export type FeatureCreate = z.input<typeof featureCreateSchema>;
export type FeatureUpdate = z.infer<typeof featureUpdateSchema>;
export const featureTerminalDisplaySchema = z.strictObject({
  terminalId: z.uuid(),
  displayId: terminalDisplayIdSchema,
  released: z.literal(true).optional(),
  name: terminalDisplayNameSchema.optional(),
  provider: z.enum(['codex', 'claude', 'opencode', 'antigravity']).optional(),
  activeReservation: z.literal(true).optional(),
});
export type FeatureTerminalDisplay = z.infer<typeof featureTerminalDisplaySchema>;

export const workspaceFeatureSchema = featureScopeSchema
  .extend({
    schemaVersion: z.literal(1),
    name: terminalDisplayNameSchema,
    description: z.string().max(2048),
    status: featureStatusSchema,
    revision: z.number().int().positive().safe(),
    terminalIds: z
      .array(z.uuid())
      .max(TERMINAL_SLOT_CEILING)
      .refine((ids) => new Set(ids).size === ids.length),
    terminalDisplays: z.array(featureTerminalDisplaySchema).max(TERMINAL_SLOT_CEILING).optional(),
    orchestratorTerminalId: z.uuid().nullable().optional(),
    createdAt: z.number().int().nonnegative().safe(),
    updatedAt: z.number().int().nonnegative().safe(),
  })
  .refine(
    (feature) =>
      (!feature.orchestratorTerminalId ||
        feature.terminalIds.includes(feature.orchestratorTerminalId)) &&
      (!feature.terminalDisplays ||
        (feature.terminalDisplays.length === feature.terminalIds.length &&
          feature.terminalDisplays.every(
            ({ terminalId }, index) => terminalId === feature.terminalIds[index],
          ) &&
          new Set(feature.terminalDisplays.map(({ displayId }) => displayId)).size ===
            feature.terminalDisplays.length)),
  );
export type WorkspaceFeature = z.infer<typeof workspaceFeatureSchema>;
export const featureConfigurationEventSchema = featureScopeSchema.extend({
  schemaVersion: z.literal(1),
  sequence: z.number().int().positive().safe(),
  action: z.enum([
    'feature.created',
    'feature.updated',
    'feature.archived',
    'feature.terminal_added',
    'feature.terminal_reopened',
    'feature.terminal_removed',
  ]),
  revision: z.number().int().positive().safe(),
  timestamp: z.number().int().nonnegative().safe(),
  terminalId: z.uuid().nullable(),
});

/** Persisted visual context only; never a runtime activation or an authorization grant. */
export const featureViewStateSchema = z.strictObject({
  contractVersion: z.literal(1),
  storage: z.literal('core'),
  workspaceId: featureScopeSchema.shape.workspaceId,
  featureId: z.uuid().nullable(),
  revision: z.number().int().nonnegative().safe(),
});
export type FeatureViewState = z.infer<typeof featureViewStateSchema>;
export const featureViewSaveSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative().safe(),
  featureId: z.uuid().nullable(),
});

export const DEFAULT_FEATURE_NAME = 'General' as const;
const DEFAULT_FEATURE_LOCALIZED_NAMES: ReadonlySet<string> = new Set(['General', 'Geral']);

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256First16Bytes(input: string): Uint8Array {
  const raw = new TextEncoder().encode(input);
  const paddedLength = (raw.length + 9 + 63) & ~63;
  const padded = new Uint8Array(paddedLength);
  padded.set(raw);
  padded[raw.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, raw.length * 8, false);
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Uint32Array(64);
  const rotr = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index++) w[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index++) {
      const s0 = rotr(w[index - 15]!, 7) ^ rotr(w[index - 15]!, 18) ^ (w[index - 15]! >>> 3);
      const s1 = rotr(w[index - 2]!, 17) ^ rotr(w[index - 2]!, 19) ^ (w[index - 2]! >>> 10);
      w[index] = (w[index - 16]! + s0 + w[index - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let index = 0; index < 64; index++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + SHA256_K[index]! + w[index]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  for (let index = 0; index < 4; index++) outView.setUint32(index * 4, h[index]!, false);
  return out;
}

/** Stable per-workspace default Feature UUID (RFC 9562 v8), independent of localized/edited title. */
export function defaultFeatureId(workspaceId: string): string {
  featureScopeSchema.shape.workspaceId.parse(workspaceId);
  const bytes = sha256First16Bytes(JSON.stringify(['default-feature', workspaceId]));
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Localize the default Feature's initial title ("General" / "Geral") while preserving user renames. */
export function featureDisplayName(
  feature: Pick<WorkspaceFeature, 'workspaceId' | 'featureId' | 'name'>,
  localizedDefaultName: string,
): string {
  return feature.featureId === defaultFeatureId(feature.workspaceId) &&
    DEFAULT_FEATURE_LOCALIZED_NAMES.has(feature.name)
    ? localizedDefaultName
    : feature.name;
}
