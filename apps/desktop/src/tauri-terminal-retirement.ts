import { sign, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import {
  terminalChallengeBytes,
  terminalDigest,
} from '../../../packages/core/src/terminal/authority.js';

const ownedRetirementEvidenceSchema = z.strictObject({
  epoch: z.uuid(),
  attempts: z
    .array(
      z.strictObject({
        slot: z.number().int().min(0).max(7),
        instanceId: z.uuid(),
        epoch: z.uuid(),
        state: z.enum(['prepared', 'start_failed', 'exited']),
        exit: z
          .strictObject({
            exitCode: z.number().int().safe(),
            signal: z.number().int().safe().optional(),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(1024),
});
export type OwnedTerminalRetirementEvidence = z.infer<typeof ownedRetirementEvidenceSchema>;

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
  readonly epoch?: string;
  beginOwnedShutdown?(): Promise<unknown>;
  preserveOwnedShutdown?(): Promise<unknown>;
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

  private deny(why: string): 'denied' {
    // Diagnostics only: which retirement gate refused (forwarded only with diagnostics on).
    process.stderr.write(`ORQST_SHUTDOWN retirement_denied ${why}\n`);
    return 'denied';
  }

  async run(ports: {
    current(): boolean;
    /** Legacy hosts only. Never called or used as fallback when authorizeOwnedRetirement is installed. */
    confirm?(detail: string): Promise<boolean>;
    /** Core proves nondispatch/owned exit; this checks known attempt identity, never CLI-use trust. */
    authorizeOwnedRetirement?(evidence: OwnedTerminalRetirementEvidence): boolean;
    closeBrokers(): void;
  }): Promise<'retired' | 'cancelled' | 'denied' | 'busy'> {
    if (this.fenced || !ports.current()) return this.deny('fence_or_stale');
    if (this.busy) return 'busy';
    this.busy = true;
    try {
      // Core alone proves all dispatched exits, journal ownership and reservation identity.
      const review = reviewSchema.parse(await this.core.prepareRetire());
      if (
        (this.core.epoch !== undefined && review.challenge.epoch !== this.core.epoch) ||
        review.challenge.target !== review.challenge.epoch ||
        review.challenge.digest !== terminalDigest(JSON.stringify(review.evidence))
      )
        return this.deny('challenge');
      const detail = JSON.stringify(review.evidence, null, 2).replace(
        /\p{Cf}/gu,
        (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`,
      );
      if ((!ports.authorizeOwnedRetirement && detail.length > 4096) || !ports.current())
        return this.deny('detail_or_stale');
      if (ports.authorizeOwnedRetirement) {
        const evidence = ownedRetirementEvidenceSchema.parse(review.evidence);
        if (
          evidence.epoch !== review.challenge.epoch ||
          evidence.attempts.some(
            (attempt) =>
              attempt.epoch !== evidence.epoch || (attempt.state === 'exited' && !attempt.exit),
          ) ||
          !ports.authorizeOwnedRetirement(evidence)
        )
          return this.deny('evidence');
      } else if (!(await ports.confirm?.(detail))) return 'cancelled';
      if (!ports.current()) return this.deny('stale');
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
    } catch (error) {
      // Diagnostics only: the failed step's message, never content or credentials.
      process.stderr.write(
        `ORQST_SHUTDOWN retirement_error ${String((error as Error)?.message ?? error).slice(0, 160)}\n`,
      );
      return 'denied';
    } finally {
      // The fenced flag already blocks every pane. Broker teardown can send detach RPCs;
      // do it after the retirement/exit wait so it cannot exhaust the shared RPC capacity.
      if (this.fenced) ports.closeBrokers();
      this.busy = false;
    }
  }
}
