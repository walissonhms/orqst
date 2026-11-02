import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  writeSync,
  type BigIntStats,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { artifactTextLimit } from '@orqst/protocol';

function same(a: BigIntStats, b: BigIntStats): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.mode === b.mode &&
    a.nlink === b.nlink &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}
function regular(stat: BigIntStats): void {
  if (
    !stat.isFile() ||
    stat.nlink !== 1n ||
    (stat.mode & 0o111n) !== 0n ||
    stat.size > BigInt(artifactTextLimit)
  )
    throw new Error('Unsafe destination');
}
function bytes(fd: number): Buffer {
  const stat = fstatSync(fd, { bigint: true });
  regular(stat);
  const value = Buffer.alloc(Number(stat.size));
  let offset = 0;
  while (offset < value.length) {
    const count = readSync(fd, value, offset, value.length - offset, offset);
    if (!count) throw new Error('Destination changed');
    offset += count;
  }
  if (!same(stat, fstatSync(fd, { bigint: true }))) throw new Error('Destination changed');
  return value;
}

/** A native-dialog destination, held only in main for this operation; never serialized. */
export class MarkdownDestination {
  readonly path: string;
  readonly exists: boolean;
  private readonly parent: string;
  private readonly parentStat: BigIntStats;
  private fd: number | undefined;
  private snapshot: BigIntStats | undefined;
  private original: Buffer | undefined;
  private closed = false;
  touched = false;

  constructor(selected: string) {
    if (
      !isAbsolute(selected) ||
      Array.from(selected).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      }) ||
      extname(selected) !== '.md'
    )
      throw new Error('Invalid destination');
    this.parent = realpathSync(dirname(selected));
    this.parentStat = lstatSync(this.parent, { bigint: true });
    if (!this.parentStat.isDirectory()) throw new Error('Invalid destination');
    this.path = join(this.parent, basename(selected));
    let stat: BigIntStats;
    try {
      stat = lstatSync(this.path, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.exists = false;
      return;
    }
    regular(stat);
    this.exists = true;
    const fd = openSync(this.path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!same(stat, fstatSync(fd, { bigint: true }))) throw new Error('Destination changed');
      this.original = bytes(fd);
      this.snapshot = fstatSync(fd, { bigint: true });
      this.fd = fd;
      this.check();
    } catch (error) {
      closeSync(fd);
      this.fd = undefined;
      throw error;
    }
  }

  private checkParent(): void {
    const current = lstatSync(this.parent, { bigint: true });
    if (
      realpathSync(this.parent) !== this.parent ||
      !current.isDirectory() ||
      current.dev !== this.parentStat.dev ||
      current.ino !== this.parentStat.ino
    )
      throw new Error('Destination changed');
  }

  private check(): void {
    this.checkParent();
    if (this.fd === undefined || !this.snapshot || !this.original)
      throw new Error('Destination unavailable');
    if (
      !same(this.snapshot, lstatSync(this.path, { bigint: true })) ||
      !same(this.snapshot, fstatSync(this.fd, { bigint: true })) ||
      !this.original.equals(bytes(this.fd))
    )
      throw new Error('Destination changed');
  }

  write(text: string): void {
    if (this.closed || this.touched) throw new Error('Destination unavailable');
    if (
      Buffer.from(text, 'utf8').toString('utf8') !== text ||
      text.includes('\0') ||
      Buffer.byteLength(text) > artifactTextLimit
    )
      throw new Error('Invalid Markdown');
    this.checkParent();
    if (this.exists) this.check();
    else {
      this.fd = openSync(
        this.path,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
        0o600,
      );
      this.touched = true;
      regular(fstatSync(this.fd, { bigint: true }));
      this.checkParent();
      if (!same(lstatSync(this.path, { bigint: true }), fstatSync(this.fd, { bigint: true })))
        throw new Error('Destination changed');
    }
    const fd = this.fd!;
    const value = Buffer.from(text, 'utf8');
    this.touched = true;
    let offset = 0;
    while (offset < value.length) {
      const count = writeSync(fd, value, offset, value.length - offset, offset);
      if (!count) throw new Error('Write incomplete');
      offset += count;
    }
    // Never O_TRUNC: truncate only the verified descriptor after all bytes were written.
    ftruncateSync(fd, value.length);
    fsyncSync(fd);
    this.snapshot = fstatSync(fd, { bigint: true });
    this.original = value;
    this.check();
  }

  verifySaved(): void {
    if (!this.touched) throw new Error('No saved file');
    this.check();
  }

  close(): void {
    this.closed = true;
    if (this.fd !== undefined) closeSync(this.fd);
    this.fd = undefined;
    this.original = undefined;
  }
}
