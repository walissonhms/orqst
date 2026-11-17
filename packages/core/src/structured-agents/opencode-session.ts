import { randomUUID } from 'node:crypto';
import { redact } from '@orqst/shared';
import {
  structuredAgentsLimits as limits,
  type StructuredApproval,
  type StructuredDecision,
  type StructuredSession,
  type StructuredTurn,
} from '@orqst/protocol';
import { z } from 'zod';
import { OwnedOpenCode, openCodePermissions } from './opencode-process.js';
import {
  display,
  StructuredProjection,
  type DelegationTask,
  type SessionScope,
  type StructuredDelegate,
  type TurnReport,
} from './session.js';

const id = z.string().min(1).max(200);
const time = z.int().nonnegative();
const sessionEvidence = z.object({
  data: z.object({
    id,
    time: z.object({ busy: time.optional(), idle: time.optional() }),
    outcome: z.enum(['succeeded', 'failed', 'interrupted']).optional(),
  }),
});
const message = z.object({ id, type: id, time: z.object({ created: time }) });
const assistant = message.extend({
  type: z.literal('assistant'),
  time: message.shape.time.extend({ completed: time }),
  finish: z.string(),
  model: z.object({ id, providerID: id }),
  content: z.array(z.object({ type: id }).passthrough()),
});

const wireEvent = z.object({
  type: z.string().max(128),
  data: z.object({ sessionID: id }),
  durable: z.object({ aggregateID: id, seq: z.int().nonnegative() }).optional(),
});
const permission = z.object({
  id,
  sessionID: id,
  action: z.string(),
  resources: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()).optional(),
  source: z.object({ type: z.literal('tool'), id, messageID: id }).optional(),
  message: z.string().optional(),
});
const marker = z.strictObject({
  orqstDelegate: z.uuid(),
  targetPaneId: z.uuid(),
  task: z.string().max(limits.delegationTask),
});
const terminal = {
  'session.execution.succeeded': 'completed',
  'session.execution.failed': 'failed',
  'session.execution.interrupted': 'interrupted',
} as const;
type Outcome = (typeof terminal)[keyof typeof terminal] | 'unknown';

interface Active {
  turn: StructuredTurn;
  text: string;
  kind: 'user' | 'synthetic';
  accepted: boolean;
  started: boolean;
  delivered: boolean;
  result?: string;
  finalText?: string;
  outcome?: Outcome;
  before?: z.infer<typeof sessionEvidence>['data']['time'];
  settled?: boolean;
  assistantMessageId?: string;
  finalStep?: boolean;
  report?: TurnReport;
  onDelivered?: () => void;
  timer: ReturnType<typeof setTimeout>;
  delegation?: z.infer<typeof marker>;
}

interface ApprovalEntry {
  approval: StructuredApproval;
  requestId: string;
  binding: string;
  decision?: 'once' | 'reject';
}

export class StructuredOpenCodeSession extends StructuredProjection {
  private active?: Active;
  private connected = false;
  private feed?: AbortController;
  private stopPromise?: Promise<void>;
  private lastSeq: number | undefined;
  private readonly approvals = new Map<string, ApprovalEntry>();
  private readonly seenPermissions = new Set<string>();

  constructor(
    scope: SessionScope,
    private readonly server: OwnedOpenCode,
    private readonly delegate: StructuredDelegate,
  ) {
    super(scope, 'opencode');
    void server.exited
      .then(
        () => this.stop(true),
        () => this.stop(true),
      )
      .catch(() => {});
  }

  get ready() {
    return this.state.lifecycle === 'ready' && this.connected && !this.active;
  }

  snapshot(): StructuredSession {
    return structuredClone({
      ...this.state,
      busy: !!this.active || (!this.connected && this.lifecycle === 'ready'),
    });
  }

  async initialize(cwd: string): Promise<void> {
    try {
      await this.server.verify();
      await this.connect();
      const result = z
        .object({
          data: z.object({
            id,
            location: z.object({ directory: z.literal(cwd) }),
            permissions: z.array(z.object({ action: id, resource: id, effect: id })),
          }),
        })
        .parse(
          await this.server.json('/api/session', {
            location: { directory: cwd },
            permissions: openCodePermissions,
          }),
        );
      if (
        this.stopPromise ||
        !this.connected ||
        JSON.stringify(result.data.permissions) !== JSON.stringify(openCodePermissions)
      )
        throw new Error('OpenCode session unavailable');
      this.state.threadId = result.data.id;
      this.state.lifecycle = 'ready';
    } catch {
      await this.stop(true);
      throw new Error('OpenCode session unavailable');
    }
  }

