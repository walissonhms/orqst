import { sign } from 'node:crypto';
import { dirname, basename } from 'node:path';
import { z } from 'zod';
import { terminalDirectory } from '../../../packages/core/src/terminal/codex-profile.js';
import {
  administrativeRecoveryBytes,
  administrativeIntentBytes,
  administrativeIntentDigest,
  administrativeRecoveryIntent,
  type AdministrativeRecoveryIntent,
  OfflineReservationRecovery,
} from '../../../packages/core/src/terminal/offline-recovery.js';
import {
  assertAdministrativeAnchor,
  installAdministrativeAnchor,
  loadAdministrativeAnchor,
  recoveryLocations,
} from './offline-recovery-anchor.js';
import {
  administrativeRequestSchema,
  type AdministrativeAction,
  AdministrativeReviewPipe,
} from './offline-recovery-wire.js';

export type AdministrativeOutcome =
  | 'installed'
  | 'captured'
  | 'capture_continued'
  | 'release_prepared'
  | 'finalized'
  | 'finalized_controls_preserved'
  | 'aborted';

/** Fixed native composition; deliberately imports neither managed Core nor observer Store. */
export class TauriOfflineRecovery {
  private recovery?: OfflineReservationRecovery;
  private action?: AdministrativeAction;
  private sequence = 0;
  private busy = false;
  private reviewed?: {
    intent: Readonly<AdministrativeRecoveryIntent>;
    detail: string;
    fingerprint: string;
    binding: string;
  };
  private signed?: { challenge: string; binding: string; deadline: number };
  constructor(
    private readonly parent: string,
    private readonly pipe: AdministrativeReviewPipe,
    // Fixture composition only. The production host passes no source/clock overrides.
    private readonly dependencies: NonNullable<
      ConstructorParameters<typeof OfflineReservationRecovery>[1]
    > = {},
  ) {}
  async receive(input: unknown): Promise<AdministrativeOutcome> {
    const request = administrativeRequestSchema.parse(input);
    if (
      !this.pipe.current() ||
      this.busy ||
      request.session !== this.pipe.session ||
      request.id <= this.sequence
    )
      throw new Error('Administrative request refused');
    this.sequence = request.id;
    this.busy = true;
    this.action = request.action;
    try {
      const paths = recoveryLocations(this.parent);
      if (request.action === 'install') {
        if (request.bundle !== null || this.recovery)
          throw new Error('Invalid anchor installation');
        await installAdministrativeAnchor(
          this.parent,
          (detail, binding) => this.pipe.review('install', detail, binding),
          this.pipe.current,
          (challenge, binding, check) => this.pipe.authorize(binding, challenge, check),
        );
        if (!this.pipe.current())
          throw new Error('Administrative installation effects are unconfirmed');
        return 'installed';
      }
      if (!this.recovery) {
        // Only the preinstalled fixed native anchor is enrolled. Capture supplies no key.
        const anchor = loadAdministrativeAnchor(this.parent);
        this.recovery = new OfflineReservationRecovery(
          {
            publicKey: anchor.publicKey,
            review: async (intent, detail, fingerprint) => {
              this.reviewed = undefined;
              this.signed = undefined;
              const action = this.action;
              const phase =
                action === 'continueCapture'
                  ? 'capture'
                  : action === 'continueRelease'
                    ? 'release'
                    : action;
              if (!action || intent.phase !== phase || !this.pipe.current()) return false;
              assertAdministrativeAnchor(this.parent, anchor);
              if (administrativeIntentDigest(intent, detail) !== fingerprint)
                throw new Error('Administrative intent binding changed');
              const binding = JSON.stringify({ intent, fingerprint });
              const displayed = JSON.stringify(
                { intentFingerprint: fingerprint, review: JSON.parse(detail) as unknown },
                null,
                2,
              );
              if (!(await this.pipe.review(action, displayed, binding)) || !this.pipe.current())
                return false;
              assertAdministrativeAnchor(this.parent, anchor);
              this.reviewed = { intent, detail, fingerprint, binding };
              return true;
            },
            sign: async (challenge) => {
              const reviewed = this.reviewed;
              this.reviewed = undefined; // No second signature or stale ACK renewal.
              if (
                !reviewed ||
                challenge.version !== 2 ||
                challenge.intentDigest !== reviewed.fingerprint ||
                administrativeIntentBytes(administrativeRecoveryIntent(challenge)) !==
                  administrativeIntentBytes(reviewed.intent) ||
                administrativeIntentDigest(reviewed.intent, reviewed.detail) !==
                  reviewed.fingerprint
              )
                return null;
              const serialized = JSON.stringify(challenge);
              const granted = await this.pipe.authorize(reviewed.binding, serialized);
              if (granted === null || !this.pipe.current()) return null;
              assertAdministrativeAnchor(this.parent, anchor);
              const deadline = Math.min(challenge.expiresAt, granted);
              this.signed = { challenge: serialized, binding: reviewed.binding, deadline };
              return {
                signature: sign(
                  null,
                  administrativeRecoveryBytes(challenge),
                  anchor.privateKey,
                ).toString('base64url'),
                validUntil: deadline,
              };
            },
            revalidate: async (challenge) => {
              const signed = this.signed;
              if (!signed || signed.challenge !== JSON.stringify(challenge)) return null;
              const granted = await this.pipe.authorize(signed.binding, signed.challenge, true);
              if (granted === null || !this.pipe.current()) return null;
              assertAdministrativeAnchor(this.parent, anchor);
              signed.deadline = Math.min(signed.deadline, granted);
              return signed.deadline;
            },
          },
          {
            ...this.dependencies,
            // A dropped/revoked pipe cannot authorize a proof after the async review returns.
            now: () =>
              this.pipe.current() ? (this.dependencies.now?.() ?? performance.now()) : Infinity,
          },
        );
      }
      let outcome: AdministrativeOutcome;
      if (request.action === 'capture') {
        if (request.bundle !== null) throw new Error('Capture cannot supply a bundle');
        await this.recovery.capture(paths.admission, paths.bundles);
        outcome = 'captured';
      } else {
        const bundle = z.string().parse(request.bundle);
        terminalDirectory(paths.bundles, true);
        terminalDirectory(bundle, true);
        if (dirname(bundle) !== paths.bundles || !/^offline-[a-f0-9-]{36}$/.test(basename(bundle)))
          throw new Error('Native bundle containment refused');
        if (request.action === 'finalize') {
          const result = await this.recovery.finalize(bundle);
          if (result.status !== 'finalized' || result.releaseCommitted !== true)
            throw new Error('Administrative commit unconfirmed');
          outcome =
            result.cleanup === 'changed_controls_preserved'
              ? 'finalized_controls_preserved'
              : 'finalized';
        } else if (request.action === 'release' || request.action === 'continueRelease') {
          const result = await this.recovery[request.action](bundle);
          if (
            result.version !== 2 ||
            result.status !== 'release_prepared' ||
            result.admissionBlocked !== true
          )
            throw new Error('Administrative preparation unconfirmed');
          outcome = 'release_prepared';
        } else {
          await this.recovery[request.action](bundle);
          outcome = request.action === 'abort' ? 'aborted' : 'capture_continued';
        }
      }
      if (!this.pipe.current())
        throw new Error('Administrative phase effects are unconfirmed after pipe close');
      return outcome;
    } finally {
      this.reviewed = undefined;
      this.signed = undefined;
      this.action = undefined;
      this.busy = false;
    }
  }
}
