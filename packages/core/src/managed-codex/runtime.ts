import { fork } from 'node:child_process';
import { closeSync } from 'node:fs';
import { createLifecycleReceipt, type LifecycleBinding } from './lifecycle-receipt.js';
import { randomUUID } from 'node:crypto';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { Store } from '@orqst/database';
import {
  communicationContentSchema,
  type CommunicationPane,
  type TerminalJournal,
  type TerminalState,
} from '@orqst/protocol';
import { PaneCommunication, type CommunicationResolver } from '../communication/service.js';
import { authorizedDelegation } from './dynamic-tools.js';
import { TerminalAuthority, terminalDigest } from '../terminal/authority.js';
import {
  managedCodexEnvironment,
  readManagedCodexConfig,
  terminalFile,
  type ManagedCodexConfig,
} from '../terminal/codex-profile.js';
import { CodexChannel, type CodexTransport } from './channel.js';
import { CodexCommunicationAdapter, type CodexResultWriter } from './adapter.js';

export const codexRuntimePolicy = Object.freeze({
  lifecycleReceiptVersion: 1,
  activeInstances: 2,
  attempts: 128,
  lifetimeMs: 30 * 60 * 1000,
  killAfterMs: 5000,
  startupMs: 50000,
  permissions:
    'Native same-user; authentication/state paths are specified in the signed config, with shared native config/auth for reuse-existing; read-only/on-request defaults; no provider approvals exposed; network for provider. 30 minute owned-process lifetime then TERM/KILL. No descendant containment, resume, PID adoption or automatic retry.',
});
const startSchema = z.strictObject({
  workspaceId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  name: z.string().trim().min(1).max(100),
  ownerId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  model: z.string().min(1).max(128).nullable(),
  dynamicTools: z.boolean().default(false),
});
const rootSchema = z.strictObject({
  targetPaneId: z.uuid(),
  text: z.string().min(1).max(4096),
  delegatedTask: z.string().min(1).max(2048),
  deadline: z.number().int().safe().positive(),
});
interface RootAttempt {
  id: string;
  correlationId: string;
  source: Attempt;
  target: Attempt;
  input: z.infer<typeof rootSchema>;
  digest: string;
  clientId: string;
  used: boolean;
}
interface RuntimeEvents {
  started(processId?: number): void;
  exit(code: number | null, signal: string | null): void;
}
/** Private trusted test/composition seam; never select a backend through user/agent content. */
export interface CodexRuntimeBackend {
  open(
    configFile: string,
    config: ManagedCodexConfig,
    events: RuntimeEvents,
    binding: LifecycleBinding,
  ): CodexTransport;
}
interface Attempt {
  id: string;
  file: string;
  sourceHash: string;
  config: ManagedCodexConfig;
  input: z.infer<typeof startSchema>;
  digest: string;
  expiresAt: number;
  clientId: string;
  state: TerminalState;
  nativeExit?: { code: number | null; signal: string | null };
  nativeProcessId?: number;
  launchFailure?: 'admission_failed' | 'startup_failed' | 'startup_deadline';
  pane?: CommunicationPane;
  transport?: CodexTransport;
  channel?: CodexChannel;
  adapter?: CodexCommunicationAdapter;
  journal?: TerminalJournal;
}
const overlaps = (a: string, b: string): boolean => {
  const inside = relative(a, b);
  return inside !== '..' && !inside.startsWith('../');
};

