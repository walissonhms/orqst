import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  realpathSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { terminalDigest } from './authority.js';
import { terminalDirectory, terminalExecutableSha256, terminalFile } from './codex-profile.js';
import type { TerminalProfile } from './supervisor.js';
import { findCliContract, type CliContractMode, type CliContractProvider } from './cli-contract.js';
import {
  verifiedCliSignature,
  type CliSignatureEvidence,
  type CliSignatureVerifier,
} from './cli-signature.js';

export type TerminalCliAuthorizationState = 'allowed' | 'blocked' | 'revoked' | 'stale';
export interface TerminalCliAuthorization<Document extends object> {
  authorizeCli(
    document: Document,
    profile: Readonly<TerminalProfile>,
  ): Promise<TerminalCliAuthorizationState>;
  current(document: Document, profile: Readonly<TerminalProfile>): TerminalCliAuthorizationState;
  epoch(profile: Readonly<TerminalProfile>): string | undefined;
}

const legacyRecordSchema = z.strictObject({
  version: z.literal(1),
  scope: z.literal('owned-local-terminal-v1'),
  executable: z.string().min(1).max(2048),
  executableSha256: z.string().regex(/^[a-f0-9]{64}$/),
  authorizationEpoch: z.uuid(),
  permissionScope: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['allowed', 'revoked']),
});
const verifiedRecordSchema = legacyRecordSchema.extend({
  version: z.literal(2),
  provider: z.enum(['codex', 'claude', 'opencode']),
  mode: z.enum(['tui', 'mcp']),
  executableVersion: z.string().min(1).max(64),
  contractRevision: z.string().min(1).max(128),
  environmentProfile: z.string().min(1).max(2048),
  cliAuthorizationScope: z.string().min(1).max(2048),
  signature: z.strictObject({
    valid: z.literal(true),
    teamId: z.string().min(1).max(64),
    identifier: z.string().min(1).max(256),
  }),
});
const recordSchema = z.discriminatedUnion('version', [legacyRecordSchema, verifiedRecordSchema]);
type Record = z.infer<typeof recordSchema>;
export interface TerminalCliEvidence {
  provider: CliContractProvider;
  mode: CliContractMode;
  version: string;
  contractRevision: string;
  sha256: string;
  signature: CliSignatureEvidence;
}
export interface TerminalCliReview {
  previous: Record | undefined;
  candidate: TerminalCliEvidence & {
    executable: string;
    permissionScope: string;
    environmentProfile: string;
    cliAuthorizationScope: string;
    authorizationEpoch: string;
  };
  expectedEpoch?: string;
}

const permissionScope = (profile: Readonly<TerminalProfile>) =>
  terminalDigest(JSON.stringify([profile.environmentProfile, profile.cliAuthorizationScope]));

/** Native host only. Durable CLI policy is not a restored process/session capability. */
export class TerminalCliPolicyStore {
  private static readonly pendingVerified = new Map<string, Promise<void>>();
  private readonly directory: string;
  private readonly parent: string;
  // Volatile file identity avoids hashing a large native binary on every keystroke.
  // It is never persisted, never substitutes for the initial hash, and changes fail closed.
  private readonly inspected = new Map<string, string>();

  constructor(directory: string) {
    if (!isAbsolute(directory) || join(dirname(directory), basename(directory)) !== directory)
      throw new Error('Noncanonical CLI policy parent');
    this.parent = directory;
    this.directory = join(directory, 'cli-authorizations');
    this.directoryPresent();
  }

