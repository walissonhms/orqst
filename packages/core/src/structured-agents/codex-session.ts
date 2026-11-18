import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { redact } from '@orqst/shared';
import {
  structuredAgentsLimits as limits,
  type StructuredApproval,
  type StructuredDecision,
  type StructuredItem,
  type StructuredSession,
  type StructuredTurn,
} from '@orqst/protocol';
import { CodexChannel, type CodexNotification } from '../managed-codex/channel.js';
import { delegationTool, dynamicCallSchema } from '../managed-codex/dynamic-tools.js';
import {
  display,
  StructuredProjection,
  type DelegationResult,
  type StructuredDelegate,
} from './session.js';
import type { StructuredProcessTransport } from './codex-process.js';
import { codexThreadUsage } from './usage.js';

const id = z.string().min(1).max(200);
const rpcId = z.union([z.string(), z.number()]);
const turn = z.object({
  id,
  status: z.enum(['inProgress', 'completed', 'failed', 'interrupted']),
});
const scope = z.object({ threadId: id, turnId: id });
const itemScope = scope.extend({ item: z.object({ id, type: z.string() }).passthrough() });
const approvalScope = scope.extend({ itemId: id });
const turnEvent = z.object({ threadId: id, turn });
const changes = z.array(
  z.object({ path: z.string(), kind: z.record(z.string(), z.unknown()), diff: z.string() }),
);
const turnMs = 5 * 60_000;
const commandStatus = z.enum(['inProgress', 'completed', 'failed', 'declined']);
const toolStatus = z.enum(['inProgress', 'completed', 'failed', 'interrupted']);

interface Active {
  input: string;
  finishWait?: () => void;
  origin: StructuredTurn['origin'];
  turn?: StructuredTurn;
  timer: ReturnType<typeof setTimeout>;
  early: CodexNotification[];
  result?: string;
  fileReviews: Map<string, string>;
  calls: Map<string, DelegationResult | null>;
  report?: (turn: StructuredTurn, result?: string) => void;
}

function status(value: z.infer<typeof commandStatus>): NonNullable<StructuredItem['status']> {
  return value === 'inProgress' ? 'in_progress' : value;
}

export class StructuredCodexSession extends StructuredProjection {
  private readonly channel: CodexChannel;
  private active?: Active;
  private approvals = new Map<string, { approval: StructuredApproval; rpcId: string | number }>();
  private stopPromise?: Promise<void>;

  constructor(
    scope: Pick<StructuredSession, 'featureId' | 'workspaceId' | 'label'>,
    private readonly process: StructuredProcessTransport,
    private readonly delegate: StructuredDelegate,
  ) {
    super(scope, 'codex');
    this.channel = new CodexChannel(process, true, {
      answerServerRequests: true,
      lineBytes: 1024 * 1024,
      sessionBytes: 24 * 1024 * 1024,
    });
    this.channel.onNotification((event) => this.receive(event));
    this.channel.onLost(() => {
      if (!this.stopPromise) void this.stop(true);
    });
  }

  get ready() {
    return this.state.lifecycle === 'ready' && this.channel.available && !this.active;
  }

  snapshot(): StructuredSession {
    return structuredClone({ ...this.state, busy: !!this.active });
  }

