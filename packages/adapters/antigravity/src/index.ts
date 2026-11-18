import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'chokidar';
import { type AdapterDescriptor, type Snapshot, type StoredEvent } from '@orqst/protocol';
import type { Store } from '@orqst/database';
import {
  normalizeMetadataUpdate,
  normalizeRecord,
  parseConversationMetadata,
  sessionIdFromSourceFile,
  type AntigravitySessionMetadata,
  type AntigravityState,
  type SourceRecord,
} from './normalize.js';

export {
  normalizeMetadataUpdate,
  normalizeRecord,
  parseConversationMetadata,
  sessionIdFromSourceFile,
  type AntigravitySessionMetadata,
  type AntigravityState,
  type SourceRecord,
} from './normalize.js';

export const antigravityDescriptor: AdapterDescriptor = {
  id: 'antigravity',
  implemented: true,
  capabilities: {
    sessionDiscovery: true,
    realtimeEvents: true,
    messages: true,
    toolCalls: true,
    subagents: false,
    tokenUsage: false,
    taskResults: true,
    userIntervention: false,
    remoteControl: false,
  },
  evidence:
    'Local Antigravity CLI (agy, language server 1.5.10) brain/<id>/.system_generated/logs/transcript_full.jsonl and cache/conversation_metadata.json inspected. Per-step token counters have no cumulative session snapshot or plan/quota evidence; parent session links are absent from JSONL; ask_question intervention, failure and interruption paths are fixture-tested only. See docs/adapters/antigravity.md.',
};

const hash = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
const MAX_LINE = 2 * 1024 * 1024;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;

interface MetadataSnapshot {
  entries: Map<string, AntigravitySessionMetadata>;
  source: SourceRecord;
}

export interface AntigravityObserverOptions {
  root: string;
  store: Store;
  pollMs?: number;
  initialScanInBackground?: boolean;
  onEvent?: (event: StoredEvent, live: boolean) => void;
}

export class AntigravityObserver {
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
  private lastMalformedMetadataHash = '';
  private lastOversizedMetadataKey = '';

  constructor(private options: AntigravityObserverOptions) {
    this.root = resolve(options.root);
  }

  async start(): Promise<void> {
    const initialScan = this.scan();
    if (!this.options.initialScanInBackground) await initialScan;
    if (this.stopped) return;
    this.watcher = watch(this.root, {
      ignoreInitial: true,
      followSymlinks: false,
      depth: 4,
      ignored: (watchedPath: string) => {
        const rel = relative(this.root, resolve(watchedPath)).split(sep).join('/');
        if (!rel || rel === '.') return false;
        if (rel === 'brain' || rel.startsWith('brain/')) return false;
        if (rel === 'cache' || rel === 'cache/conversation_metadata.json') return false;
        return true;
      },
    });
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

  private async isSafeSubdir(path: string): Promise<boolean> {
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isDirectory()) return false;
      const canonical = await realpath(path);
      if (!canonical.startsWith(this.rootReal + sep)) {
        this.diagnostics.skipped++;
        return false;
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.diagnostics.errors++;
      return false;
    }
  }

