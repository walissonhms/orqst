import { constants } from 'node:fs';
import { open, readdir, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'chokidar';
import { type AdapterDescriptor, type StoredEvent, type Snapshot } from '@orqst/protocol';
import type { Store } from '@orqst/database';
import { normalizeRecord, type CodexState } from './normalize.js';
export { normalizeRecord, type CodexState } from './normalize.js';

export const codexDescriptor: AdapterDescriptor = {
  id: 'codex',
  implemented: true,
  capabilities: {
    sessionDiscovery: true,
    realtimeEvents: true,
    messages: true,
    toolCalls: true,
    subagents: true,
    tokenUsage: true,
    taskResults: true,
    userIntervention: false,
    remoteControl: false,
  },
  evidence:
    'Local Codex 0.162.1 JSONL inspected. Explicit parent_thread_id/thread_spawn only; Intervention mapping is fixture-tested only; no direct request_user_input record was found in the real sample. Failure/interruption mappings are fixture-tested compatibility paths. See docs/adapters/codex.md.',
};
const hash = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
const MAX_LINE = 2 * 1024 * 1024;
export interface CodexObserverOptions {
  root: string;
  store: Store;
  pollMs?: number;
  onEvent?: (event: StoredEvent, live: boolean) => void;
}
export class CodexObserver {
  readonly diagnostics: Snapshot['diagnostics'] = {
    files: 0,
    malformed: 0,
    skipped: 0,
    oversized: 0,
    errors: 0,
    lastScan: null,
    scanning: false,
  };
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private stopped = false;
  private root: string;
  private rootReal = '';
  private initialized = false;
  private firstScan = true;
  constructor(private options: CodexObserverOptions) {
    this.root = resolve(options.root);
  }
  async start(): Promise<void> {
    await this.scan();
    if (this.stopped) return;
    this.watcher = watch(this.root, { ignoreInitial: true, followSymlinks: false, depth: 5 });
    this.watcher.on('all', () => {
      void this.scan();
    });
    this.watcher.on('error', () => {
      this.diagnostics.errors++;
    });
    this.timer = setInterval(() => {
      void this.scan();
    }, this.options.pollMs ?? 3000);
  }
  scan(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.active) return this.active;
    this.active = this.scanFiles().finally(() => {
      this.active = undefined;
    });
    return this.active;
  }
  private async scanFiles(): Promise<void> {
    this.diagnostics.scanning = true;
    try {
      this.rootReal = await realpath(this.root);
      const files: string[] = [];
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > 5) return;
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) continue;
          const path = resolve(dir, entry.name);
          if (entry.isDirectory()) await walk(path, depth + 1);
          else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
        }
      };
      await walk(this.root, 0);
      this.diagnostics.files = files.length;
      for (const file of files.sort()) {
        if (this.stopped) break;
        try {
          await this.read(file);
        } catch {
          this.diagnostics.errors++;
        }
      }
      this.initialized = true;
      this.firstScan = false;
      this.diagnostics.lastScan = new Date().toISOString();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.diagnostics.errors++;
    } finally {
      this.diagnostics.scanning = false;
    }
  }
  private async read(file: string): Promise<void> {
    const canonical = await realpath(file);
    if (!canonical.startsWith(this.rootReal + sep)) {
      this.diagnostics.skipped++;
      return;
    }
    const sourceFile = relative(this.root, file).split(sep).join('/');
    const sourceKey = this.root + ':' + sourceFile;
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return;
      const identity = `${stat.dev}:${stat.ino}`;
      let checkpoint = this.options.store.checkpoint(sourceKey);
      let reset = !checkpoint || checkpoint.identity !== identity || checkpoint.offset > stat.size;
      if (!reset && checkpoint && checkpoint.offset > 0) {
        const buffer = Buffer.alloc(Math.min(64, checkpoint.offset));
        await handle.read(buffer, 0, buffer.length, checkpoint.offset - buffer.length);
        if (hash(buffer) !== checkpoint.anchor) reset = true;
      }
      if (reset) checkpoint = undefined;
      let offset = checkpoint?.offset ?? 0,
        lineNumber = checkpoint?.line ?? 0;
      const state: CodexState = checkpoint ? (JSON.parse(checkpoint.state) as CodexState) : {};
      if (offset === stat.size) return;
      const chunk = Buffer.alloc(128 * 1024);
      let pending = Buffer.alloc(0),
        pendingStart = offset,
        discarding = false;
      let lastAnchor = checkpoint?.anchor ?? '';
      // Fixed per-file budget keeps a large history from starving active sessions.
      const until = Math.min(stat.size, offset + 8 * 1024 * 1024);
      let staged: { event: StoredEvent; live: boolean }[] = [];
      const commit = async (): Promise<void> => {
        if (pendingStart <= (checkpoint?.offset ?? 0)) return;
        const anchor = Buffer.alloc(Math.min(64, pendingStart));
        await handle.read(anchor, 0, anchor.length, pendingStart - anchor.length);
        lastAnchor = hash(anchor);
        this.options.store.saveCheckpoint(sourceKey, {
          offset: pendingStart,
          line: lineNumber,
          identity,
          anchor: lastAnchor,
          state: JSON.stringify(state),
        });
        for (const item of staged) this.options.onEvent?.(item.event, item.live);
        staged = [];
      };
      while ((offset < until || discarding) && offset < stat.size && !this.stopped) {
        const { bytesRead } = await handle.read(
          chunk,
          0,
          Math.min(chunk.length, stat.size - offset, discarding ? chunk.length : until - offset),
          offset,
        );
        if (!bytesRead) break;
        offset += bytesRead;
        const data = chunk.subarray(0, bytesRead);
        pending = Buffer.concat([pending, data]);
        let start = 0;
        for (let index = pending.indexOf(10); index >= 0; index = pending.indexOf(10, start)) {
          const bytes = pending.subarray(start, index);
          const recordOffset = pendingStart;
          pendingStart += bytes.length + 1;
          lineNumber++;
          if (discarding || bytes.length > MAX_LINE) {
            this.diagnostics.oversized++;
            discarding = false;
          } else if (bytes.length) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(bytes.toString('utf8'));
            } catch {
              this.diagnostics.malformed++;
              start = index + 1;
              continue;
            }
            const events = normalizeRecord(
              parsed,
              state,
              { file: sourceFile, offset: recordOffset, line: lineNumber, hash: hash(bytes) },
              this.options.store.machineId,
            );
            for (const event of events) {
              const live =
                this.initialized &&
                !this.firstScan &&
                Date.now() - Date.parse(event.timestamp) < 60000 &&
                Date.parse(event.timestamp) <= Date.now() + 5000;
              const stored = this.options.store.ingest(event, live);
              if (stored) staged.push({ event: stored, live });
            }
          }
          start = index + 1;
        }
        pending = Buffer.from(pending.subarray(start));
        if (pending.length > MAX_LINE) {
          discarding = true;
          pendingStart += pending.length;
          pending = Buffer.alloc(0);
        }
        // Do not checkpoint while discarding an unfinished oversized line.
        if (!discarding) await commit();
      }
    } finally {
      await handle.close();
    }
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.watcher?.close();
    await this.active;
  }
}
