// Feature-scoped messaging between ORQST terminals (docs/design/mcp-n-terminals.md).
// Tool surface adapted from Anywh 51bca54 relay/src/session/roomTools.ts (Apache-2.0) and
// limits from Tucano 91061b0 src/core/runs.ts (Apache-2.0); see docs/research/mcp-n-terminals.md.
// Pure in-memory logic: no socket, PTY, process or persistence of message content.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { InspectorCommand, InspectorReply, InspectorRow } from '@orqst/protocol';

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
  featureId: string;
  at: number;
  text: string;
  truncated: boolean;
  depth: number;
  taskId?: string;
  status?: 'done' | 'failed' | 'blocked';
};
type HistoryEntry = {
  id: string;
  from: string;
  target: HubMember;
  featureId: string;
  kind: Message['kind'];
  text: string;
  truncated: boolean;
  at: number;
  taskId?: string;
  delivery: InspectorRow['delivery'];
  retried?: boolean;
};

type Task = {
  id: string;
  from: string;
  to: string;
  featureId: string;
  state: 'queued' | 'dequeued' | 'done' | 'failed' | 'blocked';
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
  private history = new Map<string, HistoryEntry>();
  private relays = new Set<string>();
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
    this.history.clear();
    this.relays.clear();
  }

  /** Forget a terminal's queue and waits (closed, reloaded or left its Feature). */
  forget(terminalId: string) {
    this.inboxes.delete(terminalId);
    this.relays.delete(terminalId);
    for (const entry of this.history.values())
      if (entry.target.terminalId === terminalId && entry.delivery === 'queued')
        entry.delivery = 'target_ended';
    for (const resolve of this.waiters.get(terminalId) ?? []) resolve();
    this.waiters.delete(terminalId);
    this.chain.delete(terminalId);
  }

  relayConnected(terminalId: string, connected: boolean) {
    if (connected && !this.closed) this.relays.add(terminalId);
    else this.relays.delete(terminalId);
  }

  private peers(sender: HubMember, members: HubMember[]) {
    if (!sender.featureId) return [];
    return members.filter(
      (member) => member.featureId === sender.featureId && member.terminalId !== sender.terminalId,
    );
  }

  private resolveTarget(sender: HubMember, members: HubMember[], raw: string) {
    if (raw.includes('/')) throw new HubRefusal('not_permitted');
    const wanted = raw.replace(/^@/, '').toLowerCase();
    const targets = this.peers(sender, members).filter(
      (member) =>
        member.alias.toLowerCase() === wanted || member.terminalId.toLowerCase() === wanted,
    );
    // Self, other Features/workspaces and unknown handles are all refused the same way.
    if (targets.length !== 1) throw new HubRefusal('unknown_terminal');
    return targets[0]!;
  }

  private inbox(target: HubMember, members: HubMember[]) {
    const queue = (this.inboxes.get(target.terminalId) ?? []).filter(
      (item) =>
        item.featureId === target.featureId &&
        (item.from === OWNER_SENDER ||
          members.some(
            (sender) => sender.terminalId === item.from && sender.featureId === item.featureId,
          )),
    );
    const kept = new Set(queue.map(({ id }) => id));
    for (const item of this.inboxes.get(target.terminalId) ?? []) {
      const entry = this.history.get(item.id);
      if (entry && !kept.has(item.id)) entry.delivery = 'unknown';
    }
    this.inboxes.set(target.terminalId, queue);
    return queue;
  }

  private taskScope(task: Task, members: HubMember[]) {
    const hasMember = (id: string) =>
      members.some((member) => member.terminalId === id && member.featureId === task.featureId);
    return hasMember(task.from) && hasMember(task.to);
  }

  private admit(senderId: string, targets: HubMember[], members: HubMember[]) {
    // A refused send never spends the sender's budget.
    for (const target of targets)
      if (this.inbox(target, members).length >= HUB_LIMITS.inbox)
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
    message: Omit<Message, 'from' | 'fromAlias' | 'at' | 'featureId'>,
  ) {
    const inbox = this.inboxes.get(target.terminalId) ?? [];
    if (inbox.length >= HUB_LIMITS.inbox) throw new HubRefusal('inbox_full');
    const at = this.now();
    inbox.push({
      ...message,
      from: sender.terminalId,
      fromAlias: sender.alias,
      featureId: target.featureId!,
      at,
    });
    this.inboxes.set(target.terminalId, inbox);
    this.history.set(message.id, {
      id: message.id,
      target: { ...target },
      from: sender.terminalId,
      featureId: target.featureId!,
      kind: message.kind,
      at,
      text: message.text,
      truncated: message.truncated,
      taskId: message.taskId,
      delivery: 'queued',
    });
    if (this.history.size > 128) this.history.delete(this.history.keys().next().value!);
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
    const members = this.members();
    const targets = members.filter(
      (member) =>
        member.featureId === featureId &&
        (member.alias.toLowerCase() === to.replace(/^@/, '').toLowerCase() ||
          member.terminalId === to),
    );
    if (targets.length !== 1) throw new HubRefusal('unknown_terminal');
    const target = targets[0]!;
    this.inbox(target, members);
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

  inspect(command: InspectorCommand): InspectorReply {
    if (this.closed) return { status: 'refused', code: 'unavailable' };
    const members = this.members();
    const member = (id: string) =>
      members.find((entry) => entry.terminalId === id && entry.featureId === command.featureId);
    const live = (id: string) => !!member(id)?.running && this.relays.has(id);
    const allowedRetry = (entry: HistoryEntry) =>
      !entry.retried &&
      entry.kind !== 'result' &&
      (entry.delivery === 'target_ended' ||
        (entry.taskId !== undefined && this.tasks.get(entry.taskId)?.state === 'failed')) &&
      live(entry.target.terminalId) &&
      member(entry.target.terminalId)?.provider === entry.target.provider &&
      (entry.from === OWNER_SENDER || live(entry.from));
    if (command.kind === 'read') {
      const rows = [...this.history.values()]
        .reverse()
        .filter((entry) => entry.featureId === command.featureId)
        .slice(0, 20)
        .map((entry): InspectorRow => {
          const preview = truncateText(entry.text, 1200);
          const task = entry.taskId ? this.tasks.get(entry.taskId)?.state : undefined;
          return {
            id: entry.id,
            from: entry.from,
            to: entry.target.terminalId,
            kind: entry.kind,
            at: entry.at,
            text: preview.text,
            truncated: entry.truncated || preview.truncated,
            delivery:
              entry.delivery === 'queued' &&
              (!member(entry.target.terminalId) ||
                (entry.from !== OWNER_SENDER && !member(entry.from)))
                ? 'unknown'
                : entry.delivery,
            ...(entry.taskId ? { taskId: entry.taskId } : {}),
            ...(task ? { task } : {}),
            retryable: allowedRetry(entry),
          };
        });
      const recipients = members
        .filter((entry) => entry.featureId === command.featureId)
        .map(({ terminalId }) => terminalId);
      return {
        status: 'ok',
        featureId: command.featureId,
        rows,
        recipients,
        senders: recipients.filter(live),
      };
    }
    const previous = command.kind === 'retry' ? this.history.get(command.id) : undefined;
    if (
      command.kind === 'retry' &&
      (!previous || previous.featureId !== command.featureId || !allowedRetry(previous))
    )
      return { status: 'refused', code: 'not_permitted' };
    if (previous) previous.retried = true;
    try {
      if (command.kind === 'send' && command.targetFeatureId !== command.featureId)
        throw new HubRefusal('not_permitted');
      const from = command.kind === 'send' ? command.from : previous!.from;
      const to = command.kind === 'send' ? command.to : [previous!.target.terminalId];
      const text = command.kind === 'send' ? command.text : previous!.text;
      const task = command.kind === 'send' ? command.task : previous!.kind === 'task';
      if (from !== OWNER_SENDER && !member(from)) throw new HubRefusal('sender_unassigned');
      if (to.some((id) => !member(id) || id === from)) throw new HubRefusal('unknown_terminal');
      if (from !== OWNER_SENDER && !live(from)) throw new HubRefusal('not_permitted');
      if (task && (to.length !== 1 || from === OWNER_SENDER)) throw new HubRefusal('not_permitted');
      if (from === OWNER_SENDER) {
        this.admit(
          from,
          to.map((id) => member(id)!),
          members,
        );
        for (const id of to) this.ownerSend(command.featureId, id, text);
      } else if (task) {
        this.dispatch(from, { name: 'delegate_task', arguments: { to: to[0], task: text } }, true);
      } else {
        this.dispatch(from, { name: 'send_message', arguments: { to, text } }, true);
      }
      return { status: 'queued' };
    } catch (error) {
      if (previous && error instanceof HubRefusal) previous.retried = false;
      if (!(error instanceof HubRefusal)) throw error;
      const code = error.code;
      if (
        code === 'sender_unassigned' ||
        code === 'unknown_terminal' ||
        code === 'not_permitted' ||
        code === 'inbox_full' ||
        code === 'rate_limited' ||
        code === 'too_many_tasks' ||
        code === 'chain_too_deep'
      )
        return { status: 'refused', code };
      return { status: 'refused', code: 'unavailable' };
    }
  }

  async call(senderId: string, raw: unknown): Promise<unknown> {
    return this.dispatch(senderId, raw);
  }

  private dispatch(senderId: string, raw: unknown, ownerInitiated = false): unknown {
    if (this.closed) throw new HubRefusal('unavailable');
    const members = this.members();
    const sender = members.find((member) => member.terminalId === senderId);
    if (!sender || !sender.running) throw new HubRefusal('not_member');
    const call = hubToolCallSchema.parse(raw);
    switch (call.name) {
      case 'list_terminals':
        if (!sender.featureId) throw new HubRefusal('sender_unassigned');
        return {
          terminals: this.peers(sender, members).map((member) => ({
            handle: member.alias,
            name: member.name,
            cli: member.provider,
            state: !member.running
              ? 'stopped'
              : this.relays.has(member.terminalId)
                ? 'mcp_connected'
                : 'unconfirmed',
            queued: this.inbox(member, members).length,
          })),
        };
      case 'send_message': {
        if (!sender.featureId) throw new HubRefusal('sender_unassigned');
        const recipients = Array.isArray(call.arguments.to)
          ? call.arguments.to
          : [call.arguments.to];
        const targets = [
          ...new Map(
            recipients.map((to) => {
              const target = this.resolveTarget(sender, members, to);
              return [target.terminalId, target];
            }),
          ).values(),
        ];
        const depth = ownerInitiated ? 0 : this.nextDepth(senderId);
        this.admit(senderId, targets, members);
        const cut = truncateText(call.arguments.text, HUB_LIMITS.textBytes);
        const ids = targets.map((target) => {
          const id = randomUUID();
          this.deliver(
            ownerInitiated ? { ...sender, alias: 'owner via ' + sender.alias } : sender,
            target,
            {
              id,
              kind: 'message',
              text: cut.text,
              truncated: cut.truncated,
              depth,
            },
          );
          return { to: target.alias, messageId: id };
        });
        // The chain travels with the recipients; the sender's next message starts over.
        if (!ownerInitiated) this.chain.delete(senderId);
        return { sent: ids, state: 'queued', truncated: cut.truncated };
      }
      case 'delegate_task': {
        if (!sender.featureId) throw new HubRefusal('sender_unassigned');
        const target = this.resolveTarget(sender, members, call.arguments.to);
        const depth = ownerInitiated ? 0 : this.nextDepth(senderId);
        const pending = (task: Task) =>
          (task.state === 'queued' || task.state === 'dequeued') && this.taskScope(task, members);
        const open = [...this.tasks.values()].filter(pending);
        if (open.length >= HUB_LIMITS.tasks) throw new HubRefusal('too_many_tasks');
        // Finished tasks stay queryable for a while; the oldest are dropped past 256.
        if (this.tasks.size >= 256)
          for (const [id, task] of this.tasks)
            if (!pending(task)) {
              this.tasks.delete(id);
              if (this.tasks.size < 256) break;
            }
        this.admit(senderId, [target], members);
        const cut = truncateText(call.arguments.task, HUB_LIMITS.textBytes);
        const taskId = randomUUID();
        this.tasks.set(taskId, {
          id: taskId,
          from: senderId,
          to: target.terminalId,
          featureId: target.featureId!,
          state: 'queued',
          updatedAt: this.now(),
        });
        this.deliver(
          ownerInitiated ? { ...sender, alias: 'owner via ' + sender.alias } : sender,
          target,
          {
            id: randomUUID(),
            kind: 'task',
            text: cut.text,
            truncated: cut.truncated,
            depth,
            taskId,
          },
        );
        if (!ownerInitiated) this.chain.delete(senderId);
        return { taskId, to: target.alias, state: 'queued' };
      }
      case 'submit_result': {
        const task = this.tasks.get(call.arguments.taskId);
        if (!task || task.to !== senderId || !this.taskScope(task, members))
          throw new HubRefusal('unknown_task');
        if (task.state === 'queued') throw new HubRefusal('task_unread');
        if (task.state !== 'dequeued') throw new HubRefusal('already_submitted');
        const delegator = members.find((member) => member.terminalId === task.from)!;
        task.state = call.arguments.status;
        task.updatedAt = this.now();
        const cut = truncateText(call.arguments.summary, HUB_LIMITS.summaryBytes);
        task.summary = cut.text;
        const resultQueued =
          delegator.running && this.inbox(delegator, members).length < HUB_LIMITS.inbox;
        if (resultQueued)
          this.deliver(sender, delegator, {
            id: randomUUID(),
            kind: 'result',
            text: cut.text,
            truncated: cut.truncated,
            // A result closes its task: it does not deepen the chain, so an orchestrator can
            // delegate again after reading it (each delegation still costs rate budget).
            depth: 0,
            taskId: task.id,
            status: call.arguments.status,
          });
        return { taskId: task.id, state: task.state, resultQueued };
      }
      case 'task_status': {
        const task = this.tasks.get(call.arguments.taskId);
        if (
          !task ||
          (task.from !== senderId && task.to !== senderId) ||
          !this.taskScope(task, members)
        )
          throw new HubRefusal('unknown_task');
        return {
          taskId: task.id,
          state: task.state,
          ...(task.summary ? { summary: task.summary } : {}),
          updatedAt: task.updatedAt,
        };
      }
      case 'read_messages':
        return this.take(sender, members, call.arguments.limit);
      case 'wait_messages':
        return this.wait(sender, members, call.arguments.timeout_ms);
    }
  }

  private async wait(sender: HubMember, members: HubMember[], timeoutMs?: number) {
    const senderId = sender.terminalId;
    if (!this.inbox(sender, members).length) {
      const timeout = timeoutMs ?? 30_000;
      await new Promise<void>((resolve) => {
        const waiters = this.waiters;
        const timer = setTimeout(done, timeout);
        function done() {
          clearTimeout(timer);
          // A timed-out wait removes itself; nothing accumulates across calls.
          const current = waiters.get(senderId);
          if (current) {
            const rest = current.filter((entry) => entry !== done);
            if (rest.length) waiters.set(senderId, rest);
            else waiters.delete(senderId);
          }
          resolve();
        }
        const list = waiters.get(senderId) ?? [];
        list.push(done);
        waiters.set(senderId, list);
      });
    }
    const current = this.members();
    const member = current.find((entry) => entry.terminalId === senderId);
    if (!member?.running || member.featureId !== sender.featureId)
      throw new HubRefusal('not_member');
    return this.take(member, current);
  }

  private take(sender: HubMember, members: HubMember[], limit: number = HUB_LIMITS.readBatch) {
    const inbox = this.inbox(sender, members);
    const items = inbox.splice(0, limit);
    for (const item of items) {
      const entry = this.history.get(item.id);
      if (entry) entry.delivery = 'delivered';
      const task = item.kind === 'task' && item.taskId ? this.tasks.get(item.taskId) : undefined;
      if (task?.state === 'queued') {
        task.state = 'dequeued';
        task.updatedAt = this.now();
      }
    }
    // What a terminal reads sets the depth of what it sends next.
    if (items.length)
      this.chain.set(sender.terminalId, {
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