  private directoryPresent(): boolean {
    try {
      terminalDirectory(this.parent, true);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      terminalDirectory(dirname(this.parent), true);
      return false;
    }
    try {
      terminalDirectory(this.directory, true);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private file(profile: Readonly<TerminalProfile>): string {
    this.directoryPresent();
    return join(this.directory, `${terminalDigest(profile.executable)}.json`);
  }

  private loadSnapshot(profile: Readonly<TerminalProfile>): {
    record: Record | undefined;
    revision: number;
  } {
    const base = this.file(profile);
    if (!this.directoryPresent()) return { record: undefined, revision: 0 };
    const prefix = `${terminalDigest(profile.executable)}.rev-`;
    const names = readdirSync(this.directory).filter((name) => name.startsWith(prefix));
    if (names.length > 4096) throw new Error('Too many CLI policy revisions');
    const revisions = names.map((name) => {
      const suffix = name.slice(prefix.length);
      if (!/^[1-9][0-9]{0,14}$/.test(suffix)) throw new Error('Invalid CLI policy revision');
      const value = Number(suffix);
      if (!Number.isSafeInteger(value)) throw new Error('Invalid CLI policy revision');
      return value;
    });
    const revision = Math.max(0, ...revisions);
    if (revision !== revisions.length) throw new Error('CLI policy revision gap');
    const file = revision ? join(this.directory, `${prefix}${revision}`) : base;
    try {
      if (lstatSync(file).nlink !== 1) throw new Error('Linked CLI policy');
      const value = recordSchema.parse(JSON.parse(terminalFile(file, true, 4096).toString('utf8')));
      if (value.executable !== profile.executable) throw new Error('CLI policy identity mismatch');
      if (
        value.version === 2 &&
        terminalDigest(JSON.stringify([value.environmentProfile, value.cliAuthorizationScope])) !==
          value.permissionScope
      )
        throw new Error('CLI policy scope mismatch');
      return { record: value, revision };
    } catch (error) {
      if (!revision && (error as NodeJS.ErrnoException).code === 'ENOENT')
        return { record: undefined, revision: 0 };
      throw error;
    }
  }

  private load(profile: Readonly<TerminalProfile>): Record | undefined {
    return this.loadSnapshot(profile).record;
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
      if (!record || record.version !== 1) return 'blocked';
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
      const snapshot = this.loadSnapshot(profile);
      const previous = snapshot.record;
      if (previous?.version === 2) return 'blocked';
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
      try {
        const current = this.loadSnapshot(profile);
        if (
          current.revision !== snapshot.revision ||
          JSON.stringify(previous) !== JSON.stringify(current.record)
        )
          return 'stale';
      } catch {
        return 'stale';
      }
      if (
        !this.save(profile, snapshot.revision, {
          version: 1,
          scope: 'owned-local-terminal-v1',
          executable: profile.executable,
          executableSha256: profile.executableSha256,
          authorizationEpoch: randomUUID(),
          permissionScope: permissionScope(profile),
          state: 'allowed',
        })
      )
        return 'stale';
      return this.current(profile);
    } catch {
      return 'revoked';
    }
  }

  /** Versioned authorization path. The verifier and probe must be supplied by the native host. */
  async authorizeVerifiedCli(
    profile: Readonly<TerminalProfile>,
    provider: CliContractProvider,
    mode: CliContractMode,
    verifier: CliSignatureVerifier,
    probe: () => Promise<TerminalCliEvidence>,
    review: (details: TerminalCliReview) => Promise<boolean>,
    expectedEpoch?: string,
  ): Promise<TerminalCliAuthorizationState> {
    let key: string;
    try {
      key = this.file(profile);
    } catch {
      return 'revoked';
    }
    const previous = TerminalCliPolicyStore.pendingVerified.get(key);
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    TerminalCliPolicyStore.pendingVerified.set(key, current);
    try {
      await previous;
      return await this.authorizeVerifiedCliLocked(
        profile,
        provider,
        mode,
        verifier,
        probe,
        review,
        expectedEpoch,
      );
    } finally {
      release();
      if (TerminalCliPolicyStore.pendingVerified.get(key) === current)
        TerminalCliPolicyStore.pendingVerified.delete(key);
    }
  }

  private async authorizeVerifiedCliLocked(
    profile: Readonly<TerminalProfile>,
    provider: CliContractProvider,
    mode: CliContractMode,
    verifier: CliSignatureVerifier,
    probe: () => Promise<TerminalCliEvidence>,
    review: (details: TerminalCliReview) => Promise<boolean>,
    expectedEpoch?: string,
  ): Promise<TerminalCliAuthorizationState> {
    try {
      if (!profile.cliAuthorizationScope) return 'blocked';
      const snapshot = this.loadSnapshot(profile);
      const previous = snapshot.record;
      const signature = await verifiedCliSignature(verifier, provider, profile.executable);
      this.inspect(profile);
      const stable = this.identity(profile);
      const matches =
        previous?.version === 2 &&
        previous.state === 'allowed' &&
        previous.provider === provider &&
        previous.mode === mode &&
        previous.executableSha256 === profile.executableSha256 &&
        previous.executableVersion === profile.executableVersion &&
        previous.permissionScope === permissionScope(profile) &&
        previous.contractRevision ===
          findCliContract(provider, mode, profile.executableVersion)?.revision &&
        JSON.stringify(previous.signature) === JSON.stringify(signature) &&
        (expectedEpoch === undefined || expectedEpoch === previous.authorizationEpoch);
      if (matches) return 'allowed';
      const evidence = await probe();
      const contract = findCliContract(provider, mode, evidence.version);
      if (
        !contract ||
        evidence.provider !== provider ||
        evidence.mode !== mode ||
        evidence.version !== profile.executableVersion ||
        evidence.contractRevision !== contract.revision ||
        evidence.sha256 !== profile.executableSha256 ||
        JSON.stringify(evidence.signature) !== JSON.stringify(signature) ||
        stable !== this.identity(profile)
      )
        return 'revoked';
      const candidate = {
        ...evidence,
        executable: profile.executable,
        permissionScope: permissionScope(profile),
        environmentProfile: profile.environmentProfile,
        cliAuthorizationScope: profile.cliAuthorizationScope,
        authorizationEpoch: randomUUID(),
      };
      if (!(await review({ previous, candidate, ...(expectedEpoch ? { expectedEpoch } : {}) })))
        return 'blocked';
      const verified = await verifiedCliSignature(verifier, provider, profile.executable);
      this.inspect(profile);
      if (
        stable !== this.identity(profile) ||
        JSON.stringify(verified) !== JSON.stringify(signature)
      )
        return 'revoked';
      try {
        const current = this.loadSnapshot(profile);
        if (
          current.revision !== snapshot.revision ||
          JSON.stringify(previous) !== JSON.stringify(current.record)
        )
          return 'stale';
      } catch {
        return 'stale';
      }
      if (
        !this.save(profile, snapshot.revision, {
          version: 2,
          scope: 'owned-local-terminal-v1',
          executable: profile.executable,
          executableSha256: profile.executableSha256,
          authorizationEpoch: candidate.authorizationEpoch,
          permissionScope: permissionScope(profile),
          state: 'allowed',
          environmentProfile: profile.environmentProfile,
          cliAuthorizationScope: profile.cliAuthorizationScope,
          provider,
          mode,
          executableVersion: evidence.version,
          contractRevision: contract.revision,
          signature: { valid: true, teamId: signature.teamId, identifier: signature.identifier },
        })
      )
        return 'stale';
      return 'allowed';
    } catch {
      return 'revoked';
    }
  }

  /** A candidate version only; it grants nothing without verifiedEpoch. */
  candidateVersion(
    profile: Readonly<TerminalProfile>,
    provider: CliContractProvider,
    mode: CliContractMode,
  ): string | undefined {
    try {
      const record = this.load(profile);
      return record?.version === 2 && record.provider === provider && record.mode === mode
        ? record.executableVersion
        : undefined;
    } catch {
      return;
    }
  }

  /** Synchronous continuity check for input leases after native signature verification. */
  currentVerified(
    profile: Readonly<TerminalProfile>,
    provider: CliContractProvider,
    mode: CliContractMode,
  ): TerminalCliAuthorizationState {
    try {
      const record = this.load(profile);
      if (!record || record.version !== 2) return 'blocked';
      if (record.state !== 'allowed') return 'revoked';
      if (
        record.provider !== provider ||
        record.mode !== mode ||
        record.executableSha256 !== profile.executableSha256 ||
        record.executableVersion !== profile.executableVersion ||
        record.permissionScope !== permissionScope(profile) ||
        record.contractRevision !==
          findCliContract(provider, mode, profile.executableVersion)?.revision
      )
        return 'blocked';
      const key = `${profile.executable}:${profile.executableSha256}`;
      return this.inspected.get(key) === this.identity(profile) ? 'allowed' : 'revoked';
    } catch {
      return 'revoked';
    }
  }

  cachedVerifiedEpoch(
    profile: Readonly<TerminalProfile>,
    provider: CliContractProvider,
    mode: CliContractMode,
  ): string | undefined {
    try {
      return this.currentVerified(profile, provider, mode) === 'allowed'
        ? this.load(profile)?.authorizationEpoch
        : undefined;
    } catch {
      return;
    }
  }

  async verifiedEpoch(
    profile: Readonly<TerminalProfile>,
    provider: CliContractProvider,
    mode: CliContractMode,
    verifier: CliSignatureVerifier,
  ): Promise<string | undefined> {
    try {
      const record = this.load(profile);
      if (
        !record ||
        record.version !== 2 ||
        record.state !== 'allowed' ||
        record.provider !== provider ||
        record.mode !== mode ||
        record.executableVersion !== profile.executableVersion ||
        record.executableSha256 !== profile.executableSha256 ||
        record.permissionScope !== permissionScope(profile) ||
        record.contractRevision !==
          findCliContract(provider, mode, profile.executableVersion)?.revision
      )
        return;
      const signature = await verifiedCliSignature(verifier, provider, profile.executable);
      this.inspect(profile);
      if (
        JSON.stringify(signature) !== JSON.stringify(record.signature) ||
        JSON.stringify(record) !== JSON.stringify(this.load(profile))
      )
        return;
      return record.authorizationEpoch;
    } catch {
      return;
    }
  }

  /** Returns only verified authorization metadata; the local digest stays in the policy store. */
  async verifiedBinding(
    profile: Readonly<TerminalProfile>,
    provider: CliContractProvider,
    mode: CliContractMode,
    verifier: CliSignatureVerifier,
  ) {
    const epoch = await this.verifiedEpoch(profile, provider, mode, verifier);
    if (!epoch) return;
    try {
      const snapshot = this.loadSnapshot(profile);
      const record = snapshot.record;
      if (
        !record ||
        record.version !== 2 ||
        record.state !== 'allowed' ||
        record.authorizationEpoch !== epoch ||
        snapshot.revision < 1
      )
        return;
      return {
        version: 2 as const,
        provider,
        mode,
        teamId: record.signature.teamId,
        identifier: record.signature.identifier,
        contractRevision: record.contractRevision,
        authorizationEpoch: epoch,
        policyRevision: snapshot.revision,
      };
    } catch {
      return;
    }
  }

  revoke(profile: Readonly<TerminalProfile>): void {
    const snapshot = this.loadSnapshot(profile);
    if (!snapshot.record) return;
    if (
      !this.save(profile, snapshot.revision, {
        ...snapshot.record,
        state: 'revoked',
        authorizationEpoch: randomUUID(),
      })
    )
      throw new Error('Stale CLI policy');
  }

  private save(profile: Readonly<TerminalProfile>, revision: number, record: Record): boolean {
    if (revision >= 4096 || !Number.isSafeInteger(revision + 1))
      throw new Error('CLI policy revision exhausted');
    const base = this.file(profile);
    if (!this.directoryPresent()) {
      try {
        mkdirSync(this.parent, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      terminalDirectory(this.parent, true);
      try {
        mkdirSync(this.directory, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    terminalDirectory(this.directory, true);
    const temporary = `${base}.${randomUUID()}.tmp`;
    const target = join(
      this.directory,
      `${terminalDigest(profile.executable)}.rev-${revision + 1}`,
    );
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
      try {
        linkSync(temporary, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
      }
      unlinkSync(temporary);
      const directory = openSync(this.directory, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
      return true;
    } finally {
      try {
        unlinkSync(temporary);
      } catch {
        /* A private leftover temporary file grants nothing. */
      }
    }
  }
}
