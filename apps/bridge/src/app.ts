import { AntigravityObserver } from '@orqst/adapter-antigravity';
import { CodexObserver, type CodexObserverOptions } from '@orqst/adapter-codex';
import { ObserverCore } from '@orqst/core';
import type { Snapshot } from '@orqst/protocol';
import type { Config } from './config.js';
import { createLocalServer } from './server.js';

function createBridgeObserver(config: Config, options: CodexObserverOptions) {
  const codex = new CodexObserver(options);
  if (!config.antigravityDir) return codex;
  const antigravity = new AntigravityObserver({
    root: config.antigravityDir,
    store: options.store,
    pollMs: options.pollMs,
    initialScanInBackground: options.initialScanInBackground,
    onEvent: options.onEvent,
  });
  return {
    get diagnostics(): Snapshot['diagnostics'] {
      const a = codex.diagnostics;
      const b = antigravity.diagnostics;
      const lastScan =
        a.lastScan && b.lastScan
          ? a.lastScan >= b.lastScan
            ? a.lastScan
            : b.lastScan
          : (a.lastScan ?? b.lastScan);
      return {
        files: a.files + b.files,
        malformed: a.malformed + b.malformed,
        skipped: a.skipped + b.skipped,
        oversized: a.oversized + b.oversized,
        errors: a.errors + b.errors,
        lastScan,
        scanning: a.scanning || b.scanning,
      };
    },
    async start(): Promise<void> {
      await Promise.all([codex.start(), antigravity.start()]);
    },
    async stop(): Promise<void> {
      const results = await Promise.allSettled([codex.stop(), antigravity.stop()]);
      const rejected = results.find((result) => result.status === 'rejected');
      if (rejected) throw rejected.reason;
    },
  };
}

/** Composes one Core with local transports; no client attachment owns the Core. */
export function createBridge(
  config: Config,
  core = new ObserverCore(
    config,
    config.antigravityDir
      ? { createObserver: (options) => createBridgeObserver(config, options) }
      : undefined,
  ),
) {
  let api: ReturnType<typeof createLocalServer> | undefined;
  let starting: Promise<number> | undefined;
  let stopping: Promise<void> | undefined;
  let releasing: Promise<void> | undefined;
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  const unsubscribeFailure = core.onFailure(() => stop());

  function release(): Promise<void> {
    releasing ??= (async () => {
      unsubscribe?.();
      unsubscribeFailure();
      try {
        await api?.close();
      } finally {
        await core.stop();
      }
    })();
    return releasing;
  }

  function start(): Promise<number> {
    if (stopped) return Promise.reject(new Error('A stopped Bridge cannot be restarted'));
    starting ??= (async () => {
      try {
        await core.initialize();
        if (stopped) throw new Error('Bridge stopped before becoming ready');
        api = createLocalServer(core.store, config, core);
        unsubscribe = core.subscribe((event, live) => api!.broadcast(event, live));
        const port = await api.listen();
        await core.start();
        if (stopped) throw new Error('Bridge stopped before becoming ready');
        return port;
      } catch (error) {
        stopped = true;
        try {
          await release();
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'Bridge startup and cleanup failed', {
            cause: cleanupError,
          });
        }
        throw error;
      }
    })();
    return starting;
  }

  function stop(): Promise<void> {
    if (stopping) return stopping;
    stopped = true;
    stopping = (async () => {
      await starting?.catch(() => {});
      await release();
    })();
    return stopping;
  }

  return { core, start, stop };
}
