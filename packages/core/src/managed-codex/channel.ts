import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const codexChannelLimits = Object.freeze({
  lineBytes: 256 * 1024,
  sessionBytes: 8 * 1024 * 1024,
  pendingRequests: 4,
  requestMs: 8000,
});
const messageSchema = z.object({
  id: z.union([z.string().max(128), z.number().int().safe()]).optional(),
  method: z.string().max(128).optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
export interface CodexTransport {
  send(line: string): void;
  /** Subscribe before sending initialization. Private structured bytes, never PTY output. */
  listen(data: (chunk: Uint8Array) => void, lost: () => void): () => void;
  signal(signal: 'SIGTERM' | 'SIGKILL'): void;
  detach(): void;
}
export interface CodexNotification {
  method: string;
  params: unknown;
  requestId?: string | number;
}

/** Bounded JSON-lines RPC. No arbitrary method is exposed to a renderer or agent. */
export class CodexChannel {
  private pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private buffer = Buffer.alloc(0);
  private total = 0;
  private closed = false;
  private serverRequests = new Set<string>();
  private unsubscribe: () => void;
  private listeners = new Set<(message: CodexNotification) => void>();
  private lostListeners = new Set<() => void>();

  constructor(private transport: CodexTransport) {
    this.unsubscribe = transport.listen(
      (chunk) => this.receive(chunk),
      () => this.fail(),
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

  request(method: 'initialize' | 'thread/start' | 'turn/start', params: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.closed || this.pending.size >= codexChannelLimits.pendingRequests)
        return reject(new Error('Codex structured channel unavailable'));
      const id = randomUUID();
      this.pending.set(id, {
        resolve,
        reject,
        timer: setTimeout(() => this.fail(), codexChannelLimits.requestMs),
      });
      try {
        this.transport.send(JSON.stringify({ id, method, params }) + '\n');
      } catch {
        this.fail();
      }
    });
  }
  initialized(): void {
    if (this.closed) throw new Error('Codex structured channel unavailable');
    try {
      this.transport.send(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    } catch {
      this.fail();
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
      this.fail();
      throw new Error('Dynamic result delivery uncertain');
    }
  }
  /** Release transport ownership without signaling or adopting a PID. */
  detach(): void {
    this.fail();
    this.transport.detach();
  }

  private receive(chunk: Uint8Array): void {
    if (this.closed) return;
    this.total += chunk.byteLength;
    if (
      chunk.byteLength > codexChannelLimits.lineBytes ||
      this.total > codexChannelLimits.sessionBytes
    )
      return this.fail();
    let offset = 0;
    const bytes = Buffer.from(chunk);
    while (offset < bytes.length && !this.closed) {
      const newline = bytes.indexOf(10, offset);
      const end = newline < 0 ? bytes.length : newline;
      const part = bytes.subarray(offset, end);
      if (this.buffer.length + part.length > codexChannelLimits.lineBytes) return this.fail();
      this.buffer = Buffer.concat([this.buffer, part]);
      if (newline < 0) return;
      const line = this.buffer;
      this.buffer = Buffer.alloc(0);
      offset = newline + 1;
      try {
        const raw = messageSchema.parse(
          JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(line)),
        );
        if (raw.method) {
          if (raw.method === 'item/tool/call' && raw.id !== undefined) {
            const key = JSON.stringify(raw.id);
            if (this.serverRequests.has(key) || this.serverRequests.size >= 4) return this.fail();
            this.serverRequests.add(key);
          }
          const event = {
            method: raw.method,
            params: raw.params,
            ...(raw.id === undefined ? {} : { requestId: raw.id }),
          };
          for (const listener of this.listeners) listener(event);
        } else {
          const request = this.pending.get(String(raw.id));
          if (
            !request ||
            raw.id === undefined ||
            (raw.error === undefined) === (raw.result === undefined)
          )
            return this.fail();
          this.pending.delete(String(raw.id));
          clearTimeout(request.timer);
          if (raw.error !== undefined)
            request.reject(new Error('Codex rejected structured request'));
          else request.resolve(raw.result);
        }
      } catch {
        this.fail();
      }
    }
  }
  private fail(): void {
    if (this.closed) return;
    this.closed = true;
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