export function nativeCodexBackend(hostFile: string): CodexRuntimeBackend {
  return {
    open(file, config, events, binding) {
      const receipt = createLifecycleReceipt(config.state, binding);
      let child: ReturnType<typeof fork>;
      try {
        child = fork(hostFile, [file], {
          execPath: config.node.path,
          execArgv: [],
          cwd: config.state,
          env: managedCodexEnvironment(config),
          stdio: ['ignore', 'ignore', 'ignore', 'ipc', receipt],
          serialization: 'json',
        });
      } finally {
        closeSync(receipt);
      }
      let data: ((chunk: Uint8Array) => void) | undefined;
      let lost: (() => void) | undefined;
      let disposed = false;
      let pendingBytes = 0;
      const fail = () => {
        if (!disposed) lost?.();
      };
      child.on('error', fail);
      child.on('disconnect', fail);
      child.on('exit', fail); // A host exit is not provider exit evidence.
      child.on('message', (raw: unknown) => {
        if (disposed) return;
        const parsed = z
          .discriminatedUnion('type', [
            z.strictObject({
              type: z.literal('started'),
              lifecycleVersion: z.literal(1),
              processId: z.number().int().positive(),
            }),
            z.strictObject({ type: z.literal('lost') }),
            z.strictObject({ type: z.literal('data'), base64: z.string().max(44 * 1024) }),
            z.strictObject({
              type: z.literal('exit'),
              lifecycleVersion: z.literal(1),
              code: z.number().int().safe().nullable(),
              signal: z.string().max(32).nullable(),
            }),
          ])
          .safeParse(raw);
        if (!parsed.success) return fail();
        const message = parsed.data;
        if (message.type === 'started') events.started(message.processId);
        if (message.type === 'data') data?.(Buffer.from(message.base64, 'base64'));
        if (message.type === 'lost') fail();
        if (message.type === 'exit') {
          if (message.code === null && message.signal === null) return fail();
          events.exit(message.code, message.signal);
        }
      });
      const send = (message: object) => {
        const bytes = Buffer.byteLength(JSON.stringify(message));
        if (disposed || !child.connected || pendingBytes + bytes > 512 * 1024) {
          fail();
          throw new Error('Codex private transport unavailable');
        }
        pendingBytes += bytes;
        try {
          // false reports backpressure, not rejection: the message is already queued.
          // Never retry it; only the completion callback reports a failed send.
          child.send(message, (error) => {
            pendingBytes -= bytes;
            if (error) fail();
          });
        } catch {
          pendingBytes -= bytes;
          fail();
          throw new Error('Codex private transport unavailable');
        }
      };
      return {
        send: (line) => send({ action: 'send', line }),
        listen: (onData, onLost) => {
          data = onData;
          lost = onLost;
          return () => {
            data = undefined;
            lost = undefined;
          };
        },
        signal: (signal) => send({ action: 'signal', signal }),
        detach: () => {
          disposed = true;
          data = undefined;
          lost = undefined;
          if (child.connected) child.disconnect();
        },
      };
    },
  };
}

/** Opt-in native structured owner; never constructed by ObserverCore, Desktop or Bridge startup. */
export class CodexStructuredRuntime {
  private attempts = new Map<string, Attempt>();
  private closed = false;
  private roots = new Map<string, RootAttempt>();
  private slots = new Map<string, { store: Store; journal: TerminalJournal }>();

  constructor(
    private authority: TerminalAuthority,
    private communication: PaneCommunication,
    private results: CodexResultWriter,
    private backend: CodexRuntimeBackend,
    private readContent?: CommunicationResolver,
  ) {}

  prepare(clientId: string, configFile: string, input: unknown) {
    if (this.closed || this.attempts.size >= codexRuntimePolicy.attempts)
      throw new Error('Codex runtime capacity unavailable');
    const options = startSchema.parse(input);
    const config = readManagedCodexConfig(configFile);
    const id = randomUUID();
    const sourceHash = terminalDigest(terminalFile(configFile, true));
    const manifest = {
      config,
      configDigest: sourceHash,
      ...options,
      slotId: terminalDigest(config.state),
      policy: codexRuntimePolicy,
    };
    const digest = terminalDigest(JSON.stringify(manifest));
    const challenge = this.authority.prepare(clientId, { operation: 'start', target: id, digest });
    this.attempts.set(id, {
      id,
      file: configFile,
      sourceHash,
      config,
      input: options,
      digest,
      expiresAt: challenge.expiresAt,
      clientId,
      state: 'prepared',
    });
    return { instanceId: id, manifest, challenge };
  }

