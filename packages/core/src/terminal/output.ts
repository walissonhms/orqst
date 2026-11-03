/** Inert bytes only. No escape parser, terminal replies, links, clipboard or disk cache. */
export class TerminalOutput {
  private bytes = Buffer.alloc(0);
  private end = 0;

  constructor(private readonly limit = 1024 * 1024) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1024 * 1024)
      throw new Error('Invalid terminal replay limit');
  }

  append(data: Buffer): void {
    if (!Number.isSafeInteger(this.end + data.length)) throw new Error('Terminal cursor exhausted');
    this.end += data.length;
    this.bytes =
      data.length >= this.limit
        ? Buffer.from(data.subarray(-this.limit))
        : Buffer.concat([
            this.bytes.subarray(Math.max(0, this.bytes.length + data.length - this.limit)),
            data,
          ]);
  }

  read(cursor: number): { bytes: Buffer; nextCursor: number; gap: boolean } {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.end)
      throw new Error('Invalid terminal output cursor');
    const start = this.end - this.bytes.length;
    const offset = Math.max(start, cursor);
    const bytes = Buffer.from(this.bytes.subarray(offset - start, offset - start + 64 * 1024));
    return { bytes, nextCursor: offset + bytes.length, gap: cursor < start };
  }
}
