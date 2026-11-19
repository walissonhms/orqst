import { opendirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { desktopAdmissionMarkerSchema } from '../../../packages/core/src/managed-codex/desktop-admission-inspection.js';
import { terminalDirectory } from '../../../packages/core/src/terminal/codex-profile.js';
import { localCliProviders } from '../../../packages/core/src/terminal/local-cli.js';
import { readRecoveryFile } from '../../../packages/core/src/terminal/offline-recovery-files.js';

const manifest = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  identity: z.object({ terminalId: z.uuid() }),
  state: z.string(),
  project: z.string(),
});

export function savedTerminalMetadata(parent: string, terminalIds: ReadonlySet<string>) {
  const result = new Map<
    string,
    { provider: (typeof localCliProviders)[number]; project: string; activeReservation?: true }
  >();
  if (!terminalIds.size) return result;
  const read = (file: string): unknown =>
    JSON.parse(Buffer.from(readRecoveryFile(file).bytes, 'base64').toString('utf8'));

  // This marker can identify the blocker; it grants no release or process authority.
  let active = new Set<string>();
  try {
    active = new Set(
      desktopAdmissionMarkerSchema.parse(read(join(parent, 'managed-agents', 'active-pair.json')))
        .manifests,
    );
  } catch {
    // Missing or unreadable markers supply no display evidence.
  }
  const conflicts = new Set<string>();
  function inspect(file: string) {
    try {
      const { identity, state, project, version } = manifest.parse(read(file));
      const { terminalId } = identity;
      if (state !== dirname(file) || !terminalIds.has(terminalId) || conflicts.has(terminalId))
        return;
      if (result.has(terminalId)) {
        result.delete(terminalId);
        conflicts.add(terminalId);
        return;
      }
      result.set(terminalId, {
        provider: localCliProviders[version - 1]!,
        project,
        ...(active.has(file) ? { activeReservation: true } : {}),
      });
    } catch {
      // One stale or invalid manifest must not suppress other display metadata.
    }
  }

  // Only the existing, finalized native generation/slot layout is inspected.
  // Keep work bounded and omit all metadata if the inventory is incomplete.
  try {
    terminalDirectory(parent, true);
    const directory = opendirSync(parent);
    try {
      let count = 0;
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        if (++count > 1024) throw new Error('Saved terminal inventory exceeds its budget');
        if (!entry.isDirectory() || !entry.name.startsWith('terminal-pair-')) continue;
        if (!z.uuid().safeParse(entry.name.slice('terminal-pair-'.length)).success) continue;
        for (const slot of 'ABCDEFGH') inspect(join(parent, entry.name, slot, 'terminal.json'));
      }
    } finally {
      directory.closeSync();
    }
  } catch {
    result.clear();
  }
  return result;
}