  async initialize(cwd: string): Promise<void> {
    try {
      await this.channel.request('initialize', {
        clientInfo: { name: 'orqst', title: 'ORQST', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      });
      this.channel.initialized();
      const reply = z
        .object({
          thread: z.object({ id, ephemeral: z.literal(true) }),
          model: z.string().min(1).max(128),
          cwd: z.literal(cwd),
          approvalPolicy: z.literal('on-request'),
          approvalsReviewer: z.literal('user'),
          sandbox: z.object({ type: z.literal('readOnly') }),
        })
        .parse(
          await this.channel.request('thread/start', {
            cwd,
            sandbox: 'read-only',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
            ephemeral: true,
            allowProviderModelFallback: false,
            dynamicTools: [delegationTool],
          }),
        );
      if (!this.channel.available || this.stopPromise) throw new Error('Session closed');
      this.state.threadId = reply.thread.id;
      this.state.reportedModel = display(reply.model, 128);
      this.state.lifecycle = 'ready';
    } catch {
      await this.stop(true);
      throw new Error('Codex thread unavailable');
    }
  }

  async startTurn(
    text: string,
    origin: StructuredTurn['origin'],
    report?: Active['report'],
    { parentTurnId }: { parentTurnId?: string } = {},
  ): Promise<void> {
    if (!this.ready || !text.trim() || Buffer.byteLength(text) > limits.turnText * 4)
      throw new Error('Codex turn unavailable');
    const active: Active = {
      input: text,
      origin,
      report,
      early: [],
      fileReviews: new Map(),
      calls: new Map(),
      timer: setTimeout(() => void this.stop(true), turnMs),
    };
    this.active = active;
    try {
      const reply = z.object({ turn }).parse(
        await this.channel.request('turn/start', {
          threadId: this.state.threadId,
          input: [{ type: 'text', text }],
          ...(parentTurnId ? { parentTurnId, rootTurnId: parentTurnId } : {}),
        }),
      );
      if (this.stopPromise || this.active !== active || reply.turn.status !== 'inProgress')
        throw new Error('Dispatch uncertain');
      active.turn = { turnId: reply.turn.id, state: 'accepted', origin };
      this.state.turn = active.turn;
      this.put({
        kind: 'user_message',
        id: randomUUID(),
        turnId: reply.turn.id,
        text: display(active.input),
      });
      this.report(active);
      for (const event of active.early) {
        if (this.active === active) this.event(active, event);
      }
      active.early = [];
    } catch {
      await this.stop(true);
      throw new Error('Codex dispatch outcome unknown');
    }
  }

  async interrupt(): Promise<void> {
    if (!this.active?.turn?.turnId) throw new Error('Active turn unavailable');
    await this.channel.request('turn/interrupt', {
      threadId: this.state.threadId,
      turnId: this.active.turn.turnId,
    });
  }

  approval(approvalId: string, decision: StructuredDecision): StructuredApproval | undefined {
    const request = this.approvals.get(approvalId)?.approval;
    if (
      this.channel.available &&
      request?.state === 'pending' &&
      this.active?.turn?.turnId === request.turnId &&
      request.decisions.includes(decision)
    )
      return request;
  }

  answer(approvalId: string, decision: StructuredDecision): void {
    const request = this.approvals.get(approvalId);
    if (!request || !this.approval(approvalId, decision)) throw new Error('Stale approval');
    this.channel.replyServerRequest(
      request.rpcId,
      request.approval.kind === 'unsupported'
        ? { error: { code: -32601, message: 'Request unavailable in ORQST Studio' } }
        : { result: { decision } },
    );
    request.approval.state = 'answered';
  }

  stop(failed = false): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.state.lifecycle = 'stopping';
    this.stopPromise = Promise.resolve().then(async () => {
      const active = this.active;
      if (!failed && active?.turn && this.channel.available) {
        const timer = new AbortController();
        const finished = new Promise<void>((resolve) => {
          active.finishWait = resolve;
        });
        try {
          await Promise.race([
            this.interrupt().then(() => finished),
            sleep(1000, undefined, { signal: timer.signal }),
          ]);
        } catch {
          // Fall back to the owned process group if interruption is unavailable.
        } finally {
          timer.abort();
        }
      }
      this.channel.detach();
      if (this.active) this.finish(this.active, 'unknown');
      this.state.exit = await this.process.terminate();
      this.state.lifecycle = failed ? 'failed' : 'exited';
    });
    return this.stopPromise;
  }

  private report(active: Active): void {
    if (active.turn) active.report?.({ ...active.turn }, active.result);
  }

  private finish(active: Active, result: 'completed' | 'failed' | 'interrupted' | 'unknown'): void {
    clearTimeout(active.timer);
    this.active = undefined;
    active.finishWait?.();
    for (const { approval } of this.approvals.values()) {
      if (approval.state === 'pending') approval.state = 'unavailable';
    }
    if (active.turn) active.turn.state = result;
    for (const call of active.calls.values()) call?.receipt?.(false);
    this.report(active);
  }

