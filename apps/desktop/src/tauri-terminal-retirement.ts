import { sign, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import {
  terminalChallengeBytes,
  terminalDigest,
} from '../../../packages/core/src/terminal/authority.js';

const reviewSchema = z.strictObject({
  evidence: z.unknown(),
  challenge: z.strictObject({
    version: z.literal(1),
    epoch: z.uuid(),
    clientId: z.literal('desktop-managed'),
    challengeId: z.uuid(),
    expiresAt: z.number().finite(),
    operation: z.literal('retire'),
    target: z.uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});

export interface TauriTerminalRetirementCore {
  prepareRetire(): Promise<unknown>;
  retire(proof: unknown): Promise<unknown>;
  closeAndWait(): Promise<void>;
}

/** Native-only transaction over the existing Core authority, not a recovery manager. */
export class TauriTerminalRetirement {
  busy = false;
  fenced = false;

  constructor(
    private readonly core: TauriTerminalRetirementCore,
    private readonly key: KeyObject,
  ) {}

  async run(ports: {
    current(): boolean;
    confirm(detail: string): Promise<boolean>;
    closeBrokers(): void;
  }): Promise<'retired' | 'cancelled' | 'denied' | 'busy'> {
    if (this.fenced || !ports.current()) return 'denied';
    if (this.busy) return 'busy';
    this.busy = true;
    try {
      // Core alone proves all dispatched exits, journal ownership and reservation identity.
      const review = reviewSchema.parse(await this.core.prepareRetire());
      if (
        review.challenge.target !== review.challenge.epoch ||
        review.challenge.digest !== terminalDigest(JSON.stringify(review.evidence))
      )
        return 'denied';
      const detail = JSON.stringify(review.evidence, null, 2).replace(
        /\p{Cf}/gu,
        (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`,
      );
      if (detail.length > 4096 || !ports.current()) return 'denied';
      if (!(await ports.confirm(detail))) return 'cancelled';
      if (!ports.current()) return 'denied';
      const proof = {
        challengeId: review.challenge.challengeId,
        signature: sign(null, terminalChallengeBytes(review.challenge), this.key).toString(
          'base64url',
        ),
      };
      // No retry after a possibly consumed proof or an uncertain archive/shutdown reply.
      this.fenced = true;
      await this.core.retire(proof);
      await this.core.closeAndWait();
      return 'retired';
    } catch {
      return 'denied';
    } finally {
      // The fenced flag already blocks every pane. Broker teardown can send detach RPCs;
      // do it after the retirement/exit wait so it cannot exhaust the shared RPC capacity.
      if (this.fenced) ports.closeBrokers();
      this.busy = false;
    }
  }
}
