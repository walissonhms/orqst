import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { redact } from '@orqst/shared';
import { terminalDirectory } from './codex-profile.js';
import type { ManagedClaudeConfig } from './interactive-profile.js';
import { lifecycleBindingSchema } from '../managed-codex/lifecycle-receipt.js';

const maximum = 2 * 1024 * 1024;
const lineMaximum = 64 * 1024;
const lineSchema = z.object({
  sessionId: z.string(),
  cwd: z.string(),
  timestamp: z.iso.datetime({ offset: true }),
  type: z.literal('assistant'),
  message: z.object({ content: z.array(z.unknown()).max(256) }),
});
const toolSchema = z.object({
  type: z.literal('tool_use'),
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
});

/**
 * Create a passive reader only when the exact random Claude session path was absent
 * before this one-shot owned launch. Failure never prevents or retries dispatch.
 * Project directory spelling follows Anywh transcriptPath/sanitizeCwd at
 * 546f189c04415c3c5af5f40e3931a0a90b9aba31 (Apache-2.0), narrowed here to
 * an exact session UUID, no-follow reads, strict records and bounded tool names.
 */
export function ownedClaudeSession(
  config: ManagedClaudeConfig,
  binding: { instanceId: string; epoch: string; manifestDigest: string; configDigest: string },
) {
  try {
    if (!lifecycleBindingSchema.safeParse(binding).success) return undefined;
    const root =
      config.authentication.claudeConfigDirectory ?? join(config.authentication.home, '.claude');
    terminalDirectory(root);
    terminalDirectory(config.project);
    const project = realpathSync(config.project);
    const file = join(
      root,
      'projects',
      project.replace(/[^a-zA-Z0-9-]/g, '-'),
      `${config.sessionId}.jsonl`,
    );
    try {
      lstatSync(file);
      return undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined;
    }
    let identity: { dev: number; ino: number } | undefined;
    let invalidated = false;
    let persisted = false;
    const persist = (source: { dev: number; ino: number; recordSha256: string }) => {
      if (persisted) return true;
      if (invalidated) return false;
      // An uncertain evidence write is never retried and no partial file is removed.
      invalidated = true;
      let out: number | undefined;
      let directory: number | undefined;
      try {
        terminalDirectory(config.state, true);
        out = openSync(
          join(config.state, `session-binding-${binding.instanceId}.json`),
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o600,
        );
        const bytes = Buffer.from(
          JSON.stringify({
            version: 1,
            binding,
            provider: 'claude',
            sessionId: config.sessionId,
            evidence: 'claude-argv-receipt-transcript',
            recordedAt: Date.now(),
            source,
          }) + '\n',
        );
        let offset = 0;
        while (offset < bytes.length) {
          const written = writeSync(out, bytes, offset, bytes.length - offset);
          if (!written) throw new Error('Session binding write unavailable');
          offset += written;
        }
        fsyncSync(out);
        directory = openSync(
          config.state,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
        );
        fsyncSync(directory);
        persisted = true;
        invalidated = false;
        return true;
      } catch {
        return false;
      } finally {
        if (directory !== undefined) closeSync(directory);
        if (out !== undefined) closeSync(out);
      }
    };
    return () => {
      let fd: number | undefined;
      try {
        if (invalidated) return undefined;
        terminalDirectory(root);
        terminalDirectory(dirname(file));
        if (realpathSync(file) !== file || realpathSync(config.project) !== project)
          return undefined;
        fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const info = fstatSync(fd);
        if (
          !info.isFile() ||
          info.uid !== process.getuid?.() ||
          info.mode & 0o022 ||
          info.nlink !== 1 ||
          info.size > maximum ||
          !Number.isSafeInteger(info.dev) ||
          !Number.isSafeInteger(info.ino)
        )
          return undefined;
        if (identity && (identity.dev !== info.dev || identity.ino !== info.ino)) {
          invalidated = true;
          return undefined;
        }
        identity ??= { dev: info.dev, ino: info.ino };
        const bytes = Buffer.alloc(maximum + 1);
        let count = 0;
        while (count < bytes.length) {
          const read = readSync(fd, bytes, count, bytes.length - count, count);
          if (!read) break;
          count += read;
        }
        if (count > maximum) return undefined;
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count));
        const lines = text.split('\n');
        lines.pop(); // Never interpret a partial last record.
        const activities: Array<{ at: number; kind: 'tool'; label: string }> = [];
        let matched: string | undefined;
        for (const line of lines.slice(-512)) {
          if (!line || line.length > lineMaximum) continue;
          let raw: unknown;
          try {
            raw = JSON.parse(line);
          } catch {
            continue;
          }
          const parsed = lineSchema.safeParse(raw);
          if (
            !parsed.success ||
            parsed.data.sessionId !== config.sessionId ||
            parsed.data.cwd !== project
          )
            continue;
          matched ??= createHash('sha256').update(line).digest('hex');
          const at = Date.parse(parsed.data.timestamp);
          if (!Number.isSafeInteger(at) || at < 0) continue;
          for (const rawBlock of parsed.data.message.content) {
            const tool = toolSchema.safeParse(rawBlock);
            if (tool.success && redact(tool.data.name) === tool.data.name)
              activities.push({ at, kind: 'tool', label: tool.data.name });
          }
        }
        if (!matched || !persist({ ...identity, recordSha256: matched })) return undefined;
        return {
          session: {
            provider: 'claude' as const,
            sessionId: config.sessionId,
            bindingEvidence: 'claude-argv-receipt-transcript' as const,
          },
          activities: activities.slice(-3),
        };
      } catch {
        if (identity) invalidated = true;
        return undefined;
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    };
  } catch {
    return undefined;
  }
}
