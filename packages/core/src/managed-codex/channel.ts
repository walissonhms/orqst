import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { StartupCounters } from './startup-diagnostics.js';

export const codexChannelLimits = Object.freeze({
  lineBytes: 256 * 1024,
  sessionBytes: 8 * 1024 * 1024,
  pendingRequests: 4,
  requestMs: 8000,
  // Native auth/config loading can refresh credentials before the first RPC response.
  nativeAuthInitializeMs: 30000,
  threadStartMs: 30000,
});
const messageSchema = z.object({
  id: z.union([z.string().max(128), z.number().int().safe()]).optional(),
  method: z.string().max(128).optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
const requestMethodSchema = z.enum(['initialize', 'account/read', 'thread/start', 'turn/start']);
type CodexMethod = z.infer<typeof requestMethodSchema>;
type FailureReason =
  | 'transport_lost'
  | 'request_timeout'
  | 'send_failed'
  | 'output_limit'
  | 'invalid_message'
  | 'unexpected_response'
  | 'dynamic_request_limit'
  | 'native_request_rejected'
  | 'detached';
interface Diagnostic {
  reason: FailureReason;
  method: CodexMethod | null;
}
export interface CodexTransport {
  send(line: string): void;
  /** Subscribe before sending initialization. Private structured bytes, never PTY output. */
  listen(data: (chunk: Uint8Array) => void, lost: () => void): () => void;
  signal(signal: 'SIGTERM' | 'SIGKILL'): void;
  detach(): void;
  startupDiagnostic?(): unknown;
  finishDiagnostics?(): void;
}
export interface CodexNotification {
  method: string;
  params: unknown;
  requestId?: string | number;
}

/** Bounded JSON-lines RPC. No arbitrary method is exposed to a renderer or agent. */
export class CodexChannel {
  private readonly startup = new StartupCounters([
    'receivedBytes',
    'chunks',
    'completeLines',
    'notifications',
    'responses',
    'correlatedResponses',
    'invalidMessages',
    'outputLimits',
  ] as const);
  private bufferedAtFinish: number | undefined;
  startupDiagnostic() {
    return {
      ...this.startup.snapshot(),
      bufferedBytes: this.bufferedAtFinish ?? this.buffer.length,
    };
  }
  finishDiagnostics(): void {
    this.bufferedAtFinish ??= this.buffer.length;
    this.startup.freeze();
    this.transport.finishDiagnostics?.();
  }
  private pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
      method: CodexMethod;
    }
  >();
  private buffer = Buffer.alloc(0);
  private total = 0;
  private closed = false;
  private failure: Diagnostic | null = null;
  private serverRequests = new Set<string>();
  private unsubscribe: () => void;
  private listeners = new Set<(message: CodexNotification) => void>();
  private lostListeners = new Set<() => void>();

  constructor(
    private transport: CodexTransport,
    private readonly reuseExistingAuthentication = false,
  ) {
    this.unsubscribe = transport.listen(
      (chunk) => this.receive(chunk),
      () => this.fail('transport_lost'),
    );
  }

  onNotification(listener: (message: CodexNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onLost(listener: () => void): () => void {
    this.lostListeners.add(listener);
    return () => this.lostListeners.delete(listener);
  }
  get available(): boolean {
    return !this.closed;
  }
  /** Allowlisted local facts only. Never return native errors, payloads or account fields. */
  diagnostic(): Readonly<Diagnostic> | null {
    return this.failure === null ? null : { ...this.failure };
  }

  request(method: CodexMethod, params: object): Promise<unknown> {
    if (!requestMethodSchema.safeParse(method).success)
      return Promise.reject(new Error('Codex method unavailable'));
    return new Promise((resolve, reject) => {
      if (this.closed || this.pending.size >= codexChannelLimits.pendingRequests)
        return reject(new Error('Codex structured channel unavailable'));
      const id = randomUUID();
      this.pending.set(id, {
        method,
        resolve,
        reject,
        timer: setTimeout(
          () => this.fail('request_timeout', method),
          method === 'initialize' && this.reuseExistingAuthentication
            ? codexChannelLimits.nativeAuthInitializeMs
            : method === 'thread/start'
              ? codexChannelLimits.threadStartMs
              : codexChannelLimits.requestMs,
        ),
      });
      try {
        this.transport.send(JSON.stringify({ id, method, params }) + '\n');
      } catch {
        this.fail('send_failed', method);
      }
    });
  }
  initialized(): void {
    if (this.closed) throw new Error('Codex structured channel unavailable');
    try {
      this.transport.send(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    } catch {
      this.fail('send_failed');
      throw new Error('Codex initialization uncertain');
    }
  }
  replyDynamic(id: string | number, result: { success: boolean; text: string }): void {
    const key = JSON.stringify(id);
    const output = z
      .strictObject({ success: z.boolean(), text: z.string().min(1).max(16384) })
      .parse(result);
    if (this.closed || !this.serverRequests.delete(key) || Buffer.byteLength(output.text) > 16384)
      throw new Error('No matching native dynamic request');
    try {
      this.transport.send(
        JSON.stringify({
          id,
          result: {
            success: output.success,
            contentItems: [{ type: 'inputText', text: output.text }],
          },
        }) + '\n',
      );
    } catch {
      this.fail('send_failed');
      throw new Error('Dynamic result delivery uncertain');
    }
  }
  /** Release transport ownership without signaling or adopting a PID. */
  detach(): void {
    this.fail('detached');
    this.transport.detach();
  }

  private receive(chunk: Uint8Array): void {
    if (this.closed) return;
    this.startup.add('receivedBytes', chunk.byteLength);
    this.startup.add('chunks');
    this.total += chunk.byteLength;
    if (
      chunk.byteLength > codexChannelLimits.lineBytes ||
      this.total > codexChannelLimits.sessionBytes
    )
      return this.fail('output_limit');
    let offset = 0;
    const bytes = Buffer.from(chunk);
    while (offset < bytes.length && !this.closed) {
      const newline = bytes.indexOf(10, offset);
      const end = newline < 0 ? bytes.length : newline;
      const part = bytes.subarray(offset, end);
      if (this.buffer.length + part.length > codexChannelLimits.lineBytes)
        return this.fail('output_limit');
      this.buffer = Buffer.concat([this.buffer, part]);
      if (newline < 0) return;
      this.startup.add('completeLines');
      const line = this.buffer;
      this.buffer = Buffer.alloc(0);
      offset = newline + 1;
      try {
        const raw = messageSchema.parse(
          JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(line)),
        );
        if (raw.method) {
          this.startup.add('notifications');
          if (raw.method === 'item/tool/call' && raw.id !== undefined) {
            const key = JSON.stringify(raw.id);
            if (this.serverRequests.has(key) || this.serverRequests.size >= 4)
              return this.fail('dynamic_request_limit');
            this.serverRequests.add(key);
          }
          const event = {
            method: raw.method,
            params: raw.params,
            ...(raw.id === undefined ? {} : { requestId: raw.id }),
          };
          for (const listener of this.listeners) listener(event);
        } else {
          this.startup.add('responses');
          const request = this.pending.get(String(raw.id));
          if (
            !request ||
            raw.id === undefined ||
            (raw.error === undefined) === (raw.result === undefined)
          )
            return this.fail('unexpected_response');
          this.startup.add('correlatedResponses');
          this.pending.delete(String(raw.id));
          clearTimeout(request.timer);
          if (raw.error !== undefined) {
            this.failure ??= { reason: 'native_request_rejected', method: request.method };
            request.reject(new Error('Codex rejected structured request'));
          } else request.resolve(raw.result);
        }
      } catch {
        this.fail('invalid_message');
      }
    }
  }
  private fail(reason: FailureReason, method: CodexMethod | null = null): void {
    if (this.closed) return;
    if (reason === 'invalid_message') this.startup.add('invalidMessages');
    if (reason === 'output_limit') this.startup.add('outputLimits');
    this.finishDiagnostics();
    this.closed = true;
    this.failure ??= { reason, method };
    this.buffer = Buffer.alloc(0);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Codex structured outcome unavailable'));
    }
    this.pending.clear();
    this.serverRequests.clear();
    this.unsubscribe?.();
    for (const listener of this.lostListeners) {
      try {
        listener();
      } catch {
        /* Private client failure does not restore transport. */
      }
    }
  }
}
