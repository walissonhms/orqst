import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TerminalAuthority, terminalDigest } from './authority.js';

export const mcpToolCallSchema = z.discriminatedUnion('name', [
  z.strictObject({
    name: z.literal('delegate_task'),
    arguments: z.strictObject({ task: z.string().min(1).max(4096) }),
  }),
  z.strictObject({ name: z.literal('wait_task'), arguments: z.strictObject({}) }),
  z.strictObject({
    name: z.literal('submit_result'),
    arguments: z.strictObject({ taskId: z.uuid(), result: z.string().min(1).max(8192) }),
  }),
]);
export type McpRole = 'source' | 'worker';
type Completion =
  | { state: 'completed'; taskId: string; result: string }
  | { state: 'unknown'; taskId: string | null };
type Delivery =
  | { state: 'delivered'; taskId: string; task: string }
  | { state: 'unknown'; taskId: string | null };

/** One native-signed A -> B -> A grant. Has no PTY reference, launch, signal or retry operation. */
export class McpTaskBroker {
  private grant;
  private authorized = false;
  private state: 'ungranted' | 'ready' | 'queued' | 'delivered' | 'completed' | 'unknown' =
    'ungranted';
  private taskId: string | null = null;
  private task?: string;
  private result?: string;
  private waited = false;
  private delegated = false;
  private complete?: (value: Completion) => void;
  private deliver?: (value: Delivery) => void;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private authority: TerminalAuthority,
    identity: { sourceInstanceId: string; targetInstanceId: string; workspaceId: string },
    private owned: () => boolean,
    deadlineMs = 120_000,
  ) {
    z.strictObject({
      sourceInstanceId: z.uuid(),
      targetInstanceId: z.uuid(),
      workspaceId: z.string().min(1).max(128),
    }).parse(identity);
    if (
      identity.sourceInstanceId === identity.targetInstanceId ||
      !Number.isSafeInteger(deadlineMs) ||
      deadlineMs < 1 ||
      deadlineMs > 120_000
    )
      throw new Error('Invalid delegation scope');
    this.grant = Object.freeze({
      ...identity,
      grantId: randomUUID(),
      epoch: authority.epoch,
      expiresAt: authority.now() + deadlineMs,
      maximumTaskBytes: 4096,
      maximumResultBytes: 8192,
    });
  }

  prepare() {
    if (this.authorized || this.state !== 'ungranted' || !this.owned())
      throw new Error('Delegation unavailable');
    return {
      grant: this.grant,
      challenge: this.authority.prepare('desktop-managed', {
        operation: 'delegate',
        target: this.grant.grantId,
        digest: terminalDigest(JSON.stringify(this.grant)),
      }),
    };
  }

  authorize(proof: unknown) {
    if (
      this.authorized ||
      this.state !== 'ungranted' ||
      !this.owned() ||
      this.authority.now() >= this.grant.expiresAt
    )
      throw new Error('Delegation unavailable');
    this.authority.consume(proof, {
      operation: 'delegate',
      target: this.grant.grantId,
      digest: terminalDigest(JSON.stringify(this.grant)),
    });
    this.authorized = true;
    this.state = 'ready';
    this.timer = setTimeout(() => this.close(), this.grant.expiresAt - this.authority.now());
  }

  snapshot() {
    return { grant: this.grant, state: this.state, taskId: this.taskId };
  }

  async call(role: McpRole, raw: unknown): Promise<unknown> {
    this.assertAvailable();
    const call = mcpToolCallSchema.parse(raw);
    if (call.name === 'delegate_task') {
      if (
        role !== 'source' ||
        this.delegated ||
        Buffer.byteLength(call.arguments.task) > this.grant.maximumTaskBytes
      )
        throw new Error('Delegation denied');
      this.delegated = true;
      this.taskId = randomUUID();
      this.task = call.arguments.task;
      this.state = 'queued';
      const pending = new Promise<Completion>((resolve) => {
        this.complete = resolve;
      });
      if (this.deliver) this.deliverTask();
      return pending;
    }
    if (role !== 'worker') throw new Error('Worker operation denied');
    if (call.name === 'wait_task') {
      if (this.waited) throw new Error('Task wait already consumed');
      this.waited = true;
      const pending = new Promise<Delivery>((resolve) => {
        this.deliver = resolve;
      });
      if (this.task) this.deliverTask();
      return pending;
    }
    if (
      this.state !== 'delivered' ||
      call.arguments.taskId !== this.taskId ||
      Buffer.byteLength(call.arguments.result) > this.grant.maximumResultBytes
    )
      throw new Error('Result denied');
    this.state = 'completed';
    this.result = call.arguments.result;
    this.complete?.({ state: 'completed', taskId: this.taskId, result: this.result });
    this.complete = undefined;
    this.task = undefined;
    clearTimeout(this.timer);
    return { state: 'completed', taskId: this.taskId };
  }

  /** MCP disconnection is unknown task delivery, never evidence that either CLI exited. */
  close() {
    clearTimeout(this.timer);
    if (this.state === 'completed' || this.state === 'unknown') return;
    this.state = 'unknown';
    const outcome = { state: 'unknown' as const, taskId: this.taskId };
    this.complete?.(outcome);
    this.deliver?.(outcome);
    this.complete = this.deliver = undefined;
    this.task = this.result = undefined;
  }

  private deliverTask() {
    this.assertAvailable();
    if (!this.taskId || !this.task || !this.deliver) throw new Error('No deliverable task');
    this.state = 'delivered';
    this.deliver({ state: 'delivered', taskId: this.taskId, task: this.task });
    this.deliver = undefined;
  }

  private assertAvailable() {
    if (
      !this.authorized ||
      !this.authority.isEnrolled('desktop-managed') ||
      !this.owned() ||
      this.authority.now() >= this.grant.expiresAt
    ) {
      if (this.authorized) this.close();
      throw new Error('Delegation unavailable');
    }
    if (this.state === 'unknown' || this.state === 'completed')
      throw new Error('Delegation terminal');
  }
}
