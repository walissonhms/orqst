import { opendirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { terminalIdentitySchema } from '@orqst/protocol';
import {
  lifecycleBindingSchema,
  readLifecycleReceipt,
} from '../../../packages/core/src/managed-codex/lifecycle-receipt.js';
import { terminalDirectory } from '../../../packages/core/src/terminal/codex-profile.js';
import { localCliProviders } from '../../../packages/core/src/terminal/local-cli.js';
import { readRecoveryFile } from '../../../packages/core/src/terminal/offline-recovery-files.js';

const manifest = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  identity: terminalIdentitySchema,
  state: z.string(),
  project: z.string(),
  model: z.object({ value: z.string().nullable() }).optional(),
  sessionId: z.uuid().optional(),
});

function lifecycleMetadata(state: string, digest: string, sessionId?: string, inherited?: string) {
  let exitedAt: number | undefined;
  let resumeSessionId: string | undefined;
  const directory = opendirSync(state);
  try {
    let count = 0;
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      if (++count > 128) return {};
      const match = /^lifecycle-([a-f0-9-]+)\.jsonl$/i.exec(entry.name);
      if (!entry.isFile() || !match) continue;
      try {
        const file = readRecoveryFile(join(state, entry.name), 4096);
        const firstLine = Buffer.from(file.bytes, 'base64').toString('utf8').split('\n', 1)[0]!;
        const binding = lifecycleBindingSchema.parse(JSON.parse(firstLine).binding);
        if (binding.instanceId !== match[1] || binding.configDigest !== digest) continue;
        const receipt = readLifecycleReceipt(state, binding);
        if (receipt.status === 'recorded_exit') {
          const exit = receipt.records.find(({ type }) => type === 'exit');
          if (exit) exitedAt = Math.max(exitedAt ?? 0, exit.at);
        }
        if (!receipt.records?.some(({ type }) => type === 'started')) continue;
        if (inherited) resumeSessionId = inherited;
        if (!sessionId) continue;
        const evidence = z
          .object({
            version: z.literal(1),
            binding: lifecycleBindingSchema,
            provider: z.literal('claude'),
            sessionId: z.uuid(),
            evidence: z.literal('claude-argv-receipt-transcript'),
          })
          .parse(
            JSON.parse(
              Buffer.from(
                readRecoveryFile(join(state, `session-binding-${binding.instanceId}.json`), 4096)
                  .bytes,
                'base64',
              ).toString('utf8'),
            ),
          );
        if (
          evidence.sessionId === sessionId &&
          JSON.stringify(evidence.binding) === JSON.stringify(binding)
        )
          resumeSessionId = sessionId;
      } catch {
        // A missing or incomplete receipt supplies no exit or conversation evidence.
      }
    }
  } finally {
    directory.closeSync();
  }
  return { exitedAt, resumeSessionId };
}

export function savedTerminalMetadata(parent: string, terminalIds: ReadonlySet<string>) {
  const result = new Map<
    string,
    {
      provider: (typeof localCliProviders)[number];
      project: string;
      model: string | null;
      alias: string;
      exitedAt?: number;
      resumeSessionId?: string;
    }
  >();
  if (!terminalIds.size) return result;
  const conflicts = new Set<string>();
  function inspect(file: string) {
    try {
      const source = readRecoveryFile(file);
      const { identity, state, project, version, model, sessionId } = manifest.parse(
        JSON.parse(Buffer.from(source.bytes, 'base64').toString('utf8')),
      );
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
        model: model?.value ?? null,
        alias: identity.alias ?? `P-${terminalId}`,
        ...lifecycleMetadata(
          state,
          source.sha256,
          version === 2 ? sessionId : undefined,
          identity.resumeSessionId,
        ),
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
