import { terminalSlotLimit } from '@orqst/protocol';
import { lstatSync } from 'node:fs';
import { terminalDigest } from '../../../packages/core/src/terminal/authority.js';
import { terminalFile } from '../../../packages/core/src/terminal/codex-profile.js';
import { inspectManagedTerminalFiles } from '../../../packages/core/src/terminal/managed-files.js';

/** Main-process evidence only: no admission/Core path entered and partial views cleaned up. */
export class TerminalPreCoreFailure extends Error {}

/** Native-selected files only. Inspection never opens a journal, native DB or provider. */
export function inspectTerminalSelection(files: readonly string[], limit?: number) {
  terminalSlotLimit(limit);
  const sources = files.map((file) => terminalDigest(terminalFile(file, true)));
  const selection = inspectManagedTerminalFiles(files, limit);
  const identities = (path: string) => {
    const info = lstatSync(path);
    return { device: info.dev, inode: info.ino };
  };
  const slots = selection.map(({ config, blocker }, slot) => {
    const file = files[slot]!;
    if (sources[slot] !== terminalDigest(terminalFile(file, true)))
      throw new Error('Manifest changed during inspection');
    return {
      slot: String.fromCharCode(65 + slot),
      file,
      sha256: sources[slot],
      manifestIdentity: identities(file),
      stateIdentity: identities(config.state),
      blocker: blocker ?? null,
      config,
    };
  });
  const snapshot = JSON.stringify(slots);
  // Display the entire selection, including flags/identity, without invisible format controls.
  const formatted = JSON.stringify(slots, null, 2);
  const detail = (formatted.length <= 4096 ? formatted : snapshot).replace(
    /\p{Cf}/gu,
    (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`,
  );
  const pages =
    detail.length <= 4096
      ? [detail]
      : slots.map((slot) =>
          JSON.stringify([slot]).replace(
            /\p{Cf}/gu,
            (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`,
          ),
        );
  if (pages.some((page) => page.length > 4096))
    throw new Error('Terminal selection too large for native review');
  return {
    snapshot,
    detail,
    pages,
    launchUnavailable: slots.some((slot) => slot.blocker === 'launch_unavailable'),
  };
}

/** In-memory review is separate from opening the existing, single Desktop pair. */
export class TerminalSelection {
  private selection?: { files: string[]; snapshot: string };
  private busy = false;
  private attempted = false;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly limit?: number,
  ) {
    terminalSlotLimit(limit);
  }

  get count(): number {
    return this.selection?.files.length ?? 0;
  }

  get locked(): boolean {
    return this.attempted;
  }

  retryBeforeCore(evidence: TerminalPreCoreFailure): void {
    if (!(evidence instanceof TerminalPreCoreFailure) || !this.attempted || this.busy)
      throw new Error('No proven pre-Core failure');
    this.attempted = false;
    this.selection = undefined; // A fresh explicit review is always required.
  }

  async review(ports: {
    current(): boolean;
    choose(): Promise<string[] | undefined>;
    confirm(detail: string): Promise<boolean>;
  }): Promise<'reviewed' | 'cancelled' | 'denied' | 'busy' | 'launch_unavailable'> {
    if (this.busy) return 'busy';
    if (this.attempted || !ports.current()) return 'denied';
    this.busy = true;
    const expires = this.now() + 60000;
    const current = () => !this.attempted && this.now() < expires && ports.current();
    try {
      const files = await ports.choose();
      if (!current()) return 'denied';
      if (!files) return 'cancelled';
      const inspected = inspectTerminalSelection(files, this.limit);
      if (!current()) return 'denied';
      if (inspected.launchUnavailable) return 'launch_unavailable';
      for (const page of inspected.pages) {
        if (!current()) return 'denied';
        if (!(await ports.confirm(page))) return 'cancelled';
      }
      if (!current()) return 'denied';
      if (inspectTerminalSelection(files, this.limit).snapshot !== inspected.snapshot)
        return 'denied';
      if (!current()) return 'denied';
      this.selection = { files: [...files], snapshot: inspected.snapshot };
      return 'reviewed';
    } catch {
      return 'denied';
    } finally {
      this.busy = false;
    }
  }

  /** Latch before any Core creation, even if opening later fails. Never retry uncertain setup. */
  take(): string[] {
    if (this.busy || this.attempted || !this.selection)
      throw new Error('No available reviewed terminal selection');
    const inspected = inspectTerminalSelection(this.selection.files, this.limit);
    if (inspected.launchUnavailable || inspected.snapshot !== this.selection.snapshot)
      throw new Error('Reviewed selection changed; review again before opening');
    this.attempted = true;
    return [...this.selection.files];
  }
}
