// Durable metadata-only audit of hub messages (docs/design/mcp-n-terminals.md, decision 3).
// One append-only JSONL file per Core epoch in the private preferences directory. Never the
// message text. Bounded: past the cap, writing stops and the journal says so once.
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { terminalDirectory } from './codex-profile.js';
import type { HubEvidence } from './mcp-hub.js';

const MAX_BYTES = 1024 * 1024;

export function hubMessageJournal(preferences: string, epoch: string) {
  z.uuid().parse(epoch);
  const parent = realpathSync(preferences);
  terminalDirectory(parent, true);
  const root = join(parent, 'hub-communication');
  try {
    mkdirSync(root, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  terminalDirectory(root, true);
  const file = join(root, `${epoch}.jsonl`);
  const fd = openSync(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
    0o600,
  );
  const info = fstatSync(fd);
  if (!info.isFile() || info.uid !== process.getuid?.() || info.mode & 0o077 || info.nlink !== 1) {
    closeSync(fd);
    throw new Error('Hub journal unavailable');
  }
  let written = info.size;
  let full = false;
  return {
    append(event: HubEvidence) {
      if (full) return;
      const line =
        JSON.stringify({
          id: event.messageId,
          kind: event.kind,
          from: event.from,
          to: event.to,
          featureId: event.featureId,
          at: event.at,
          ...(event.taskId ? { taskId: event.taskId } : {}),
        }) + '\n';
      if (written + Buffer.byteLength(line) > MAX_BYTES) {
        full = true;
        writeSync(fd, JSON.stringify({ truncated: true, at: event.at }) + '\n');
        return;
      }
      written += writeSync(fd, line);
    },
    close() {
      closeSync(fd);
    },
  };
}