  private receive(event: CodexNotification): void {
    if (event.method === 'thread/tokenUsage/updated' && event.requestId === undefined) {
      const metric = codexThreadUsage(event.params, this.state.threadId);
      if (metric && metric.usage.total >= (this.state.usage?.usage.total ?? 0))
        this.state.usage = metric;
      return;
    }
    if (this.stopPromise && !['turn/completed', 'serverRequest/resolved'].includes(event.method))
      return;
    const active = this.active;
    try {
      if (event.method === 'serverRequest/resolved' && event.requestId === undefined) {
        const resolved = z.object({ threadId: id, requestId: rpcId }).parse(event.params);
        if (resolved.threadId !== this.state.threadId) return;
        for (const request of this.approvals.values()) {
          if (request.rpcId === resolved.requestId) request.approval.state = 'resolved';
        }
        return;
      }
      if (!active) {
        if (event.requestId !== undefined) void this.stop(true);
        return;
      }
      if (!active.turn) {
        if (active.early.length >= 32) throw new Error('Early notification capacity');
        active.early.push(event);
      } else this.event(active, event);
    } catch {
      void this.stop(true);
    }
  }

  private event(active: Active, event: CodexNotification): void {
    const turnId = active.turn!.turnId;
    if (event.method === 'turn/started' || event.method === 'turn/completed') {
      const value = turnEvent.parse(event.params);
      if (value.threadId !== this.state.threadId || value.turn.id !== turnId) return;
      if (event.method === 'turn/started') {
        if (value.turn.status !== 'inProgress' || active.turn!.state !== 'accepted')
          throw new Error('Contradictory turn evidence');
        active.turn!.state = 'running';
        this.report(active);
      } else if (value.turn.status !== 'inProgress') {
        this.finish(active, value.turn.status);
      } else throw new Error('Invalid turn outcome');
      return;
    }
    if (event.requestId !== undefined) {
      const value = scope.safeParse(event.params);
      if (
        !value.success ||
        value.data.threadId !== this.state.threadId ||
        value.data.turnId !== turnId
      )
        throw new Error('Uncorrelated server request');
      if (event.method === 'item/tool/call') this.dynamic(active, event.requestId, event.params);
      else this.requestApproval(active, event);
      return;
    }
    if (event.method === 'item/agentMessage/delta') {
      const value = scope.extend({ itemId: id, delta: z.string() }).parse(event.params);
      if (value.threadId !== this.state.threadId || value.turnId !== turnId) return;
      const previous = this.state.items.find(
        (item) => item.id === value.itemId && item.turnId === turnId,
      );
      if (previous?.status === 'completed') return;
      this.put({
        id: value.itemId,
        turnId,
        kind: 'agent_message',
        text: display((previous?.text ?? '') + value.delta),
        status: 'in_progress',
      });
      return;
    }
    if (event.method === 'item/started' || event.method === 'item/completed') {
      const value = itemScope.parse(event.params);
      if (value.threadId !== this.state.threadId || value.turnId !== turnId) return;
      this.item(active, value.item, event.method === 'item/completed');
    }
  }

