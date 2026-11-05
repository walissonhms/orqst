// Developer acceptance roots must survive a host restart. The failed real attempt's
// quarantine lived under /private/tmp and was absent after an environment restart.
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { sep } from 'node:path';

export const EPHEMERAL_ACCEPTANCE_BASES: readonly string[] = [tmpdir(), '/tmp', '/private/tmp'];

/**
 * Resolves and refuses a root inside a system temporary directory. Ephemeral
 * fixtures remain allowed for synthetic runs; real reservations, journals and
 * lifecycle evidence must use an owner-approved durable path.
 */
export function assertDurableAcceptanceRoot(
  root: string,
  ephemeral: readonly string[] = EPHEMERAL_ACCEPTANCE_BASES,
): string {
  const resolved = realpathSync(root);
  for (const base of ephemeral) {
    let canonical: string;
    try {
      canonical = realpathSync(base);
    } catch {
      continue;
    }
    if (resolved === canonical || resolved.startsWith(`${canonical}${sep}`)) {
      throw new Error(
        'Acceptance root must be durable and outside the system temporary directory; ' +
          'a temporary root can lose the reservation, journal and lifecycle evidence on restart. ' +
          'Choose an owner-approved durable path.',
      );
    }
  }
  return resolved;
}