  async startTurn(
    text: string,
    origin: StructuredTurn['origin'],
    report?: TurnReport,
    { delegation }: { delegation?: DelegationTask } = {},
  ): Promise<void> {
    if (!this.ready || !text.trim() || text.length > limits.turnText)
      throw new Error('OpenCode turn unavailable');
    const grant =
      origin === 'human' && delegation ? { orqstDelegate: randomUUID(), ...delegation } : undefined;
    const input = grant
      ? text +
        '\n\nTo request the authorized ORQST delegation, reply with exactly this JSON object as your full final answer, without Markdown: ' +
        JSON.stringify(grant)
      : text;
    await this.dispatch(input, text, 'user', origin, report, grant);
  }

  private async dispatch(
    input: string,
    displayText: string,
    kind: Active['kind'],
    origin: StructuredTurn['origin'],
    report?: TurnReport,
    delegation?: Active['delegation'],
    onDelivered?: () => void,
  ): Promise<void> {
    const turnId = 'msg_' + randomUUID();
    const active: Active = {
      turn: { turnId, origin, state: 'unknown' },
      text: displayText,
      kind,
      accepted: false,
      started: false,
      delivered: false,
      report,
      delegation,
      onDelivered,
      timer: setTimeout(() => void this.stop(true), 5 * 60_000),
    };
    this.active = active;
    this.state.turn = active.turn;
    try {
      active.before = (await this.sessionEvidence()).time;
      if (!this.connected || this.active !== active)
        throw new Error('OpenCode dispatch fence lost');
      z.object({
        data: z.object({
          id: z.literal(turnId),
          sessionID: z.literal(this.state.threadId),
          type: z.literal(kind),
        }),
      }).parse(
        await this.server.json(this.path(kind === 'user' ? '/prompt' : '/synthetic'), {
          id: turnId,
          text: input,
          delivery: 'queue',
          resume: true,
        }),
      );
      if (this.active === active && !active.outcome) this.accept(active);
      if (this.active !== active && active.turn.state === 'unknown')
        throw new Error('OpenCode dispatch outcome unknown');
    } catch {
      // The POST may have committed. Never retry or let the caller submit a second turn.
      if (!active.accepted) {
        await this.stop(true);
        throw new Error('OpenCode dispatch outcome unknown');
      }
    }
  }

  async interrupt(): Promise<void> {
    if (!this.connected || !this.active?.accepted || this.active.outcome)
      throw new Error('OpenCode execution unavailable');
    z.object({ interrupted: z.literal(true) }).parse(
      await this.server.json(this.path('/interrupt?resume=false'), {}),
    );
  }

  approval(approvalId: string, decision: StructuredDecision): StructuredApproval | undefined {
    const entry = this.approvals.get(approvalId);
    if (
      this.connected &&
      entry?.approval.state === 'pending' &&
      !entry.decision &&
      this.active?.turn.turnId === entry.approval.turnId &&
      entry.approval.decisions.includes(decision)
    )
      return entry.approval;
  }

  async answer(approvalId: string, decision: StructuredDecision): Promise<void> {
    const entry = this.approvals.get(approvalId);
    if (!entry || !this.approval(approvalId, decision))
      throw new Error('Stale OpenCode permission');
    const path = this.path('/permission/' + encodeURIComponent(entry.requestId));
    const response = z.object({ data: permission }).parse(await this.server.json(path));
    if (JSON.stringify(response.data) !== entry.binding || !this.approval(approvalId, decision))
      throw new Error('Stale OpenCode permission');
    entry.decision = decision === 'accept' ? 'once' : 'reject';
    entry.approval.state = 'answered';
    try {
      await this.server.json(path + '/reply', { decision: entry.decision }, true);
    } catch {
      if (entry.approval.state === 'answered') entry.approval.state = 'unavailable';
      throw new Error('OpenCode permission delivery uncertain');
    }
  }