  private async readMetadata(): Promise<MetadataSnapshot | undefined> {
    const cacheDir = join(this.root, 'cache');
    if (!(await this.isSafeSubdir(cacheDir))) return undefined;
    const file = join(cacheDir, 'conversation_metadata.json');
    try {
      const info = await lstat(file);
      if (info.isSymbolicLink() || !info.isFile()) return undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.diagnostics.errors++;
      return undefined;
    }
    const canonical = await realpath(file);
    if (!canonical.startsWith(this.rootReal + sep)) {
      this.diagnostics.skipped++;
      return undefined;
    }
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return undefined;
      if (stat.size > MAX_METADATA_BYTES) {
        const key = `${stat.dev}:${stat.ino}:${stat.size}`;
        if (this.lastOversizedMetadataKey !== key) {
          this.lastOversizedMetadataKey = key;
          this.diagnostics.oversized++;
        }
        return undefined;
      }
      if (stat.size === 0) return undefined;
      const buffer = Buffer.alloc(stat.size);
      let readOffset = 0;
      while (readOffset < stat.size) {
        const { bytesRead } = await handle.read(
          buffer,
          readOffset,
          stat.size - readOffset,
          readOffset,
        );
        if (!bytesRead) break;
        readOffset += bytesRead;
      }
      const slice = buffer.subarray(0, readOffset);
      const digest = hash(slice);
      let parsed: unknown;
      try {
        parsed = JSON.parse(slice.toString('utf8'));
      } catch {
        if (this.lastMalformedMetadataHash !== digest) {
          this.lastMalformedMetadataHash = digest;
          this.diagnostics.malformed++;
        }
        return undefined;
      }
      return {
        entries: parseConversationMetadata(parsed),
        source: {
          file: 'cache/conversation_metadata.json',
          offset: 0,
          line: 1,
          hash: digest,
        },
      };
    } finally {
      await handle.close();
    }
  }

  private async discoverTranscripts(): Promise<string[]> {
    const brainDir = join(this.root, 'brain');
    if (!(await this.isSafeSubdir(brainDir))) return [];
    const files: string[] = [];
    for (const sessionEntry of await readdir(brainDir, { withFileTypes: true })) {
      if (sessionEntry.isSymbolicLink() || !sessionEntry.isDirectory()) continue;
      const sessionDir = join(brainDir, sessionEntry.name);
      const sysDir = join(sessionDir, '.system_generated');
      const logsDir = join(sysDir, 'logs');
      if (
        !(await this.isSafeSubdir(sessionDir)) ||
        !(await this.isSafeSubdir(sysDir)) ||
        !(await this.isSafeSubdir(logsDir))
      )
        continue;
      const logEntries = await readdir(logsDir, { withFileTypes: true });
      const hasFull = logEntries.some(
        (entry) =>
          !entry.isSymbolicLink() && entry.isFile() && entry.name === 'transcript_full.jsonl',
      );
      const hasCompact = logEntries.some(
        (entry) => !entry.isSymbolicLink() && entry.isFile() && entry.name === 'transcript.jsonl',
      );
      if (hasFull) files.push(join(logsDir, 'transcript_full.jsonl'));
      else if (hasCompact) files.push(join(logsDir, 'transcript.jsonl'));
    }
    return files.sort();
  }

  private isLiveTimestamp(timestamp: string): boolean {
    const parsed = Date.parse(timestamp);
    return (
      this.initialized &&
      !this.firstScan &&
      Date.now() - parsed < 60000 &&
      parsed <= Date.now() + 5000
    );
  }

  private async scanFiles(): Promise<void> {
    this.diagnostics.scanning = true;
    try {
      this.rootReal = await realpath(this.root);
      const metadata = await this.readMetadata();
      const files = await this.discoverTranscripts();
      this.diagnostics.files = files.length;
      for (const file of files) {
        if (this.stopped) break;
        try {
          await this.read(file, metadata);
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

  private async read(file: string, metadataSnapshot?: MetadataSnapshot): Promise<void> {
    const canonical = await realpath(file);
    if (!canonical.startsWith(this.rootReal + sep)) {
      this.diagnostics.skipped++;
      return;
    }
    const sourceFile = relative(this.root, file).split(sep).join('/');
    const sessionId = sessionIdFromSourceFile(sourceFile);
    if (!sessionId) return;
    const sessionMetadata = metadataSnapshot?.entries.get(sessionId);
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
      const state: AntigravityState = checkpoint
        ? (JSON.parse(checkpoint.state) as AntigravityState)
        : {};
      if (offset === stat.size) {
        if (checkpoint && metadataSnapshot && sessionMetadata) {
          const updates = normalizeMetadataUpdate(
            state,
            sessionMetadata,
            metadataSnapshot.source,
            this.options.store.machineId,
          );
          if (updates.length > 0) {
            const dispatched: { event: StoredEvent; live: boolean }[] = [];
            for (const event of updates) {
              const live = this.isLiveTimestamp(event.timestamp);
              const stored = this.options.store.ingest(event, live);
              if (stored) dispatched.push({ event: stored, live });
            }
            this.options.store.saveCheckpoint(sourceKey, {
              offset: checkpoint.offset,
              line: checkpoint.line,
              identity,
              anchor: checkpoint.anchor,
              state: JSON.stringify(state),
            });
            for (const item of dispatched) this.options.onEvent?.(item.event, item.live);
          }
        }
        return;
      }
      const chunk = Buffer.alloc(128 * 1024);
      let pending = Buffer.alloc(0),
        pendingStart = offset,
        discarding = false;
      let committedOffset = checkpoint?.offset ?? 0;
      let lastAnchor = checkpoint?.anchor ?? '';
      // Fixed per-file budget keeps a large history from starving active sessions.
      const until = Math.min(stat.size, offset + 8 * 1024 * 1024);
      let staged: { event: StoredEvent; live: boolean }[] = [];
      const commit = async (): Promise<void> => {
        if (pendingStart <= committedOffset) return;
        const anchor = Buffer.alloc(Math.min(64, pendingStart));
        await handle.read(anchor, 0, anchor.length, pendingStart - anchor.length);
        lastAnchor = hash(anchor);
        committedOffset = pendingStart;
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
              sessionMetadata,
            );
            for (const event of events) {
              const live = this.isLiveTimestamp(event.timestamp);
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
