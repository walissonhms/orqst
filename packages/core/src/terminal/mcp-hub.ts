// Feature-scoped messaging between ORQST terminals (docs/design/mcp-n-terminals.md).
// Tool surface adapted from Anywh 51bca54 relay/src/session/roomTools.ts (Apache-2.0) and
// limits from Tucano 91061b0 src/core/runs.ts (Apache-2.0); see docs/research/mcp-n-terminals.md.
// Pure in-memory logic: no socket, PTY, process or persistence of message content.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const HUB_LIMITS = Object.freeze({
  inbox: 20,
  readBatch: 20,
  recipients: 3,
  textBytes: 16 * 1024,
  summaryBytes: 4 * 1024,
  sendsPerMinute: 30,
  maxDepth: 3,
  waitMs: 60_000,
  tasks: 64,
});

const handle = z.string().min(1).max(64);
export const hubToolCallSchema = z.discriminatedUnion('name', [
  z.strictObject({ name: z.literal('list_terminals'), arguments: z.strictObject({}) }),
  z.strictObject({
    name: z.literal('send_message'),
    arguments: z.strictObject({
      to: z.union([handle, z.array(handle).min(1).max(HUB_LIMITS.recipients)]),
      text: z
        .string()
        .min(1)
        .max(256 * 1024),
    }),
  }),
  z.strictObject({
    name: z.literal('read_messages'),
    arguments: z.strictObject({
      limit: z.number().int().min(1).max(HUB_LIMITS.readBatch).optional(),
    }),
  }),
  z.strictObject({
    name: z.literal('wait_messages'),
    arguments: z.strictObject({
      timeout_ms: z.number().int().min(0).max(HUB_LIMITS.waitMs).optional(),
    }),
  }),
  z.strictObject({
    name: z.literal('delegate_task'),
    arguments: z.strictObject({
      to: handle,
      task: z
        .string()
        .min(1)
        .max(256 * 1024),
    }),
  }),
  z.strictObject({
    name: z.literal('submit_result'),
    arguments: z.strictObject({
      taskId: z.uuid(),
      status: z.enum(['done', 'failed', 'blocked']),
      summary: z
        .string()
        .min(1)
        .max(64 * 1024),
    }),
  }),
  z.strictObject({
    name: z.literal('task_status'),
    arguments: z.strictObject({ taskId: z.uuid() }),
  }),
]);
export type HubToolCall = z.infer<typeof hubToolCallSchema>;

/** A terminal as the hub sees it. `featureId` null means unassigned: it can reach no one. */
export interface HubMember {
  terminalId: string;
  alias: string;
  name: string;
  provider: string;
  featureId: string | null;
  running: boolean;
}

/** Metadata-only audit event: never the text. */
export interface HubEvidence {
  messageId: string;
  kind: 'message' | 'task' | 'result';
  from: string;
  to: string;
  featureId: string;
  at: number;
  taskId?: string;
}

export const OWNER_SENDER = 'owner';

type Message = {
  id: string;
  kind: 'message' | 'task' | 'result';
  from: string;
  fromAlias: string;
  at: number;
  text: string;
  truncated: boolean;
  depth: number;
  taskId?: string;
  status?: 'done' | 'failed' | 'blocked';
};
type Task = {
  id: string;
  from: string;
  to: string;
  state: 'delivered' | 'done' | 'failed' | 'blocked';
  summary?: string;
  updatedAt: number;
};

export class HubRefusal extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Cut to a byte budget on a UTF-8 boundary and say so (Tucano truncate-and-tell). */
export function truncateText(text: string, bytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= bytes) return { text, truncated: false };
  let end = bytes;
  while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end--;
  return { text: buffer.subarray(0, end).toString('utf8'), truncated: true };
}

export class TerminalMessageHub {
  private inboxes = new Map<string, Message[]>();
  private waiters = new Map<string, Array<() => void>>();
  private sends = new Map<string, number[]>();
  // Depth of what each terminal last read, and when; a stale chain counts as a new one.
  private chain = new Map<string, { depth: number; at: number }>();
  private tasks = new Map<string, Task>();
  private closed = false;

