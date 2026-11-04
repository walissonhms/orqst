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

/** Review GUI tool precedence explicitly; preserve a custom environment PATH and canonical identities. */
export function localCliPathDirectories(
  searchPath: string,
  home?: string,
  selectedDirectories: readonly string[] = [],
) {
  if (Buffer.byteLength(searchPath) > localCliPathPolicy.maximumPathBytes)
    throw new Error('CLI discovery PATH exceeds the inspection budget');
  if (
    selectedDirectories.length > localCliPathPolicy.maximumDirectories ||
    Buffer.byteLength(selectedDirectories.join(delimiter)) > localCliPathPolicy.maximumPathBytes
  )
    throw new Error('Selected CLI tool directories exceed the inspection budget');
  // Explicit selection must never silently disappear during safe filtering.
  for (const path of selectedDirectories) {
    try {
      if (
        !isAbsolute(path) ||
        path.includes('\0') ||
        path.includes(delimiter) ||
        realpathSync(path) !== path ||
        !trustedDirectory(path)
      )
        throw new Error('Invalid selection');
    } catch {
      throw new Error('Selected CLI tool directory is unavailable or unsafe');
    }
  }
  const environment = searchPath
    .split(delimiter)
    .filter((path) => isAbsolute(path) && !path.includes('\0'))
    .map((path) => ({ path, origin: 'env' as const }));
  const installers = home
    ? localCliFallbackDirectories(home).map((path) => ({ path, origin: 'fallback' as const }))
    : [];
  const selected = selectedDirectories.map((path) => ({ path, origin: 'fallback' as const }));
  const system = new Set(legacyTerminalPath.split(delimiter));
  const guiMinimal = environment.every(({ path }) => system.has(path.replace(/\/+$/, '')));
  // Finder/launchd system stubs must not shadow explicitly selected native tools.
  // A custom PATH is a deliberate order and is retained; the complete result is reviewed.
  const inputs = guiMinimal
    ? [...selected, ...installers, ...environment]
    : [...environment, ...installers, ...selected];
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
  if (selectedDirectories.some((path) => !directories.some((directory) => directory.path === path)))
    throw new Error('Selected CLI tool directory is unavailable or unsafe');
  const path = directories.map((value) => value.path).join(delimiter);
  if (Buffer.byteLength(path) > localCliPathPolicy.maximumPathBytes)
    throw new Error('Canonical CLI PATH exceeds the inspection budget');
  return {
    path,
    directories,
    rejected,
    precedence: guiMinimal
      ? ('selected-installers-system' as const)
      : ('explicit-env-first' as const),
    inspection: limited ? ('limited' as const) : ('complete' as const),
  };
}

/** New manifests carry reviewed canonical directories; legacy manifests retain their fixed PATH. */
export function terminalToolPath(reviewed?: string): string {
  if (reviewed === undefined) return legacyTerminalPath;
  if (!terminalToolPathSchema.safeParse(reviewed).success)
    throw new Error('Reviewed terminal PATH is invalid or exceeds the byte budget');
  const entries = reviewed.split(delimiter);
  if (entries.length > localCliPathPolicy.maximumDirectories)
    throw new Error('Reviewed terminal PATH exceeds the directory budget');
  const identities = new Set<string>();
  for (const path of entries) {
    if (!isAbsolute(path) || path.includes('\0'))
      throw new Error('Reviewed terminal PATH contains an empty or nonabsolute directory');
    let canonical: string;
    let info: ReturnType<typeof trustedDirectory>;
    try {
      canonical = realpathSync(path);
      info = trustedDirectory(canonical);
    } catch {
      throw new Error('Reviewed terminal PATH directory is missing or inaccessible');
    }
    if (canonical !== path)
      throw new Error('Reviewed terminal PATH directory is no longer canonical');
    if (!info) throw new Error('Reviewed terminal PATH directory ownership or permissions changed');
    const identity = `${info.device}:${info.inode}`;
    if (identities.has(identity))
      throw new Error('Reviewed terminal PATH contains duplicate directory identities');
    identities.add(identity);
  }
  const current = localCliPathDirectories(reviewed);
  if (current.inspection !== 'complete')
    throw new Error('Reviewed terminal PATH metadata inspection is incomplete');
  if (current.path !== reviewed)
    throw new Error('Reviewed terminal PATH directory changed during validation');
  return current.path;
}
