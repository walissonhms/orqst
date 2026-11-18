import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  cachedTerminalExecutableSha256,
  terminalDirectory,
  terminalFile,
} from './codex-profile.js';
import type { LocalCliProvider } from './local-cli.js';

export const cliExecutableVersion = z
  .string()
  .max(40)
  .regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const publisher = z.strictObject({
  teamId: z.string().regex(/^[A-Z0-9]{10}$/),
  identifier: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9._-]+$/),
  notarized: z.boolean(),
});
const review = z.strictObject({
  path: z
    .string()
    .min(2)
    .max(2048)
    .startsWith('/')
    .refine((path) => !path.includes('\0')),
  sha256,
  version: cliExecutableVersion,
  source: z.enum(['packaged_pin', 'signature_continuity', 'native_review']),
  signature: publisher.optional(),
  previousSha256: sha256.optional(),
});
export type CliExecutableReview = z.infer<typeof review>;
export type CliSignature = z.infer<typeof publisher>;
type Binary = Pick<CliExecutableReview, 'path' | 'sha256'>;

export const cliPublisherIdentities = {
  codex: { teamId: '2DC432GLL2', identifier: 'codex' },
  claude: { teamId: 'Q6L2SF6YDW', identifier: 'com.anthropic.claude-code' },
  opencode: { teamId: '5NZ4Q7NXJ4', identifier: 'opencode' },
  antigravity: { teamId: 'EQHXZ8M8AV', identifier: 'cli' },
} as const;

export function signatureContinuity(
  previous: CliExecutableReview,
  candidate: Binary,
  signature: CliSignature | undefined,
): boolean {
  return (
    candidate.path === previous.path &&
    candidate.sha256 !== previous.sha256 &&
    !!signature &&
    signature.teamId === previous.signature?.teamId &&
    signature.identifier === previous.signature.identifier &&
    (!previous.signature.notarized || signature.notarized)
  );
}

function identity(path: string) {
  if (realpathSync(path) !== path) throw new Error('CLI install path is no longer canonical');
  const file = lstatSync(path, { bigint: true });
  return [
    file.dev,
    file.ino,
    file.birthtimeNs,
    file.size,
    file.mtimeNs,
    file.ctimeNs,
    file.mode,
    file.uid,
    file.gid,
  ].join(':');
}

/** Fixed system tool and certificate requirement. The CLI itself is never run here. */
export function inspectCliSignature(
  provider: LocalCliProvider,
  binary: Binary,
  checkNotarization: boolean,
): CliSignature | undefined {
  if (process.platform !== 'darwin') return;
  const { teamId, identifier } = cliPublisherIdentities[provider];
  const before = identity(binary.path);
  if (cachedTerminalExecutableSha256(binary.path) !== binary.sha256) return;
  const run = (args: string[]) =>
    spawnSync('/usr/bin/codesign', [...args, '--', binary.path], {
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 6000,
      maxBuffer: 16 * 1024,
    });
  const display = run(['--display', '--verbose=4']);
  if (display.status !== 0 || display.error || display.stdout) return;
  const fields = display.stderr.split('\n');
  const matches = (key: string, expected: string) => {
    const values = fields.filter((line) => line.startsWith(key + '='));
    return values.length === 1 && values[0] === `${key}=${expected}`;
  };
  if (!matches('TeamIdentifier', teamId) || !matches('Identifier', identifier)) return;
  const requirement =
    'anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists ' +
    'and certificate leaf[field.1.2.840.113635.100.6.1.13] exists ' +
    `and certificate leaf[subject.OU] = "${teamId}" and identifier "${identifier}"`;
  const verify = (requirement: string) =>
    run(['--verify', '--strict', '--all-architectures', '-R=' + requirement]).status === 0;
  if (!verify(requirement)) return;
  const notarized = checkNotarization && verify(requirement + ' and notarized');
  if (
    before !== identity(binary.path) ||
    cachedTerminalExecutableSha256(binary.path) !== binary.sha256
  )
    return;
  return { teamId, identifier, notarized };
}

function directory(preferences: string) {
  terminalDirectory(preferences, true);
  return join(preferences, 'cli-executable-reviews');
}

export function readCliExecutableReview(preferences: string, provider: LocalCliProvider) {
  const root = directory(preferences);
  const file = join(root, provider + '.json');
  try {
    terminalDirectory(root, true);
    const metadata = lstatSync(file, { bigint: true });
    if (metadata.nlink !== 1n) throw new Error('Linked CLI review');
    return review.parse(JSON.parse(terminalFile(file, true, 4096, metadata).toString('utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** Native preparation only, after the current document commits the exact candidate. */
export function publishCliExecutableReview(
  preferences: string,
  provider: LocalCliProvider,
  previous: CliExecutableReview | undefined,
  next: CliExecutableReview,
) {
  const root = directory(preferences);
  try {
    mkdirSync(root, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  terminalDirectory(root, true);
  const file = join(root, provider + '.json');
  const lock = file + '.lock';
  const fd = openSync(
    lock,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  const temporary = join(root, randomUUID() + '.tmp');
  let created = false;
  try {
    if (JSON.stringify(readCliExecutableReview(preferences, provider)) !== JSON.stringify(previous))
      throw new Error('CLI review changed');
    if (cachedTerminalExecutableSha256(next.path) !== next.sha256)
      throw new Error('CLI changed during review');
    const out = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    created = true;
    try {
      writeFileSync(out, JSON.stringify(review.parse(next)) + '\n');
      fsyncSync(out);
    } finally {
      closeSync(out);
    }
    renameSync(temporary, file);
    created = false;
  } finally {
    closeSync(fd);
    try {
      if (created) unlinkSync(temporary);
    } finally {
      unlinkSync(lock);
    }
  }
}

/** Revalidate a native review at profile boundaries. Existing launch/grant checks still hash bytes. */
export function hasCliExecutableReview(
  provider: LocalCliProvider,
  config: {
    executable: Binary;
    executableVersion: string;
    preparation?: { preferencesDirectory: string };
  },
): boolean {
  if (!config.preparation) return false;
  const current = readCliExecutableReview(config.preparation.preferencesDirectory, provider);
  if (
    current?.path !== config.executable.path ||
    current.sha256 !== config.executable.sha256 ||
    current.version !== config.executableVersion
  )
    return false;
  if (current.source === 'native_review') return true;
  if (current.source !== 'signature_continuity' || !current.signature || !current.previousSha256)
    return false;
  const signature = inspectCliSignature(provider, current, current.signature.notarized);
  return (
    signature?.teamId === current.signature.teamId &&
    signature.identifier === current.signature.identifier &&
    (!current.signature.notarized || signature.notarized)
  );
}
