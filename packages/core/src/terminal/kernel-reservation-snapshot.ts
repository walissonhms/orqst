import { dirname } from 'node:path';
import { z } from 'zod';
import { desktopAdmissionMarkerSchema } from '../managed-codex/desktop-admission-inspection.js';
import { managedCodexConfigSchema } from './codex-profile.js';
import { managedClaudeConfigSchema } from './interactive-profile.js';
import { managedOpenCodeConfigSchema } from './opencode-profile.js';
import { terminalDigest } from './authority.js';
import { inspectKernelMember } from './kernel-reservation-evidence.js';
import {
  assertHeldRecoverySnapshot,
  readRecoveryFile,
  snapshotOfflineReservation,
} from './offline-recovery-files.js';

const configSchema = z.union([
  managedCodexConfigSchema,
  managedClaudeConfigSchema,
  managedOpenCodeConfigSchema,
]);

/**
 * Strict current snapshot only. The owner Core and every observed dispatch must be
 * bound to complete receipts; legacy and incomplete identities remain ineligible.
 */
export function snapshotKernelReservation(directory: string, scratch: string) {
  const snapshot = snapshotOfflineReservation(directory, scratch, undefined, undefined, 'kernel');
  const markerFile = snapshot.files[0]!;
  const marker = desktopAdmissionMarkerSchema.parse(
    JSON.parse(Buffer.from(markerFile.bytes, 'base64').toString('utf8')),
  );
  if (!marker.epoch) throw new Error('Kernel process identity not recorded');
  const configs = snapshot.files.flatMap((file) => {
    try {
      const value: unknown = JSON.parse(Buffer.from(file.bytes, 'base64').toString('utf8'));
      const parsed = configSchema.safeParse(value);
      return parsed.success ? [{ state: parsed.data.state, digest: file.sha256 }] : [];
    } catch {
      return [];
    }
  });
  const receipts = snapshot.journals.flatMap((journal) => {
    const state = dirname(journal.path);
    const matches = configs.filter((config) => config.state === state);
    if (matches.length !== 1) throw new Error('Kernel manifest binding unavailable');
    return inspectKernelMember(
      state,
      marker.owner,
      marker.epoch!,
      matches[0]!.digest,
      journal.logical.attempts,
    );
  });
  if (!receipts.length) throw new Error('Kernel process identity not recorded');
  const core = JSON.stringify(receipts[0]!.core);
  if (receipts.some((receipt) => JSON.stringify(receipt.core) !== core))
    throw new Error('Kernel producer changed');
  assertHeldRecoverySnapshot(directory, snapshot);
  if (JSON.stringify(readRecoveryFile(markerFile.path)) !== JSON.stringify(markerFile))
    throw new Error('Kernel reservation marker changed');
  const evidenceDigest = terminalDigest(
    JSON.stringify({ rawDigest: snapshot.rawDigest, receipts }),
  );
  return { snapshot, marker, receipts, evidenceDigest };
}