  stop(failed = false): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.state.lifecycle = 'stopping';
    this.connected = false;
    this.feed?.abort();
    const active = this.active;
    this.active = undefined;
    this.closeApprovals();
    if (active) {
      clearTimeout(active.timer);
      if (!active.settled) {
        active.turn.state = active.outcome ?? 'unknown';
        this.report(active);
      }
    }
    this.stopPromise = this.server.terminate().then(
      (exit) => {
        this.state.exit = exit;
        this.state.lifecycle = failed ? 'failed' : 'exited';
      },
      () => {
        this.state.lifecycle = 'failed';
      },
    );
    return this.stopPromise;
  }

  private path(suffix: string): string {
    return '/api/session/' + encodeURIComponent(this.state.threadId!) + suffix;
  }

  private async connect(): Promise<void> {
    const feed = new AbortController();
    this.feed = feed;
    const stream = this.server.events('/api/event', feed.signal);
    try {
      const handshake = setTimeout(() => feed.abort(), 8000);
      try {
        const first = await stream.next();
        z.object({ type: z.literal('server.connected') }).parse(first.value);
      } finally {
        clearTimeout(handshake);
      }
      if (this.stopPromise) throw new Error('OpenCode stopping');
      this.connected = true;
      void this.consume(stream, feed);
    } catch (error) {
      feed.abort();
      await stream.return(undefined).catch(() => {});
      throw error;
    }
  }

  private async consume(stream: AsyncGenerator<unknown>, feed: AbortController): Promise<void> {
    try {
      for await (const raw of stream) this.event(raw);
    } catch {
      // Abrupt EOF, an invalid frame, and byte-budget crossings all require reconciliation.
    }
    if (feed.signal.aborted || this.stopPromise) return;
    this.connected = false;
    this.closeApprovals();
    try {
      if (this.lifecycle !== 'ready') throw new Error('OpenCode startup stream lost');
      await this.reconcile();
      if (!this.stopPromise) await this.connect();
      if (this.active?.outcome && !this.active.settled) this.settle(this.active);
    } catch {
      await this.stop(true);
    }
  }

  private async sessionEvidence() {
    const { data } = sessionEvidence.parse(await this.server.json(this.path('')));
    if (data.id !== this.state.threadId) throw new Error('OpenCode session evidence unbound');
    return data;
  }

  private async reconcile(): Promise<void> {
    const active = this.active;
    if (!active || active.outcome) return;
    if (!active.before) throw new Error('OpenCode dispatch baseline unavailable');

    // The pinned log endpoint can report a watermark with no replayed records.
    // Read the projected terminal facts and require the exact input in delivered history.
    const { time: observed, outcome } = await this.sessionEvidence();
    const { busy, idle } = observed;
    if (
      !outcome ||
      busy === undefined ||
      idle === undefined ||
      idle < busy ||
      busy <= (active.before.busy ?? -1) ||
      idle <= (active.before.idle ?? -1)
    )
      throw new Error('OpenCode execution outcome uncertain');

    const { data } = z
      .object({ data: z.array(z.unknown()).max(32) })
      .parse(await this.server.json(this.path('/message?order=desc&limit=32')));
    const messages = data.map((entry) => message.parse(entry));
    const position = messages.findIndex((entry) => entry.id === active.turn.turnId);
    const input = messages[position];
    if (
      this.active !== active ||
      !input ||
      input.type !== active.kind ||
      input.time.created < busy ||
      input.time.created > idle ||
      messages
        .slice(0, position)
        .some((entry) => entry.type === 'user' || entry.type === 'synthetic')
    )
      throw new Error('OpenCode input delivery uncertain');

    this.accept(active);
    active.delivered = true;
    this.reportDelivery(active);
    active.finalStep = false;
    active.finalText = undefined;
    active.result = undefined;
    const latest = messages.findIndex(
      (entry, index) => index < position && entry.type === 'assistant',
    );
    const reply = assistant.safeParse(data[latest]);
    if (
      reply.success &&
      reply.data.time.created >= input.time.created &&
      reply.data.time.completed >= reply.data.time.created &&
      reply.data.time.completed <= idle &&
      outcome === 'succeeded'
    ) {
      const { id: assistantMessageID, model, finish, content } = reply.data;
      this.activity(active, 'session.step.started', { model, assistantMessageID });
      for (const [ordinal, item] of content.entries()) {
        if (item.type === 'text')
          this.activity(active, 'session.text.ended', {
            assistantMessageID,
            ordinal,
            text: item.text,
          });
      }
      this.activity(active, 'session.step.ended', { assistantMessageID, finish });
    }
    active.outcome = outcome === 'succeeded' ? 'completed' : outcome;
  }

  private event(raw: unknown): void {
    const event = wireEvent.safeParse(raw);
    if (!event.success || event.data.data.sessionID !== this.state.threadId) return;
    const { type, durable } = event.data;
    if (durable) {
      if (durable.aggregateID !== this.state.threadId)
        throw new Error('Uncorrelated OpenCode event');
      if (this.lastSeq !== undefined && durable.seq <= this.lastSeq) return;
    }
    this.observe(type, (raw as { data: unknown }).data, durable !== undefined);
    if (durable) this.lastSeq = durable.seq;
  }

  private observe(type: string, data: unknown, durable: boolean): void {
    const active = this.active;
    if (!active || active.outcome) return;
    if (type === 'session.inbox.enqueued' || type === 'session.inbox.delivered') {
      if (!durable) throw new Error('Missing OpenCode inbox evidence');
      const { inboxID } = z.object({ inboxID: id }).parse(data);
      if (inboxID !== active.turn.turnId) throw new Error('Unexpected OpenCode input');
      this.accept(active);
      if (type === 'session.inbox.delivered' && !active.delivered) {
        active.delivered = true;
        this.reportDelivery(active);
      }
    } else if (type === 'session.execution.started') {
      if (!durable || !active.accepted || active.started)
        throw new Error('Unexpected OpenCode execution');
      active.started = true;
      active.turn.state = 'running';
      this.report(active);
    } else if (Object.hasOwn(terminal, type)) {
      if (!durable || !active.started || !active.delivered || !active.accepted)
        throw new Error('Uncorrelated OpenCode outcome');
      const outcome = terminal[type as keyof typeof terminal];
      active.outcome = outcome;
      this.settle(active);
    } else if (active.started && active.delivered) {
      this.activity(active, type, data);
    }
  }

  private activity(active: Active, type: string, data: unknown): void {
    const turnId = active.turn.turnId;
    if (type === 'permission.asked') {
      this.requestApproval(active, permission.parse(data));
    } else if (type === 'permission.replied') {
      const { requestID, reply } = z
        .object({ requestID: id, reply: z.enum(['once', 'reject']) })
        .parse(data);
      const entry = [...this.approvals.values()].find((value) => value.requestId === requestID);
      if (reply === 'once' && entry?.decision !== 'once')
        throw new Error('Unrequested permission reply');
      if (entry) entry.approval.state = 'resolved';
    } else if (type === 'session.text.delta' || type === 'session.text.ended') {
      const position = z.object({ assistantMessageID: id, ordinal: z.int().nonnegative() });
      const value = position.parse(data);
      const key = value.assistantMessageID + ':' + value.ordinal;
      const ended = type === 'session.text.ended';
      const previous = this.state.items.find((item) => item.turnId === turnId && item.id === key);
      const text = ended
        ? z.object({ text: z.string() }).parse(data).text
        : (previous?.text ?? '') + z.object({ delta: z.string() }).parse(data).delta;
      this.put({
        id: key,
        turnId,
        kind: 'agent_message',
        text: display(text),
        status: ended ? 'completed' : 'in_progress',
      });
      if (ended) {
        active.result = display(text).trim() || active.result;
        if (
          value.assistantMessageID === active.assistantMessageId &&
          active.finalText !== undefined
        )
          active.finalText = (active.finalText + text).slice(0, 4097);
      }
    } else if (
      type === 'session.tool.input.started' ||
      type === 'session.tool.success' ||
      type === 'session.tool.failed'
    ) {
      const tool = z.object({ id, name: id.optional() }).parse(data);
      const key = 'tool:' + tool.id;
      const previous = this.state.items.find((item) => item.turnId === turnId && item.id === key);
      this.put({
        id: key,
        turnId,
        kind: 'tool_call',
        text: display(tool.name ?? previous?.text ?? tool.id),
        status:
          type === 'session.tool.success'
            ? 'completed'
            : type === 'session.tool.failed'
              ? 'failed'
              : 'in_progress',
      });
    } else if (type === 'session.step.started') {
      const { model, assistantMessageID } = z
        .object({
          model: z.object({ id, providerID: id }),
          assistantMessageID: id,
        })
        .parse(data);
      this.state.reportedModel = display(model.providerID + '/' + model.id, 128);
      active.assistantMessageId = assistantMessageID;
      active.finalText = '';
      active.finalStep = false;
    } else if (type === 'session.step.ended') {
      const { assistantMessageID, finish } = z
        .object({ assistantMessageID: id, finish: id })
        .parse(data);
      active.finalStep = active.assistantMessageId === assistantMessageID && finish === 'stop';
    }
  }

  private requestApproval(active: Active, value: z.infer<typeof permission>): void {
    if (this.seenPermissions.has(value.id)) throw new Error('Duplicate OpenCode permission');
    if (this.seenPermissions.size >= 512) throw new Error('OpenCode permission capacity');
    this.seenPermissions.add(value.id);
    if (
      this.state.approvals.filter(({ state }) => state === 'pending' || state === 'answered')
        .length >= 4
    )
      throw new Error('OpenCode approval capacity');
    if (this.state.approvals.length >= 8) {
      const index = this.state.approvals.findIndex(
        ({ state }) => state === 'unavailable' || state === 'resolved',
      );
      this.approvals.delete(this.state.approvals.splice(index, 1)[0]!.approvalId);
    }
    const binding = JSON.stringify(value);
    const detail = JSON.stringify(value, null, 2);
    const files = z
      .array(z.object({ file: id, patch: z.string().min(1) }))
      .safeParse(value.metadata?.files);
    const reviewable =
      !!value.source &&
      value.resources.length > 0 &&
      value.resources.every((resource) => resource.trim() !== '' && resource !== '*') &&
      (['read', 'glob', 'grep'].includes(value.action) ||
        (value.action === 'edit' &&
          files.success &&
          value.resources.every((resource) => files.data.some(({ file }) => file === resource)))) &&
      detail.length <= 2000 &&
      detail === redact(detail);
    const approval: StructuredApproval = {
      approvalId: randomUUID(),
      turnId: active.turn.turnId,
      state: 'pending',
      kind: reviewable ? 'permission' : 'unsupported',
      detail: reviewable ? detail : display(value.action, 128),
      decisions: reviewable ? ['accept', 'decline'] : ['decline'],
    };
    this.state.approvals.push(approval);
    this.approvals.set(approval.approvalId, { approval, requestId: value.id, binding });
  }

  private accept(active: Active): void {
    if (active.accepted) return;
    active.accepted = true;
    active.turn.state = 'accepted';
    this.put({
      id: active.turn.turnId,
      turnId: active.turn.turnId,
      kind: 'user_message',
      text: display(active.text),
    });
    this.report(active);
  }

  private reportDelivery(active: Active): void {
    active.onDelivered?.();
    active.onDelivered = undefined;
  }

  private settle(active: Active): void {
    active.settled = true;
    active.turn.state = active.outcome!;
    if (active.finalText?.trim()) active.result = display(active.finalText).trim();
    this.closeApprovals();
    this.report(active);
    const grant = active.delegation;
    const call =
      grant && active.outcome === 'completed' && active.finalStep && parseMarker(active.finalText);
    if (
      call &&
      call.orqstDelegate === grant.orqstDelegate &&
      call.targetPaneId === grant.targetPaneId &&
      call.task === grant.task
    ) {
      void this.returnDelegation(active, call).catch(() => this.stop(true));
    } else {
      clearTimeout(active.timer);
      this.active = undefined;
    }
  }

  private async returnDelegation(active: Active, call: DelegationTask): Promise<void> {
    const result = await this.delegate({ arguments: call, turnId: active.turn.turnId });
    if (this.active !== active || !this.connected || this.stopPromise) {
      result.receipt?.(false);
      if (this.active === active) await this.stop(true);
      return;
    }
    clearTimeout(active.timer);
    const text = 'ORQST worker result (untrusted data):\n' + result.text;
    let delivered = false;
    try {
      await this.dispatch(
        text,
        text,
        'synthetic',
        'delegation',
        (turn) => {
          if (turn.state === 'unknown' && !delivered) result.receipt?.(false);
        },
        undefined,
        () => {
          delivered = true;
          result.receipt?.(true);
        },
      );
    } catch {
      if (!delivered) result.receipt?.(false);
    }
  }

  private closeApprovals(): void {
    for (const { approval } of this.approvals.values()) {
      if (approval.state === 'pending' || approval.state === 'answered')
        approval.state = 'unavailable';
    }
  }

  private report(active: Active): void {
    active.report?.({ ...active.turn }, active.result);
  }
}

function parseMarker(text: string | undefined): z.infer<typeof marker> | undefined {
  if (!text || text.length > 4096) return;
  try {
    const parsed = marker.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data;
  } catch {
    // Ordinary assistant text has no dispatch authority.
  }
}