  async launch(id: string, proof: unknown): Promise<CommunicationPane> {
    const attempt = this.get(id);
    if (this.closed || attempt.state !== 'prepared') throw new Error('Codex attempt already used');
    const active = [...this.attempts.values()].filter((a) =>
      ['starting', 'running', 'ownership_lost'].includes(a.state),
    );
    if (
      active.length >= codexRuntimePolicy.activeInstances ||
      active.some(
        (a) =>
          overlaps(a.config.state, attempt.config.state) ||
          overlaps(attempt.config.state, a.config.state),
      )
    )
      throw new Error('Codex state isolation or runtime capacity denied');
    this.validate(attempt);
    this.authority.consume(proof, { operation: 'start', target: id, digest: attempt.digest });
    let startupDeadline = false;
    // Every slot has its own metadata journal. A dirty/crashed owner fails closed, with no takeover.
    try {
      let slot = this.slots.get(attempt.config.state);
      if (!slot) {
        const store = new Store(join(attempt.config.state, 'terminal.sqlite'));
        try {
          slot = {
            store,
            journal: store.terminalJournal(this.authority.epoch, { recover: false }),
          };
          this.slots.set(attempt.config.state, slot);
        } catch (error) {
          store.close();
          throw error;
        }
      }
      const journal = slot.journal;
      attempt.journal = journal;
      journal.prepare({
        instanceId: id,
        clientId: attempt.clientId,
        projectId: terminalDigest(attempt.config.project),
        manifestDigest: attempt.digest,
      });
      attempt.pane = this.communication.registerPane({
        workspaceId: attempt.input.workspaceId,
        name: attempt.input.name,
        provider: 'codex',
        cliVersion: attempt.config.executableVersion,
        model: null,
        ownership: 'managed',
        ownerId: attempt.input.ownerId,
        creationReason: 'explicit-signed-native-start',
        binding: {
          instanceId: id,
          projectId: terminalDigest(attempt.config.project),
          terminalEpoch: this.authority.epoch,
        },
        capabilities: {
          canSend: true,
          canQueueWhileBusy: true,
          canAcknowledge: true,
          canReportTaskCompletion: true,
          canCancel: true,
        }, // canCancel covers undispatched local queue only.
        state: 'unavailable',
      });
      this.validate(attempt);
      if (!this.authority.isEnrolled(attempt.clientId) || this.authority.now() >= attempt.expiresAt)
        throw new Error('Codex start authorization expired');
      // Admission is durable immediately before the first possibly effectful backend call.
      journal.transition(id, 'starting');
      attempt.state = 'starting';
      let confirmStarted: () => void;
      const started = new Promise<void>((resolve) => {
        confirmStarted = resolve;
      });
      attempt.transport = journal.withOwner(() =>
        this.backend.open(
          attempt.file,
          attempt.config,
          {
            started: (processId) => {
              if (attempt.state !== 'starting') return;
              try {
                journal.transition(id, 'running');
                attempt.state = 'running';
                attempt.nativeProcessId = processId;
                confirmStarted();
              } catch {
                this.lose(attempt);
              }
            },
            exit: (code, signal) => {
              if (!['starting', 'running'].includes(attempt.state)) return;
              attempt.nativeExit = { code, signal };
              try {
                journal.transition(id, 'exited', {
                  exitCode: code,
                  ...(signal === null ? {} : { signal }),
                });
                attempt.state = 'exited';
                if (attempt.pane) this.communication.setPaneState(attempt.pane.paneId, 'closed');
                attempt.channel?.detach();
              } catch {
                this.lose(attempt);
              }
            },
          },
          {
            instanceId: id,
            epoch: this.authority.epoch,
            manifestDigest: attempt.digest,
            configDigest: attempt.sourceHash,
          },
        ),
      );
      const channel = new CodexChannel(attempt.transport);
      attempt.channel = channel;
      const adapter = new CodexCommunicationAdapter(
        channel,
        attempt.pane,
        this.results,
        () => this.lose(attempt),
        () => {
          try {
            journal.assertOwner();
            return (
              attempt.state === 'running' &&
              this.authority.isEnrolled(attempt.clientId) &&
              !this.closed
            );
          } catch {
            return false;
          }
        },
        attempt.input.dynamicTools,
        () => {
          if (this.closed || !attempt.pane || attempt.state !== 'running') return;
          this.communication.setPaneState(attempt.pane.paneId, 'ready');
          queueMicrotask(() => {
            if (!this.closed && attempt.pane)
              void this.communication
                .dispatchNext(attempt.pane.paneId)
                .catch(() => this.lose(attempt));
          });
        },
        () => {
          this.communication.setPaneState(attempt.pane!.paneId, 'busy');
        },
      );
      attempt.adapter = adapter;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            await started;
            await adapter.initialize(
              attempt.config.project,
              attempt.input.model,
              attempt.config.authentication !== undefined,
            );
          })(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              startupDeadline = true;
              reject(new Error('Codex startup deadline'));
            }, codexRuntimePolicy.startupMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (this.snapshot(id).state !== 'running' || this.closed)
        throw new Error('Codex OS start not confirmed');
      this.communication.enrollAdapter(attempt.pane.paneId, attempt.pane.binding!, adapter);
      this.communication.setPaneState(attempt.pane.paneId, 'ready');
      return this.communication.resolvePane(attempt.input.workspaceId, attempt.pane.paneId);
    } catch {
      attempt.launchFailure = startupDeadline
        ? 'startup_deadline'
        : attempt.state === 'prepared'
          ? 'admission_failed'
          : 'startup_failed';
      if (attempt.state === 'prepared') {
        try {
          attempt.journal?.transition(id, 'start_failed');
        } catch {
          /* No process was dispatched. */
        }
        attempt.state = 'start_failed';
        if (attempt.pane) {
          try {
            this.communication.setPaneState(attempt.pane.paneId, 'closed');
          } catch {
            /* No process was dispatched. */
          }
        }
      }
      this.lose(attempt);
      throw new Error('Codex native start unavailable or uncertain; no automatic retry');
    }
  }

  snapshot(id: string) {
    const a = this.get(id);
    if (a.state === 'running') {
      try {
        a.journal!.assertOwner();
        if (!this.authority.isEnrolled(a.clientId)) this.lose(a);
      } catch {
        this.lose(a);
      }
    }
    return {
      instanceId: id,
      slotId: terminalDigest(a.config.state),
      state: a.state,
      nativeExit: a.nativeExit ?? null,
      nativeProcessId: a.nativeProcessId ?? null,
      launchFailure: a.launchFailure ?? null,
      channelDiagnostic: a.channel?.diagnostic() ?? null,
      paneId: a.pane?.paneId ?? null,
      requestedModel: a.input.model,
      ...(a.adapter?.snapshot() ?? {
        authentication: 'unknown' as const,
        startupPhase: 'not_started' as const,
        unexpectedToolUse: false,
        dynamicTools: a.input.dynamicTools ? 'requested' : 'disabled',
        delegationReturned: false,
        nativeThreadId: null,
        reportedModel: null,
        activeTurnId: null,
        available: false,
      }),
    };
  }
  prepareRootTask(clientId: string, instanceId: string, raw: unknown) {
    const source = this.get(instanceId);
    const input = rootSchema.parse(raw);
    const target = [...this.attempts.values()].find((a) => a.pane?.paneId === input.targetPaneId);
    if (
      this.closed ||
      !this.readContent ||
      this.roots.size >= 128 ||
      !source.input.dynamicTools ||
      !source.pane ||
      !target?.pane ||
      source === target ||
      source.pane.workspaceId !== target.pane.workspaceId ||
      !source.adapter?.ready(source.pane) ||
      !target.adapter?.ready(target.pane) ||
      input.deadline <= Date.now() ||
      input.deadline > Date.now() + 180000 ||
      Buffer.byteLength(input.text) > 4096 ||
      Buffer.byteLength(input.delegatedTask) > 2048
    )
      throw new Error('Root delegation plan unavailable or outside policy');
    const id = randomUUID();
    const correlationId = randomUUID();
    const plan = {
      taskId: id,
      correlationId,
      source: source.pane,
      target: target.pane,
      input,
      maximumDelegations: 1,
      permissions: 'read-only; no provider approval; exact target/task; no retries',
    };
    const digest = terminalDigest(JSON.stringify(plan));
    const challenge = this.authority.prepare(clientId, { operation: 'input', target: id, digest });
    this.roots.set(id, {
      id,
      correlationId,
      source,
      target,
      input: structuredClone(input),
      digest,
      clientId,
      used: false,
    });
    return { plan: structuredClone(plan), challenge };
  }
  async runRootTask(taskId: string, proof: unknown) {
    const root = this.roots.get(taskId);
    if (
      !root ||
      root.used ||
      this.closed ||
      !this.readContent ||
      !root.source.pane ||
      !root.target.pane ||
      !root.source.adapter?.ready(root.source.pane) ||
      !root.target.adapter?.ready(root.target.pane) ||
      Date.now() >= root.input.deadline
    )
      throw new Error('Root delegation grant unavailable');
    this.authority.consume(proof, { operation: 'input', target: taskId, digest: root.digest });
    root.used = true;
    const context = { taskId, correlationId: root.correlationId, deadline: root.input.deadline };
    const facade = authorizedDelegation(
      this.communication,
      {
        actorId: root.source.pane.ownerId,
        workspaceId: root.source.pane.workspaceId,
        sourcePaneId: root.source.pane.paneId,
        targetPaneId: root.target.pane.paneId,
      },
      root.input.delegatedTask,
      context,
      this.results,
      this.readContent,
    );
    let resolve: (result: {
      taskId: string;
      correlationId: string;
      result: import('@orqst/protocol').CommunicationContent;
    }) => void;
    let reject: (error: Error) => void;
    const completed = new Promise<{
      taskId: string;
      correlationId: string;
      result: import('@orqst/protocol').CommunicationContent;
    }>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // Observe failures immediately even if native completion races the acceptance response.
    void completed.catch(() => {});
    try {
      await root.source.adapter.startRoot(
        root.input.text,
        context,
        (event, result) => {
          if (event === 'completed' && result) {
            if (!facade.succeeded() || !root.source.adapter!.snapshot().delegationReturned)
              reject(new Error('Native A-to-B-to-A delegation was not confirmed'));
            else {
              try {
                const ref = communicationContentSchema.parse(result);
                const bytes = this.readContent!(
                  {
                    workspaceId: root.source.pane!.workspaceId,
                    actorId: root.source.pane!.ownerId,
                    sourcePaneId: root.source.pane!.paneId,
                    targetPaneId: root.source.pane!.paneId,
                    purpose: 'result',
                  },
                  ref.id,
                );
                if (bytes.length !== ref.bytes || terminalDigest(bytes) !== ref.sha256)
                  throw new Error('Root result reference mismatch');
                resolve({ taskId, correlationId: root.correlationId, result: ref });
              } catch {
                reject(new Error('Root result reference unavailable'));
              }
            }
          } else if (['failed', 'outcome_unknown', 'waiting_approval'].includes(event))
            reject(new Error('Root delegation outcome unavailable; no retry'));
        },
        facade.handle,
      );
      return await completed;
    } finally {
      facade.close();
    }
  }
  requestStop(clientId: string, id: string, signal: 'SIGTERM' | 'SIGKILL') {
    z.enum(['SIGTERM', 'SIGKILL']).parse(signal);
    const a = this.get(id);
    if (this.closed || a.state !== 'running') throw new Error('No owned live Codex handle');
    return this.authority.prepare(clientId, {
      operation: 'stop',
      target: id,
      digest: terminalDigest(JSON.stringify([a.digest, signal])),
    });
  }
  stop(id: string, signal: 'SIGTERM' | 'SIGKILL', proof: unknown): void {
    z.enum(['SIGTERM', 'SIGKILL']).parse(signal);
    const a = this.get(id);
    if (this.closed || a.state !== 'running') throw new Error('No owned live Codex handle');
    this.authority.consume(proof, {
      operation: 'stop',
      target: id,
      digest: terminalDigest(JSON.stringify([a.digest, signal])),
    });
    try {
      a.journal!.withOwner(() => a.transport!.signal(signal));
    } catch {
      this.lose(a);
      throw new Error('Codex stop outcome uncertain');
    }
  }
  /** Disconnect clients and preserve uncertainty. No signal, resume, PID adoption or retry. */
  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    for (const a of this.attempts.values()) this.lose(a);
    for (const slot of this.slots.values()) {
      try {
        slot.journal.release();
      } catch {
        /* A fenced owner cannot mutate metadata. */
      }
      slot.store.close();
    }
    this.slots.clear();
  }
  private validate(a: Attempt): void {
    if (
      terminalDigest(terminalFile(a.file, true)) !== a.sourceHash ||
      JSON.stringify(readManagedCodexConfig(a.file)) !== JSON.stringify(a.config)
    )
      throw new Error('Codex manifest changed');
  }
  private get(id: string): Attempt {
    const value = this.attempts.get(id);
    if (!value) throw new Error('Codex instance unavailable');
    return value;
  }
  private lose(a: Attempt): void {
    if (['starting', 'running'].includes(a.state)) {
      try {
        a.journal?.transition(a.id, 'ownership_lost');
      } catch {
        /* Preserve unknown. */
      }
      a.state = 'ownership_lost';
    }
    if (a.pane && !['exited', 'start_failed'].includes(a.state)) {
      try {
        this.communication.setPaneState(a.pane.paneId, 'unavailable');
      } catch {
        /* Preserve evidence. */
      }
    }
    a.adapter?.close();
    a.channel?.detach();
    a.transport?.detach();
  }
}