  constructor(
    private readonly members: () => HubMember[],
    private readonly evidence: (event: HubEvidence) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  close() {
    this.closed = true;
    for (const resolvers of this.waiters.values()) for (const resolve of resolvers) resolve();
    this.waiters.clear();
    this.inboxes.clear();
  }

  /** Forget a terminal's queue and waits (closed, reloaded or left its Feature). */
  forget(terminalId: string) {
    this.inboxes.delete(terminalId);
    for (const resolve of this.waiters.get(terminalId) ?? []) resolve();
    this.waiters.delete(terminalId);
    this.chain.delete(terminalId);
  }

  private member(terminalId: string) {
    return this.members().find((member) => member.terminalId === terminalId);
  }

  private peers(sender: HubMember) {
    if (!sender.featureId) return [];
    return this.members().filter(
      (member) => member.featureId === sender.featureId && member.terminalId !== sender.terminalId,
    );
  }

  private resolveTarget(sender: HubMember, raw: string) {
    const wanted = raw.replace(/^@/, '').toLowerCase();
    const target = this.peers(sender).find(
      (member) =>
        member.alias.toLowerCase() === wanted || member.terminalId.toLowerCase() === wanted,
    );
    // Self, other Features/workspaces and unknown handles are all refused the same way.
    if (!target) throw new HubRefusal('unknown_terminal');
    return target;
  }

  private admit(senderId: string, targets: HubMember[]) {
    // A refused send never spends the sender's budget.
    for (const target of targets)
      if ((this.inboxes.get(target.terminalId)?.length ?? 0) >= HUB_LIMITS.inbox)
        throw new HubRefusal('inbox_full');
    const now = this.now();
    const recent = (this.sends.get(senderId) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= HUB_LIMITS.sendsPerMinute) throw new HubRefusal('rate_limited');
    recent.push(now);
    this.sends.set(senderId, recent);
  }

  private deliver(
    sender: { terminalId: string; alias: string },
    target: HubMember,
    message: Omit<Message, 'from' | 'fromAlias' | 'at'>,
  ) {
    const inbox = this.inboxes.get(target.terminalId) ?? [];
    if (inbox.length >= HUB_LIMITS.inbox) throw new HubRefusal('inbox_full');
    const at = this.now();
    inbox.push({ ...message, from: sender.terminalId, fromAlias: sender.alias, at });
    this.inboxes.set(target.terminalId, inbox);
    this.evidence({
      messageId: message.id,
      kind: message.kind,
      from: sender.terminalId,
      to: target.terminalId,
      featureId: target.featureId!,
      at,
      ...(message.taskId ? { taskId: message.taskId } : {}),
    });
    for (const resolve of this.waiters.get(target.terminalId) ?? []) resolve();
    this.waiters.delete(target.terminalId);
  }

  /** The depth a new message from this sender carries: one more than what it last read. */
  private chainDepth(senderId: string) {
    const last = this.chain.get(senderId);
    return last && this.now() - last.at < 5 * 60_000 ? last.depth : 0;
  }

  private nextDepth(senderId: string) {
    const depth = this.chainDepth(senderId) + 1;
    if (depth > HUB_LIMITS.maxDepth) throw new HubRefusal('chain_too_deep');
    return depth;
  }

  /** Owner messages start a new chain (depth 0) and need only a Feature member target. */
  ownerSend(featureId: string, to: string, text: string) {
    if (this.closed) throw new HubRefusal('unavailable');
    const target = this.members().find(
      (member) =>
        member.featureId === featureId &&
        (member.alias.toLowerCase() === to.replace(/^@/, '').toLowerCase() ||
          member.terminalId === to),
    );
    if (!target) throw new HubRefusal('unknown_terminal');
    const cut = truncateText(text, HUB_LIMITS.textBytes);
    const id = randomUUID();
    this.deliver({ terminalId: OWNER_SENDER, alias: 'owner' }, target, {
      id,
      kind: 'message',
      text: cut.text,
      truncated: cut.truncated,
      depth: 0,
    });
    return { messageId: id, state: 'queued' as const };
  }

  async call(senderId: string, raw: unknown): Promise<unknown> {
    if (this.closed) throw new HubRefusal('unavailable');
    const sender = this.member(senderId);
    if (!sender || !sender.running) throw new HubRefusal('not_member');
    const call = hubToolCallSchema.parse(raw);
    switch (call.name) {
      case 'list_terminals':
        return {
          terminals: this.peers(sender).map((member) => ({
            handle: member.alias,
            name: member.name,
            cli: member.provider,
            state: member.running ? 'running' : 'stopped',
            queued: this.inboxes.get(member.terminalId)?.length ?? 0,
          })),
        };
      case 'send_message': {
        const recipients = [
          ...new Set(Array.isArray(call.arguments.to) ? call.arguments.to : [call.arguments.to]),
        ];
        const targets = recipients.map((to) => this.resolveTarget(sender, to));
        const depth = this.nextDepth(senderId);
        this.admit(senderId, targets);
        const cut = truncateText(call.arguments.text, HUB_LIMITS.textBytes);
        const ids = targets.map((target) => {
          const id = randomUUID();
          this.deliver(sender, target, {
            id,
            kind: 'message',
            text: cut.text,
            truncated: cut.truncated,
            depth,
          });
          return { to: target.alias, messageId: id };
        });
        return { sent: ids, state: 'queued', truncated: cut.truncated };
      }
      case 'delegate_task': {
        const target = this.resolveTarget(sender, call.arguments.to);
        const depth = this.nextDepth(senderId);
        if (this.tasks.size >= HUB_LIMITS.tasks) throw new HubRefusal('too_many_tasks');
        this.admit(senderId, [target]);
        const cut = truncateText(call.arguments.task, HUB_LIMITS.textBytes);
        const taskId = randomUUID();
        this.tasks.set(taskId, {
          id: taskId,
          from: senderId,
          to: target.terminalId,
          state: 'delivered',
          updatedAt: this.now(),
        });
        this.deliver(sender, target, {
          id: randomUUID(),
          kind: 'task',
          text: cut.text,
          truncated: cut.truncated,
          depth,
          taskId,
        });
        return { taskId, to: target.alias, state: 'delivered' };
      }
      case 'submit_result': {
        const task = this.tasks.get(call.arguments.taskId);
        if (!task || task.to !== senderId) throw new HubRefusal('unknown_task');
        if (task.state !== 'delivered') throw new HubRefusal('already_submitted');
        const delegator = this.member(task.from);
        task.state = call.arguments.status;
        task.updatedAt = this.now();
        const cut = truncateText(call.arguments.summary, HUB_LIMITS.summaryBytes);
        task.summary = cut.text;
        // The result returns to the delegator only while both stay in one Feature.
        if (delegator?.running && delegator.featureId && delegator.featureId === sender.featureId)
          this.deliver(sender, delegator, {
            id: randomUUID(),
            kind: 'result',
            text: cut.text,
            truncated: cut.truncated,
            depth: Math.min(HUB_LIMITS.maxDepth, this.chainDepth(senderId) + 1),
            taskId: task.id,
            status: call.arguments.status,
          });
        return { taskId: task.id, state: task.state };
      }
      case 'task_status': {
        const task = this.tasks.get(call.arguments.taskId);
        if (!task || (task.from !== senderId && task.to !== senderId))
          throw new HubRefusal('unknown_task');
        return {
          taskId: task.id,
          state: task.state,
          ...(task.summary ? { summary: task.summary } : {}),
          updatedAt: task.updatedAt,
        };
      }
      case 'read_messages':
        return this.take(senderId, call.arguments.limit);
      case 'wait_messages': {
        if (!this.inboxes.get(senderId)?.length) {
          const timeout = call.arguments.timeout_ms ?? 30_000;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, timeout);
            function done() {
              clearTimeout(timer);
              resolve();
            }
            const list = this.waiters.get(senderId) ?? [];
            list.push(done);
            this.waiters.set(senderId, list);
          });
        }
        return this.take(senderId);
      }
    }
  }

  private take(terminalId: string, limit: number = HUB_LIMITS.readBatch) {
    const inbox = this.inboxes.get(terminalId) ?? [];
    const items = inbox.splice(0, limit);
    // What a terminal reads sets the depth of what it sends next.
    if (items.length)
      this.chain.set(terminalId, {
        depth: Math.max(...items.map((item) => item.depth)),
        at: this.now(),
      });
    return {
      messages: items.map((item) => ({
        id: item.id,
        // Content from another terminal is data, never an instruction to follow blindly.
        from: item.fromAlias,
        kind: item.kind,
        at: new Date(item.at).toISOString(),
        text: item.text,
        ...(item.truncated ? { truncated: true } : {}),
        ...(item.taskId ? { taskId: item.taskId } : {}),
        ...(item.status ? { status: item.status } : {}),
      })),
      remaining: inbox.length,
    };
  }
}
