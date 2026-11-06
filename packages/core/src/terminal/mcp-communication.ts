import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { communicationProjectionSchema, type WorkspaceFeature } from '@orqst/protocol';
import { stableId } from '@orqst/shared';
import { terminalDirectory } from './codex-profile.js';
import type { McpTaskEvidence } from './mcp-task.js';

const recordSchema = z.strictObject({
  version: z.literal(1),
  epoch: z.uuid(),
  workspaceId: z.string().min(1).max(128),
  featureId: z.uuid(),
  featureRevision: z.number().int().positive().safe(),
  id: z.uuid(),
  from: z.uuid(),
  to: z.uuid(),
  sourceInstanceId: z.uuid(),
  targetInstanceId: z.uuid(),
  grantId: z.uuid(),
  taskId: z.uuid(),
  kind: z.enum(['delegation', 'result']),
  at: z.number().int().nonnegative().safe(),
});

/** Metadata-only audit for this owned MCP pair. Never imports another host's journal. */
export function mcpCommunicationJournal(
  directory: string,
  epoch: string,
  workspaceId: string,
  terminalIds: readonly [string, string],
  features: () => WorkspaceFeature[],
) {
  z.uuid().parse(epoch);
  terminalIds.forEach((id) => z.uuid().parse(id));
  if (terminalIds[0] === terminalIds[1]) throw new Error('Ambiguous MCP terminals');
  terminalDirectory(directory, true);
  const root = join(directory, 'mcp-communication');
  try {
    mkdirSync(root, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  terminalDirectory(root, true);
  const file = join(root, `${epoch}.jsonl`);
  const fd = openSync(
    file,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  const identity = fstatSync(fd, { bigint: true });
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const parent = openSync(root, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
  const records: z.infer<typeof recordSchema>[] = [];
  let bytes = Buffer.alloc(0);
  let available = true;
  const inspect = (descriptor: number) => {
    const info = fstatSync(descriptor, { bigint: true });
    if (
      info.ino !== identity.ino ||
      info.dev !== identity.dev ||
      info.nlink !== 1n ||
      info.size !== BigInt(bytes.length) ||
      !info.isFile() ||
      info.uid !== BigInt(process.getuid!()) ||
      (info.mode & 0o077n) !== 0n
    )
      throw new Error('Unsafe MCP journal file');
  };
  const check = () => {
    terminalDirectory(root, true);
    const reader = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      inspect(reader);
      const current = Buffer.alloc(bytes.length + 1);
      let length = 0;
      while (length < current.length) {
        const count = readSync(reader, current, length, current.length - length, null);
        if (!count) break;
        length += count;
      }
      if (!current.subarray(0, length).equals(bytes))
        throw new Error('MCP journal changed outside its producer');
    } finally {
      closeSync(reader);
    }
  };
  const scope = () => {
    const owners = features().filter((feature) =>
      terminalIds.some((id) => feature.terminalIds.includes(id)),
    );
    const feature = owners[0];
    return owners.length === 1 &&
      feature?.workspaceId === workspaceId &&
      feature.status !== 'archived' &&
      terminalIds.every((id) => feature.terminalIds.includes(id))
      ? feature
      : undefined;
  };
  return {
    bind(sourceInstanceId: string, targetInstanceId: string) {
      try {
        check();
        z.uuid().parse(sourceInstanceId);
        z.uuid().parse(targetInstanceId);
        const feature = scope();
        if (!feature || !available) return undefined;
        const granted = { featureId: feature.featureId, revision: feature.revision };
        return (event: McpTaskEvidence) => {
          try {
            if (!available) return;
            check();
            const current = scope();
            if (
              !current ||
              current.featureId !== granted.featureId ||
              current.revision !== granted.revision ||
              event.sourceInstanceId !== sourceInstanceId ||
              event.targetInstanceId !== targetInstanceId
            )
              return;
            const hash = stableId(
              'mcp-communication',
              epoch,
              event.grantId,
              event.taskId,
              event.kind,
            );
            const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
            const record = recordSchema.parse({
              ...event,
              version: 1,
              epoch,
              workspaceId,
              featureId: granted.featureId,
              featureRevision: granted.revision,
              id,
              from: terminalIds[event.kind === 'delegation' ? 0 : 1],
              to: terminalIds[event.kind === 'delegation' ? 1 : 0],
            });
            const delegation = records.find(
              (prior) => prior.grantId === record.grantId && prior.kind === 'delegation',
            );
            if (
              records.some((prior) => prior.id === record.id) ||
              (record.kind === 'result' &&
                (!delegation ||
                  delegation.taskId !== record.taskId ||
                  delegation.sourceInstanceId !== sourceInstanceId ||
                  delegation.targetInstanceId !== targetInstanceId ||
                  delegation.featureId !== record.featureId))
            )
              return;
            if (records.length >= 32) throw new Error('MCP pair audit capacity');
            const line = Buffer.from(JSON.stringify(record) + '\n');
            if (bytes.length + line.length > 64 * 1024) throw new Error('MCP audit byte budget');
            const writer = openSync(
              file,
              constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
            );
            try {
              inspect(writer);
              if (writeSync(writer, line) !== line.length)
                throw new Error('Partial MCP journal write');
              fsyncSync(writer);
            } finally {
              closeSync(writer);
            }
            bytes = Buffer.concat([bytes, line]);
            records.push(record);
          } catch {
            available = false;
          }
        };
      } catch {
        available = false;
        return undefined;
      }
    },
    project(featureId: string | null) {
      try {
        if (!available) return undefined;
        check();
        const feature = scope();
        return communicationProjectionSchema.parse({
          events:
            !feature || feature.featureId !== featureId
              ? []
              : records
                  .filter((record) => record.featureId === featureId)
                  .slice(-50)
                  .map(({ id, from, to, kind, at }) => ({ id, from, to, kind, at })),
        });
      } catch {
        available = false;
        return undefined;
      }
    },
  };
}
