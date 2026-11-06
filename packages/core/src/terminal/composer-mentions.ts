import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  composerMentionInputSchema,
  composerMentionRecordSchema,
  type ComposerMentionInput,
} from '@orqst/protocol';
import { terminalDirectory } from './codex-profile.js';
import { withTerminalPreferences } from './layout-database.js';

/** Record attempts only; this service has no transport and confers no authority. */
export type ComposerDeliveryOutcome =
  | { delivery: 'queued'; reason: 'hub_inbox' }
  | { delivery: 'denied'; reason: 'inbox_full' | 'unavailable' | 'unknown_terminal' };

export function recordComposerMention(
  directory: string,
  workspaceId: string,
  featureId: string | null,
  knownIds: string[],
  raw: ComposerMentionInput,
  /** Hub delivery for owner messages to a Feature member; undefined keeps v1 (no route). */
  deliver?: (terminalId: string, text: string) => ComposerDeliveryOutcome,
) {
  const input = composerMentionInputSchema.parse(raw);
  return withTerminalPreferences(directory, (store) =>
    store.transaction(() => {
      const features = store.features().list(workspaceId);
      const feature = features.find((entry) => entry.featureId === featureId);
      if (featureId !== null && !feature) throw new Error('Feature unavailable');
      const assigned = new Set(features.flatMap((entry) => entry.terminalIds));
      const members = new Set(feature?.terminalIds ?? knownIds.filter((id) => !assigned.has(id)));
      const originValid = input.from.kind === 'user' || members.has(input.from.terminalId);
      const outcomes = input.to.map((terminalId) => {
        if (!knownIds.includes(terminalId))
          return { terminalId, delivery: 'denied' as const, reason: 'unknown_terminal' as const };
        if (!originValid)
          return { terminalId, delivery: 'denied' as const, reason: 'not_member' as const };
        if (!members.has(terminalId))
          return {
            terminalId,
            delivery: 'denied' as const,
            reason: assigned.has(terminalId)
              ? ('cross_feature_denied' as const)
              : ('not_member' as const),
          };
        if (deliver && input.from.kind === 'user' && featureId !== null)
          return { terminalId, ...deliver(terminalId, input.text) };
        return {
          terminalId,
          delivery: 'unsupported' as const,
          reason: 'no_structured_route' as const,
        };
      });
      const record = composerMentionRecordSchema.parse({
        ...input,
        id: randomUUID(),
        at: Date.now(),
        workspaceId,
        featureId,
        outcomes,
      });
      const parent = realpathSync(directory);
      terminalDirectory(parent, true);
      const root = join(parent, 'composer-mentions');
      try {
        mkdirSync(root, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      terminalDirectory(root, true);
      if (readdirSync(root).length >= 10000) throw new Error('Mention journal full');
      const fd = openSync(
        join(root, `${record.id}.json`),
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        const info = fstatSync(fd);
        if (
          !info.isFile() ||
          info.nlink !== 1 ||
          info.uid !== process.getuid?.() ||
          info.mode & 0o077
        )
          throw new Error('Unsafe mention journal');
        writeFileSync(fd, JSON.stringify(record) + '\n');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      const dir = openSync(root, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
      return { id: record.id, outcomes: record.outcomes };
    }),
  );
}