  private item(active: Active, item: z.infer<typeof itemScope>['item'], complete: boolean): void {
    const base = { id: item.id, turnId: active.turn!.turnId };
    switch (item.type) {
      case 'agentMessage': {
        const { text, phase } = z
          .object({ text: z.string(), phase: z.string().nullish() })
          .parse(item);
        const shown = this.state.items.find(
          (entry) => entry.id === item.id && entry.turnId === base.turnId,
        );
        if (complete && (phase == null || phase === 'final_answer'))
          active.result = display(text).trim() || undefined;
        if (complete || !shown)
          this.put({
            ...base,
            kind: 'agent_message',
            text: display(text),
            status: complete ? 'completed' : 'in_progress',
          });
        break;
      }
      case 'commandExecution': {
        const value = z.object({ command: z.string(), status: commandStatus }).parse(item);
        this.put({
          ...base,
          kind: 'command',
          text: display(value.command),
          status: status(value.status),
        });
        break;
      }
      case 'fileChange': {
        const value = z.object({ changes, status: commandStatus }).parse(item);
        const review = JSON.stringify(value.changes, null, 2);
        if (value.changes.length && review.length <= 2000 && review === redact(review)) {
          if (active.fileReviews.size >= 16)
            active.fileReviews.delete(active.fileReviews.keys().next().value!);
          active.fileReviews.set(item.id, review);
        }
        this.put({
          ...base,
          kind: 'file_change',
          text: display(value.changes.map(({ path }) => path).join('\n')),
          status: status(value.status),
        });
        break;
      }
      case 'mcpToolCall':
      case 'dynamicToolCall':
      case 'collabAgentToolCall': {
        const value = z
          .object({ tool: z.string(), status: toolStatus, success: z.boolean().nullish() })
          .parse(item);
        if (complete && item.type === 'dynamicToolCall' && value.tool === delegationTool.name) {
          const result = active.calls.get(item.id);
          if (result) {
            result.receipt?.(value.status === 'completed' && value.success === true);
            active.calls.set(item.id, null);
          }
        }
        this.put({
          ...base,
          kind: 'tool_call',
          text: display(value.tool),
          status: status(value.status === 'interrupted' ? 'failed' : value.status),
        });
        break;
      }
    }
  }

  private dynamic(active: Active, requestId: string | number, params: unknown): void {
    const call = dynamicCallSchema.safeParse(params);
    if (!call.success || active.origin === 'delegation' || active.calls.size >= 1) {
      this.channel.replyDynamic(requestId, { success: false, text: 'No matching user grant.' });
      return;
    }
    active.calls.set(call.data.callId, null);
    void this.delegate(call.data)
      .then((result) => {
        if (this.active !== active || !this.channel.available) {
          result.receipt?.(false);
          return;
        }
        active.calls.set(call.data.callId, result);
        this.channel.replyDynamic(requestId, { success: result.success, text: result.text });
      })
      .catch(() => void this.stop(true));
  }

  private requestApproval(active: Active, event: CodexNotification): void {
    const requestId = event.requestId!;
    const turnId = active.turn!.turnId;
    const value = approvalScope.safeParse(event.params);
    let kind: StructuredApproval['kind'] = 'unsupported';
    let detail = display(event.method, 128);
    let decisions: StructuredDecision[] = ['decline'];
    if (value.success && event.method === 'item/commandExecution/requestApproval') {
      const command = z
        .object({
          kind: z.literal('command'),
          command: z.string().min(1).max(1200),
          cwd: z.string().min(1).max(500),
          additionalPermissions: z.null().optional(),
          networkApprovalContext: z.null().optional(),
          availableDecisions: z.array(z.unknown()).nullish(),
        })
        .safeParse(event.params);
      if (command.success) {
        const { command: text, cwd, availableDecisions } = command.data;
        const review = JSON.stringify({ command: text, cwd }, null, 2);
        if (review.length <= 2000 && review === redact(review)) {
          kind = 'command';
          detail = review;
          decisions = (['accept', 'decline', 'cancel'] as const).filter(
            (entry) => availableDecisions == null || availableDecisions.includes(entry),
          );
        }
      }
    } else if (value.success && event.method === 'item/fileChange/requestApproval') {
      const file = z.object({ grantRoot: z.null().optional() }).safeParse(event.params);
      const review = active.fileReviews.get(value.data.itemId);
      if (file.success && review) {
        kind = 'file_change';
        detail = review;
        decisions = ['accept', 'decline', 'cancel'];
      }
    }
    if (decisions.length === 0) {
      kind = 'unsupported';
      decisions = ['decline'];
    }
    const existing = this.state.approvals;
    if (existing.filter((entry) => entry.state === 'pending').length >= 4)
      throw new Error('Approval capacity');
    if (existing.length >= 8) {
      const index = existing.findIndex((entry) => entry.state !== 'pending');
      this.approvals.delete(existing[index]!.approvalId);
      existing.splice(index, 1);
    }
    const approval: StructuredApproval = {
      approvalId: randomUUID(),
      turnId,
      kind,
      detail,
      decisions,
      state: 'pending',
    };
    this.approvals.set(approval.approvalId, { approval, rpcId: requestId });
    existing.push(approval);
  }
}
