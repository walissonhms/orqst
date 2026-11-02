import { join } from 'node:path';
import { Store } from '@orqst/database';
import { CodexObserver, type CodexObserverOptions } from '@orqst/adapter-codex';
import type { StoredEvent } from '@orqst/protocol';

export interface CoreOptions {
  dataDir: string;
  sessionsDir: string;
  retentionDays: number;
  pollMs: number;
}

export type CoreState =
  | 'idle'
  | 'initializing'
  | 'initialized'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'stopped'
  | 'failed';
type EventListener = (event: StoredEvent, live: boolean) => void;
type Observer = Pick<CodexObserver, 'start' | 'stop' | 'diagnostics'>;

export interface CoreDependencies {
  openStore?: (file: string, retentionDays: number) => Store;
  createObserver?: (options: CodexObserverOptions) => Observer;
}

/** Owns observation resources only; clients and transports do not own its lifetime. */
export class ObserverCore {
  private currentState: CoreState = 'idle';
  private currentFailure?: unknown;
  private currentStore?: Store;
  private observer?: Observer;
  private retention?: ReturnType<typeof setInterval>;
  private initializing?: Promise<void>;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  private releasing?: Promise<void>;
  private listeners = new Set<EventListener>();
  private failureListeners = new Set<(error: unknown) => void | Promise<void>>();

  constructor(
    private options: CoreOptions,
    private dependencies: CoreDependencies = {},
  ) {}

  get state(): CoreState {
    return this.currentState;
  }

  get failure(): unknown {
    return this.currentFailure;
  }

  /** The one store shared by observation and local transport queries. */
  get store(): Store {
    if (!this.currentStore) throw new Error('Core store is not open');
    return this.currentStore;
  }

  get diagnostics(): Observer['diagnostics'] {
    if (!this.observer) throw new Error('Core observer is not initialized');
    return this.observer.diagnostics;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onFailure(listener: (error: unknown) => void | Promise<void>): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  /** Opens resources without ingesting; a composition root can reserve its transport first. */
  initialize(): Promise<void> {
    if (
      this.currentState === 'initializing' ||
      this.currentState === 'initialized' ||
      this.currentState === 'starting' ||
      this.currentState === 'ready'
    )
      return this.initializing!;
    if (this.currentState !== 'idle')
      return Promise.reject(new Error('A stopped or failed Core cannot be restarted'));
    this.currentState = 'initializing';
    this.initializing = this.prepare();
    return this.initializing;
  }

  private async prepare(): Promise<void> {
    try {
      process.umask(0o077);
      this.currentStore = (this.dependencies.openStore ?? ((file, days) => new Store(file, days)))(
        join(this.options.dataDir, 'orqst.db'),
        this.options.retentionDays,
      );
      this.observer = (
        this.dependencies.createObserver ?? ((options) => new CodexObserver(options))
      )({
        root: this.options.sessionsDir,
        store: this.currentStore,
        pollMs: this.options.pollMs,
        onEvent: (event, live) => {
          for (const listener of this.listeners) {
            try {
              listener(event, live);
            } catch (error) {
              this.fail(error);
            }
          }
        },
      });
      this.currentState = 'initialized';
    } catch (error) {
      this.currentFailure ??= error;
      this.currentState = 'failed';
      try {
        await this.release();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Core initialization and cleanup failed', {
          cause: cleanupError,
        });
      }
      throw error;
    }
  }

  /** Resolves after retention and the initial bounded observer scan/start attempt. */
  start(): Promise<void> {
    if (this.currentState === 'starting' || this.currentState === 'ready') return this.starting!;
    if (!['idle', 'initializing', 'initialized'].includes(this.currentState))
      return Promise.reject(new Error('A stopped or failed Core cannot be restarted'));
    const initialization = this.initialize();
    if (
      this.currentState !== 'failed' &&
      this.currentState !== 'stopped' &&
      this.currentState !== 'stopping'
    )
      this.currentState = 'starting';
    this.starting = this.observe(initialization);
    return this.starting;
  }

  private async observe(initialization: Promise<void>): Promise<void> {
    try {
      await initialization;
      if (this.currentState !== 'starting') throw new Error('Core stopped before becoming ready');
      this.store.retain();
      await this.observer!.start();
      if (this.currentState !== 'starting') throw new Error('Core stopped before becoming ready');
      this.retention = setInterval(() => {
        try {
          this.store.retain();
        } catch (error) {
          this.fail(error);
        }
      }, 3600000);
      this.currentState = 'ready';
    } catch (error) {
      if (this.currentState !== 'stopping') {
        this.currentFailure ??= error;
        this.currentState = 'failed';
      }
      try {
        await this.release();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Core initialization and cleanup failed', {
          cause: cleanupError,
        });
      }
      throw error;
    }
  }

  private fail(error: unknown): void {
    if (this.currentFailure !== undefined) return;
    this.currentFailure = error;
    this.currentState = 'failed';
    clearInterval(this.retention);
    // Report before stopping so the composition root can close its transports first.
    void Promise.allSettled([...this.failureListeners].map(async (listener) => listener(error)))
      .then(() => this.stop())
      .catch(() => {
        // The shared stop promise retains cleanup errors for the composition root.
      });
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    if (this.currentState !== 'failed') this.currentState = 'stopping';
    clearInterval(this.retention);
    this.stopping = (async () => {
      try {
        await (this.starting ?? this.initializing)?.catch(() => {});
        await this.release();
        this.currentState = this.currentFailure === undefined ? 'stopped' : 'failed';
      } catch (error) {
        this.currentFailure ??= error;
        this.currentState = 'failed';
        throw error;
      }
    })();
    return this.stopping;
  }

  private release(): Promise<void> {
    this.releasing ??= (async () => {
      clearInterval(this.retention);
      try {
        await this.observer?.stop();
      } finally {
        const store = this.currentStore;
        this.currentStore = undefined;
        this.listeners.clear();
        this.failureListeners.clear();
        store?.close();
      }
    })();
    return this.releasing;
  }
}
