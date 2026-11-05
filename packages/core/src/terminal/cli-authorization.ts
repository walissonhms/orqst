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
import { terminalDigest } from './authority.js';
import { terminalDirectory, terminalExecutableSha256, terminalFile } from './codex-profile.js';
import type { TerminalProfile } from './supervisor.js';

export type TerminalCliAuthorizationState = 'allowed' | 'blocked' | 'revoked';
export interface TerminalCliAuthorization<Document extends object> {
  authorizeCli(
    document: Document,
    profile: Readonly<TerminalProfile>,
  ): Promise<TerminalCliAuthorizationState>;
  current(document: Document, profile: Readonly<TerminalProfile>): TerminalCliAuthorizationState;
  epoch(profile: Readonly<TerminalProfile>): string | undefined;
}

const recordSchema = z.strictObject({
  version: z.literal(1),
  scope: z.literal('owned-local-terminal-v1'),
  executable: z.string().min(1).max(2048),
  executableSha256: z.string().regex(/^[a-f0-9]{64}$/),
  authorizationEpoch: z.uuid(),
  permissionScope: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['allowed', 'revoked']),
});
type Record = z.infer<typeof recordSchema>;
const permissionScope = (profile: Readonly<TerminalProfile>) =>
  terminalDigest(JSON.stringify([profile.environmentProfile, profile.cliAuthorizationScope]));

/** Native host only. Durable CLI policy is not a restored process/session capability. */
export class TerminalCliPolicyStore {
  private readonly directory: string;
  // Volatile file identity avoids hashing a large native binary on every keystroke.
  // It is never persisted, never substitutes for the initial hash, and changes fail closed.
  private readonly inspected = new Map<string, string>();

  constructor(directory: string) {
    terminalDirectory(directory, true);
    this.directory = join(directory, 'cli-authorizations');
    try {
      mkdirSync(this.directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    terminalDirectory(this.directory, true);
  }

  private file(profile: Readonly<TerminalProfile>): string {
    terminalDirectory(this.directory, true);
    return join(this.directory, `${terminalDigest(profile.executable)}.json`);
  }

  private load(profile: Readonly<TerminalProfile>): Record | undefined {
    try {
      const file = this.file(profile);
      if (lstatSync(file).nlink !== 1) throw new Error('Linked CLI policy');
      const value = recordSchema.parse(JSON.parse(terminalFile(file, true, 4096).toString('utf8')));
      if (value.executable !== profile.executable) throw new Error('CLI policy identity mismatch');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }

  private identity(profile: Readonly<TerminalProfile>): string {
    if (realpathSync(profile.executable) !== profile.executable)
      throw new Error('Noncanonical CLI');
    const info = lstatSync(profile.executable, { bigint: true });
    if (
      !info.isFile() ||
      !(info.mode & 0o111n) ||
      info.mode & 0o022n ||
      (info.uid !== 0n && info.uid !== BigInt(process.getuid!()))
    )
      throw new Error('Unsafe CLI');
    return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs, info.mode].join(':');
  }

  private inspect(profile: Readonly<TerminalProfile>): void {
    const before = this.identity(profile);
    if (
      terminalExecutableSha256(profile.executable) !== profile.executableSha256 ||
      before !== this.identity(profile)
    )
      throw new Error('CLI changed');
    this.inspected.set(`${profile.executable}:${profile.executableSha256}`, before);
  }

  current(profile: Readonly<TerminalProfile>): TerminalCliAuthorizationState {
    try {
      if (!profile.cliAuthorizationScope) return 'blocked';
      const record = this.load(profile);
      if (!record) return 'blocked';
      if (record.state === 'revoked' || record.executableSha256 !== profile.executableSha256)
        return 'revoked';
      if (record.permissionScope !== permissionScope(profile)) return 'blocked';
      const key = `${profile.executable}:${profile.executableSha256}`;
      if (this.inspected.get(key) !== this.identity(profile)) this.inspect(profile);
      return this.inspected.get(key) === this.identity(profile) ? 'allowed' : 'revoked';
    } catch {
      return 'revoked';
    }
  }

  epoch(profile: Readonly<TerminalProfile>): string | undefined {
    try {
      return this.current(profile) === 'allowed'
        ? this.load(profile)?.authorizationEpoch
        : undefined;
    } catch {
      return;
    }
  }

  async authorizeCli(
    profile: Readonly<TerminalProfile>,
    review: () => Promise<boolean>,
  ): Promise<TerminalCliAuthorizationState> {
    try {
      if (!profile.cliAuthorizationScope) return 'blocked';
      if (this.current(profile) === 'allowed') return 'allowed';
      const previous = this.load(profile);
      // Revocation and permission expansion require explicit configuration. Opening is not consent to either.
      if (
        previous &&
        (previous.state === 'revoked' || previous.permissionScope !== permissionScope(profile))
      )
        return previous.state === 'revoked' ? 'revoked' : 'blocked';
      this.inspect(profile);
      const identity = this.identity(profile);
      if (!(await review())) return 'blocked';
      if (identity !== this.identity(profile)) return 'revoked';
      // A concurrent policy change must not be overwritten by a stale native review.
      if (JSON.stringify(previous) !== JSON.stringify(this.load(profile))) return 'revoked';
      this.save(profile, {
        version: 1,
        scope: 'owned-local-terminal-v1',
        executable: profile.executable,
        executableSha256: profile.executableSha256,
        authorizationEpoch: randomUUID(),
        permissionScope: permissionScope(profile),
        state: 'allowed',
      });
      return this.current(profile);
    } catch {
      return 'revoked';
    }
  }

  revoke(profile: Readonly<TerminalProfile>): void {
    const record = this.load(profile);
    if (!record) return;
    this.save(profile, { ...record, state: 'revoked', authorizationEpoch: randomUUID() });
  }

  private save(profile: Readonly<TerminalProfile>, record: Record): void {
    const file = this.file(profile);
    // Validate an existing destination before atomic replacement, rejecting links and unsafe ownership.
    this.load(profile);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const fd = openSync(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(fd, JSON.stringify(recordSchema.parse(record)) + '\n');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      terminalDirectory(this.directory, true);
      renameSync(temporary, file);
    } finally {
      try {
        unlinkSync(temporary);
      } catch {
        /* A private leftover temporary file grants nothing. */
      }
    }
  }
}
