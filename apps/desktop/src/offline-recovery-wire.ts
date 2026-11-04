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

const authorizationSchema = answerSchema.omit({ approved: true }).extend({
  kind: z.literal('authorized'),
  requestNonce: z.uuid(),
  proofDigest: z.string().regex(/^[a-f0-9]{64}$/),
  remainingMs: z.number().int().min(0).max(30_000),
});
/** One owned pipe, one pending review, no queued/old ACK or inherited consent. */
export class AdministrativeReviewPipe {
  readonly session = randomUUID();
  private live = true;
  private readonly sessionDeadline: number;
  private bytes = 0;
  private pending?: {
    id: string;
    nonce: string;
    digest: string;
    expires: number;
    timer: ReturnType<typeof setTimeout>;
    binding: string;
    resolve(value: boolean): void;
  };
  private signedChallenge?: string;
  private consent?: { id: string; nonce: string; digest: string; binding: string };
  private authorization?: {
    request: NonNullable<AdministrativeReviewPipe['consent']>;
    requestNonce: string;
    proofDigest: string;
    sentAt: number;
    timer: ReturnType<typeof setTimeout>;
    resolve(value: number | null): void;
  };
  constructor(
    private readonly send: (value: object) => void,
    private readonly now = () => performance.now(),
  ) {
    this.sessionDeadline = this.now() + 300_000;
  }
  current = () => this.live;
  close() {
    this.live = false;
    this.consent = undefined;
    if (this.authorization) clearTimeout(this.authorization.timer);
    this.authorization?.resolve(null);
    this.authorization = undefined;
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
    if (
      !this.live ||
      this.now() >= this.sessionDeadline ||
      this.pending ||
      this.authorization ||
      Buffer.byteLength(detail) > ADMIN_REVIEW_BYTES
    )
      throw new Error('Administrative review unavailable');
    this.consent = undefined;
    this.signedChallenge = undefined;
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
      const timer = setTimeout(
        () => {
          if (this.pending?.id !== id) return;
          this.pending = undefined;
          resolve(false);
        },
        Math.max(0, this.sessionDeadline - this.now()),
      );
      timer.unref();
      this.pending = { id, nonce, digest, binding, expires: this.sessionDeadline, resolve, timer };
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
    const accepted = result.data.approved && this.now() < pending.expires;
    if (accepted)
      this.consent = {
        id: pending.id,
        nonce: pending.nonce,
        digest: pending.digest,
        binding: pending.binding,
      };
    pending.resolve(accepted);
  }
  /** sign consumes permission once; check can only narrow the original native lease. */
  authorize(binding: string, challenge: string, check = false): Promise<number | null> {
    const consent = this.consent;
    if (
      !this.live ||
      this.now() >= this.sessionDeadline ||
      this.pending ||
      this.authorization ||
      !consent ||
      consent.binding !== binding
    ) {
      this.close();
      return Promise.resolve(null);
    }
    if (check ? this.signedChallenge !== challenge : this.signedChallenge !== undefined) {
      this.close();
      return Promise.resolve(null);
    }
    if (!check) this.signedChallenge = challenge;
    const requestNonce = randomUUID();
    const proofDigest = terminalDigest(
      JSON.stringify([
        this.session,
        consent.id,
        consent.nonce,
        consent.digest,
        binding,
        challenge,
        check,
        requestNonce,
      ]),
    );
    const frame = {
      kind: 'authorize',
      session: this.session,
      ...consent,
      challenge,
      proofDigest,
      check,
      requestNonce,
    };
    const line = JSON.stringify(frame);
    this.bytes += Buffer.byteLength(line) + 1;
    if (Buffer.byteLength(line) > ADMIN_FRAME_BYTES || this.bytes > ADMIN_SESSION_BYTES) {
      this.close();
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.close(), 30_000);
      timer.unref();
      this.authorization = {
        request: consent,
        requestNonce,
        proofDigest,
        sentAt: this.now(),
        timer,
        resolve,
      };
      this.send(frame);
    });
  }
  authorized(value: unknown) {
    const parsed = authorizationSchema.safeParse(value),
      pending = this.authorization;
    if (
      !this.live ||
      !parsed.success ||
      !pending ||
      parsed.data.session !== this.session ||
      parsed.data.id !== pending.request.id ||
      parsed.data.nonce !== pending.request.nonce ||
      parsed.data.digest !== pending.request.digest ||
      parsed.data.requestNonce !== pending.requestNonce ||
      parsed.data.proofDigest !== pending.proofDigest
    ) {
      this.close();
      return;
    }
    clearTimeout(pending.timer);
    this.authorization = undefined;
    // Subtract the entire request/response latency, rather than starting at ACK receipt.
    const deadline = Math.min(this.sessionDeadline, pending.sentAt + parsed.data.remainingMs);
    pending.resolve(this.now() < deadline ? deadline : null);
  }
}
