import { sign } from 'node:crypto';
import { dirname, basename } from 'node:path';
import { z } from 'zod';
import { terminalDirectory } from '../../../packages/core/src/terminal/codex-profile.js';
import {
  administrativeRecoveryBytes,
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
          (detail) =>
            this.pipe.review('install', detail, 'orqst.administrative-anchor-installation'),
          this.pipe.current,
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
            review: async (challenge, detail) => {
              const action = this.action;
              const phase =
                action === 'continueCapture'
                  ? 'capture'
                  : action === 'continueRelease'
                    ? 'release'
                    : action;
              if (!action || challenge.phase !== phase || !this.pipe.current()) return null;
              assertAdministrativeAnchor(this.parent, anchor);
              const binding = JSON.stringify(challenge);
              // The complete review is generated from validated source by the frozen recovery service.
              const reviewed = JSON.parse(detail) as { challenge?: unknown };
              if (JSON.stringify(reviewed.challenge) !== binding)
                throw new Error('Administrative review binding changed');
              if (!(await this.pipe.review(action, detail, binding)) || !this.pipe.current())
                return null;
              assertAdministrativeAnchor(this.parent, anchor);
              if (binding !== JSON.stringify(challenge)) return null;
              return sign(null, administrativeRecoveryBytes(challenge), anchor.privateKey).toString(
                'base64url',
              );
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
      this.action = undefined;
      this.busy = false;
    }
  }
}
