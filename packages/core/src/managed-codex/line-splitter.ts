// Adapted from Anywh BufferLineSplitter (Apache-2.0),
// relay/src/agentHost/lineSplitter.ts, commit 546f189c04415c3c5af5f40e3931a0a90b9aba31.
// Modified by ORQST: bounded bytes, lazy raw lines, pending length and explicit reset;
// no file positions or UTF-8 replacement decoding. See NOTICE and docs/research/reuse-first-audit.md.

/**
 * Private byte framing only. The caller owns session/chunk budgets and strict decoding.
 * Yielded lines may alias the input chunk; copy before retaining them beyond consumption.
 */
export class BoundedLineSplitter {
  private parts: Buffer[] = [];
  private partsLength = 0;

  constructor(private readonly maximumBytes: number) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
      throw new Error('Invalid line byte budget');
  }

  get pendingLength(): number {
    return this.partsLength;
  }

  clear(): void {
    this.parts = [];
    this.partsLength = 0;
  }

  // Drain synchronously without overlapping push/clear calls.
  // Yielding preserves delivery before a later line exceeds its budget.
  *push(chunk: Buffer): Generator<Buffer> {
    let start = 0;
    for (;;) {
      const nl = chunk.indexOf(0x0a, start);
      const end = nl < 0 ? chunk.length : nl;
      const piece = chunk.subarray(start, end);
      if (this.partsLength + piece.length > this.maximumBytes)
        throw new Error('Line byte budget exceeded');
      if (nl < 0) {
        if (piece.length) {
          // Copied: the caller may reuse its read buffer.
          this.parts.push(Buffer.from(piece));
          this.partsLength += piece.length;
        }
        return;
      }
      const bytes = this.partsLength > 0 ? Buffer.concat([...this.parts, piece]) : piece;
      this.clear();
      start = nl + 1;
      yield bytes;
    }
  }
}
