import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { terminalDigest } from '../../../packages/core/src/terminal/authority.js';

// Administrative-only budgets. Ordinary preparation retains its existing 16 KiB detail cap.
export const ADMIN_REVIEW_BYTES = 64 * 1024;
export const ADMIN_FRAME_BYTES = 128 * 1024;
export const ADMIN_SESSION_BYTES = 512 * 1024;
export const administrativeActionSchema = z.enum([
  'install',
  'capture',
  'continueCapture',
  'release',
  'continueRelease',
  'finalize',
  'abort',
]);
export type AdministrativeAction = z.infer<typeof administrativeActionSchema>;
export const administrativeRequestSchema = z.strictObject({
  kind: z.literal('action'),
  id: z.number().int().positive().safe(),
  session: z.uuid(),
  action: administrativeActionSchema,
  bundle: z.string().startsWith('/').max(2048).nullable(),
});
const answerSchema = z.strictObject({
  kind: z.literal('answer'),
  session: z.uuid(),
  id: z.uuid(),
  nonce: z.uuid(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  approved: z.boolean(),
});

/** One owned pipe, one pending review, no queued/old ACK or inherited consent. */
export class AdministrativeReviewPipe {
  readonly session = randomUUID();
  private live = true;
  private bytes = 0;
  private pending?: {
    id: string;
    nonce: string;
    digest: string;
    expires: number;
    timer: ReturnType<typeof setTimeout>;
    resolve(value: boolean): void;
  };
  constructor(
    private readonly send: (value: object) => void,
    private readonly now = () => performance.now(),
  ) {}
  current = () => this.live;
  close() {
    this.live = false;
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending?.resolve(false);
    this.pending = undefined;
  }
  review(action: AdministrativeAction, detail: string, binding: string): Promise<boolean> {
    // Preserve every character visibly; bidi/format controls cannot spoof a native path or record.
    detail = detail.replace(
      /\p{Cf}/gu,
      (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`,
    );
    if (!this.live || this.pending || Buffer.byteLength(detail) > ADMIN_REVIEW_BYTES)
      throw new Error('Administrative review unavailable');
    const id = randomUUID(),
      nonce = randomUUID();
    const digest = terminalDigest(
      JSON.stringify([this.session, id, nonce, action, binding, detail]),
    );
    const frame = {
      kind: 'review',
      session: this.session,
      id,
      nonce,
      digest,
      action,
      binding,
      detail,
    };
    this.bytes += Buffer.byteLength(JSON.stringify(frame)) + 1;
    if (
      Buffer.byteLength(JSON.stringify(frame)) > ADMIN_FRAME_BYTES ||
      this.bytes > ADMIN_SESSION_BYTES
    )
      throw new Error('Administrative wire budget');
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.pending = undefined;
        resolve(false);
      }, 30_000);
      timer.unref();
      this.pending = { id, nonce, digest, expires: this.now() + 30_000, resolve, timer };
      this.send(frame);
    });
  }
  answer(value: unknown) {
    const result = answerSchema.safeParse(value);
    const pending = this.pending;
    if (
      !this.live ||
      !result.success ||
      !pending ||
      result.data.session !== this.session ||
      result.data.id !== pending.id ||
      result.data.nonce !== pending.nonce ||
      result.data.digest !== pending.digest
    ) {
      this.close();
      return;
    }
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.resolve(result.data.approved && this.now() < pending.expires);
  }
}
