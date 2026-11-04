// Passive local metadata only. Never source a shell profile or inherit credential variables.
import { lstatSync, realpathSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, parse } from 'node:path';
import { z } from 'zod';

export const localCliPathPolicy = Object.freeze({
  maximumPathBytes: 32768,
  maximumDirectories: 128,
});
export const legacyTerminalPath = '/usr/bin:/bin:/usr/sbin:/sbin';
export const terminalToolPathSchema = z
  .string()
  .min(1)
  .refine((value) => Buffer.byteLength(value) <= localCliPathPolicy.maximumPathBytes);

/** These installer locations are candidates, never proof of installation or authentication. */
export function localCliFallbackDirectories(home: string): string[] {
  if (!isAbsolute(home) || home.includes('\0')) throw new Error('Absolute CLI home required');
  return [
    join(home, '.local/bin'),
    join(home, '.claude/local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.opencode/bin'),
  ];
}

function trustedDirectory(path: string): { device: number; inode: number } | undefined {
  const info = lstatSync(path);
  if (
    !info.isDirectory() ||
    (info.uid !== 0 && info.uid !== process.getuid?.()) ||
    info.mode & 0o022
  )
    return undefined;
  let ancestor = dirname(path);
  while (ancestor !== parse(ancestor).root) {
    const parent = lstatSync(ancestor);
    if (
      (parent.uid !== 0 && parent.uid !== process.getuid?.()) ||
      (parent.mode & 0o022 && !(parent.mode & 0o1000))
    )
      return undefined;
    ancestor = dirname(ancestor);
  }
  return { device: info.dev, inode: info.ino };
}

/** Preserve PATH priority, append installer fallbacks, and deduplicate canonical directory identities. */
export function localCliPathDirectories(
  searchPath: string,
  home?: string,
  selectedDirectories: readonly string[] = [],
) {
  if (Buffer.byteLength(searchPath) > localCliPathPolicy.maximumPathBytes)
    throw new Error('CLI discovery PATH exceeds the inspection budget');
  const inputs = [
    ...searchPath.split(delimiter).map((path) => ({ path, origin: 'env' as const })),
    ...(home
      ? localCliFallbackDirectories(home).map((path) => ({ path, origin: 'fallback' as const }))
      : []),
    ...selectedDirectories.map((path) => ({ path, origin: 'fallback' as const })),
  ].filter(({ path }) => isAbsolute(path) && !path.includes('\0'));
  const unique: typeof inputs = [];
  const seenPaths = new Set<string>();
  for (const input of inputs) {
    if (seenPaths.has(input.path)) continue;
    seenPaths.add(input.path);
    unique.push(input);
  }
  let limited = unique.length > localCliPathPolicy.maximumDirectories;
  const directories: { path: string; origin: 'env' | 'fallback' }[] = [];
  const rejected: { path: string; origin: 'env' | 'fallback'; reason: 'unsafe_directory' }[] = [];
  const seen = new Set<string>();
  for (const input of unique.slice(0, localCliPathPolicy.maximumDirectories)) {
    try {
      const path = realpathSync(input.path);
      // A canonical target containing the PATH delimiter cannot be represented safely.
      if (path.includes(delimiter)) {
        rejected.push({ ...input, reason: 'unsafe_directory' });
        continue;
      }
      const info = trustedDirectory(path);
      if (!info) {
        rejected.push({ ...input, reason: 'unsafe_directory' });
        continue;
      }
      const identity = `${info.device}:${info.inode}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      directories.push({ path, origin: input.origin });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') limited = true;
    }
  }
  const path = directories.map((value) => value.path).join(delimiter);
  if (Buffer.byteLength(path) > localCliPathPolicy.maximumPathBytes)
    throw new Error('Canonical CLI PATH exceeds the inspection budget');
  return {
    path,
    directories,
    rejected,
    inspection: limited ? ('limited' as const) : ('complete' as const),
  };
}

/** New manifests carry reviewed canonical directories; legacy manifests retain their fixed PATH. */
export function terminalToolPath(reviewed?: string): string {
  if (reviewed === undefined) return legacyTerminalPath;
  terminalToolPathSchema.parse(reviewed);
  const current = localCliPathDirectories(reviewed);
  if (current.inspection !== 'complete' || current.path !== reviewed)
    throw new Error('Reviewed terminal PATH changed or is not canonical');
  return current.path;
}
