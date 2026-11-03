import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  communicationLimits,
  type CommunicationContent,
  type CommunicationMessage,
  type CommunicationPane,
  type PaneProviderEvidence,
} from '@orqst/protocol';
import type { CommunicationAdapter, CommunicationContentScope } from '../communication/service.js';
import { CodexChannel, type CodexNotification } from './channel.js';
import {
  delegationTool,
  dynamicCallSchema,
  type NativeToolContext,
  type NativeToolHandler,
} from './dynamic-tools.js';

const nativeId = z.string().min(1).max(200);
const turnSchema = z.object({
  id: nativeId,
  status: z.enum(['inProgress', 'completed', 'failed', 'interrupted']),
});
const eventSchema = z.object({ threadId: nativeId, turn: turnSchema });
const itemSchema = z.object({
  threadId: nativeId,
  turnId: nativeId,
  item: z.object({
    type: z.string(),
    id: nativeId,
    text: z.string().optional(),
    phase: z.string().nullable().optional(),
    success: z.boolean().optional(),
    status: z.string().optional(),
    tool: z.string().optional(),
  }),
});
const threadResponseSchema = z.object({
  thread: z.object({ id: nativeId, ephemeral: z.boolean().optional() }),
  model: nativeId.optional(),
  sandbox: z.object({ type: z.string() }).optional(),
  approvalPolicy: z.string().optional(),
});
export type CodexResultWriter = (
  scope: Readonly<CommunicationContentScope>,
  bytes: Uint8Array,
) => CommunicationContent;
export type NativeTaskEvent = PaneProviderEvidence['event'] | 'outcome_unknown';
interface Active {
  scope: CommunicationContentScope;
  context: NativeToolContext;
  emit(event: NativeTaskEvent, result?: CommunicationContent): void;
  tool?: NativeToolHandler;
  toolPending: boolean;
  toolResponseSent: boolean;
  calls: Set<string>;
  turnId?: string;
  accepted: boolean;
  started: boolean;
  waiting: boolean;
  result?: string;
  early: CodexNotification[];
  timer: ReturnType<typeof setTimeout>;
}

/** One new native thread, one explicit task at a time; no parsing of terminal prose. */
export class CodexCommunicationAdapter implements CommunicationAdapter {
  private threadId?: string;
  private active?: Active;
  private closed = false;
  private observedModel: string | null = null;
  private toolsObserved = false;
  private toolReturned = false;
  private unexpectedToolUse = false;
  private authentication: 'unknown' | 'existing-native-login' = 'unknown';

  constructor(
    private channel: CodexChannel,
    private pane: Readonly<CommunicationPane>,
    private writeResult: CodexResultWriter,
    private unavailable: () => void,
    private owns: () => boolean,
    private dynamicTools = false,
    private readyAgain: () => void = () => {},
    private began: () => void = () => {},
    private now: () => number = Date.now,
  ) {
    channel.onNotification((event) => this.event(event));
    channel.onLost(() => this.lose());
  }

  async initialize(
    cwd: string,
    requestedModel: string | null,
    reuseExistingAuthentication = false,
  ): Promise<void> {
    if (!this.owns()) throw new Error('Codex owner is not confirmed');
    await this.channel.request('initialize', {
      clientInfo: { name: 'orqst', title: 'ORQST', version: '0.1.0' },
      ...(this.dynamicTools ? { capabilities: { experimentalApi: true } } : {}),
    });
    if (!this.owns()) throw new Error('Codex owner was revoked during initialization');
    this.channel.initialized();
    if (reuseExistingAuthentication) {
      // Strip account identity/plan fields immediately; never log or persist the response.
      const status = z
        .object({ account: z.object({ type: z.enum(['chatgpt', 'apiKey']) }).nullable() })
        .parse(await this.channel.request('account/read', { refreshToken: false }));
      if (!status.account) throw new Error('Existing native Codex login is unavailable');
      this.authentication = 'existing-native-login';
      if (!this.owns()) throw new Error('Codex owner revoked during authentication check');
    }
    const reply = threadResponseSchema.parse(
      await this.channel.request('thread/start', {
        cwd,
        sandbox: 'read-only',
        approvalPolicy: 'on-request',
        ...(reuseExistingAuthentication
          ? { ephemeral: true, allowProviderModelFallback: false }
          : {}),
        ...(this.dynamicTools ? { dynamicTools: [delegationTool] } : {}),
        ...(requestedModel === null ? {} : { model: requestedModel }),
      }),
    );
    if (reuseExistingAuthentication && reply.thread.ephemeral !== true)
      throw new Error('Native Codex did not confirm an ephemeral thread');
    if (
      reuseExistingAuthentication &&
      (reply.sandbox?.type !== 'readOnly' || reply.approvalPolicy !== 'on-request')
    )
      throw new Error('Native Codex did not confirm the requested permission policy');
    if (requestedModel !== null && reply.model !== requestedModel)
      throw new Error('Requested Codex model was not confirmed; no substitution');
    if (!this.channel.available || this.closed) throw new Error('Codex initialization lost');
    this.threadId = reply.thread.id;
    this.observedModel = reply.model ?? null;
  }
  snapshot() {
    return {
      authentication: this.authentication,
      unexpectedToolUse: this.unexpectedToolUse,
      delegationReturned: this.toolReturned,
      dynamicTools: this.dynamicTools
        ? this.toolsObserved
          ? 'observed'
          : 'requested'
        : 'disabled',
      nativeThreadId: this.threadId ?? null,
      reportedModel: this.observedModel,
      activeTurnId: this.active?.turnId ?? null,
      available: this.channel.available && !this.closed && this.owns(),
    };
  }
  ready(pane: Readonly<CommunicationPane>): boolean {
    return (
      !this.closed &&
      this.owns() &&
      this.channel.available &&
      !!this.threadId &&
      !this.active &&
      pane.paneId === this.pane.paneId &&
      pane.workspaceId === this.pane.workspaceId &&
      JSON.stringify(pane.binding) === JSON.stringify(this.pane.binding)
    );
  }

  /** Resolves after native turn admission, not after completion. Results arrive as evidence. */
  async submit(
    message: Readonly<CommunicationMessage>,
    content: Uint8Array,
    report: (event: PaneProviderEvidence) => void,
  ): Promise<void> {
    if (
      !this.ready(this.pane) ||
      message.targetPaneId !== this.pane.paneId ||
      message.workspaceId !== this.pane.workspaceId ||
      !message.attemptId ||
      content.length < 1 ||
      content.length > communicationLimits.payloadBytes ||
      message.deadline <= this.now()
    )
      throw new Error('Codex task admission denied');
    const scope: CommunicationContentScope = {
      workspaceId: message.workspaceId,
      actorId: message.actorId,
      sourcePaneId: message.sourcePaneId,
      targetPaneId: message.targetPaneId,
      purpose: 'result',
    };
    await this.startTurn(
      new TextDecoder('utf8', { fatal: true }).decode(content),
      scope,
      { taskId: message.taskId, correlationId: message.correlationId, deadline: message.deadline },
      (event, result) => {
        if (event === 'outcome_unknown') return; // Pane unavailable records uncertainty through Core.
        report({
          messageId: message.messageId,
          taskId: message.taskId,
          correlationId: message.correlationId,
          targetPaneId: this.pane.paneId,
          attemptId: message.attemptId!,
          instanceId: this.pane.binding!.instanceId,
          terminalEpoch: this.pane.binding!.terminalEpoch,
          evidenceId: randomUUID(),
          event,
          ...(result === undefined ? {} : { result }),
        });
      },
    );
  }
  async startRoot(
    text: string,
    context: NativeToolContext,
    emit: Active['emit'],
    tool: NativeToolHandler,
  ): Promise<void> {
    if (!this.dynamicTools)
      throw new Error('Dynamic tools were not requested for this native thread');
    return this.startTurn(
      text,
      {
        workspaceId: this.pane.workspaceId,
        actorId: this.pane.ownerId,
        sourcePaneId: this.pane.paneId,
        targetPaneId: this.pane.paneId,
        purpose: 'result',
      },
      context,
      emit,
      tool,
    );
  }
  private async startTurn(
    text: string,
    scope: CommunicationContentScope,
    context: NativeToolContext,
    emit: Active['emit'],
    tool?: NativeToolHandler,
  ): Promise<void> {
    if (
      !this.ready(this.pane) ||
      Buffer.byteLength(text) > communicationLimits.payloadBytes ||
      context.deadline <= this.now()
    )
      throw new Error('Native turn unavailable');
    const active: Active = {
      scope,
      context,
      emit,
      tool,
      toolPending: false,
      toolResponseSent: false,
      calls: new Set(),
      accepted: false,
      started: false,
      waiting: false,
      early: [],
      timer: setTimeout(
        () => this.lose(),
        Math.min(context.deadline - this.now(), communicationLimits.lifetimeMs),
      ),
    };
    this.toolReturned = false;
    this.unexpectedToolUse = false;
    this.active = active;
    try {
      const reply = z.object({ turn: turnSchema }).parse(
        await this.channel.request('turn/start', {
          threadId: this.threadId,
          input: [{ type: 'text', text }],
        }),
      );
      if (this.active !== active || !this.channel.available)
        throw new Error('Codex turn admission uncertain');
      // A terminal reply is not a completion event, even if its response has a final status.
      if (reply.turn.status !== 'inProgress')
        throw new Error('Codex turn start response is not running');
      active.turnId = reply.turn.id;
      active.accepted = true;
      this.report(active, 'accepted');
      for (const event of active.early) this.process(active, event);
      active.early = [];
    } catch {
      this.lose();
      throw new Error('Codex structured dispatch uncertain; no retry');
    }
  }

  /** Core/channel loss never reports a process exit or successful cancellation. */
  close(): void {
    this.lose();
  }
  private event(event: CodexNotification): void {
    const active = this.active;
    if (!active || this.closed) return;
    try {
      if (!active.accepted) {
        // Native notifications can precede the matching turn/start response.
        if (active.early.length >= 32) throw new Error('Unbounded early notifications');
        active.early.push(event);
      } else this.process(active, event);
    } catch {
      this.lose();
    }
  }
  private process(active: Active, event: CodexNotification): void {
    if (this.active !== active || this.closed) return;
    if (event.method === 'item/started' || event.method === 'item/completed') {
      const params = itemSchema.parse(event.params);
      this.correlate(params.threadId, params.turnId, active);
      if (
        !['agentMessage', 'reasoning', 'userMessage', 'dynamicToolCall'].includes(params.item.type)
      )
        this.unexpectedToolUse = true;
    }
    if (event.requestId !== undefined && event.method === 'item/tool/call') {
      const call = dynamicCallSchema.parse(event.params);
      this.correlate(call.threadId, call.turnId, active);
      if (
        !this.dynamicTools ||
        !active.started ||
        active.toolPending ||
        active.calls.has(call.callId) ||
        active.calls.size >= 1
      )
        throw new Error('Native dynamic tool budget/correlation denied');
      this.toolsObserved = true;
      active.calls.add(call.callId);
      active.toolPending = true;
      const requestId = event.requestId;
      const reply = active.tool
        ? active.tool(call, active.context)
        : Promise.resolve({ success: false, text: 'No user delegation grant.' });
      void reply
        .then((result) => {
          if (
            this.closed ||
            this.active !== active ||
            !this.owns() ||
            this.now() >= active.context.deadline
          )
            return;
          active.toolPending = false;
          active.toolResponseSent = true;
          this.channel.replyDynamic(requestId, result);
        })
        .catch(() => this.lose());
      return;
    }
    if (event.requestId !== undefined) {
      const params = z.object({ threadId: nativeId, turnId: nativeId }).parse(event.params);
      this.correlate(params.threadId, params.turnId, active);
      // No provider permission decision, command, input answer or generic RPC response is available.
      if (!active.started) throw new Error('Approval without turn start evidence');
      if (!active.waiting) {
        this.report(active, 'waiting_approval');
        active.waiting = true;
      }
      return;
    }
    if (event.method === 'turn/started' || event.method === 'turn/completed') {
      const params = eventSchema.parse(event.params);
      this.correlate(params.threadId, params.turn.id, active);
      if (event.method === 'turn/started') {
        if (params.turn.status !== 'inProgress' || active.started)
          throw new Error('Invalid native start');
        this.report(active, 'started');
        active.started = true;
        this.began();
        return;
      }
      if (!active.started || active.waiting || active.toolPending)
        throw new Error('Native completion lacks task start or approval resolution');
      if (params.turn.status === 'inProgress' || params.turn.status === 'interrupted')
        throw new Error('Task outcome unconfirmed');
      if (params.turn.status === 'failed') this.report(active, 'failed');
      else {
        if (!active.result) throw new Error('Native result unavailable');
        const bytes = Buffer.from(active.result);
        const result = this.writeResult(Object.freeze(active.scope), bytes);
        this.report(active, 'completed', result);
      }
      clearTimeout(active.timer);
      this.active = undefined;
      this.readyAgain();
    } else if (event.method === 'item/completed') {
      const params = itemSchema.parse(event.params);
      this.correlate(params.threadId, params.turnId, active);
      if (params.item.type === 'dynamicToolCall') {
        if (
          !active.toolResponseSent ||
          !active.calls.has(params.item.id) ||
          params.item.tool !== 'orqst_delegate_task' ||
          !['completed', 'failed'].includes(params.item.status ?? '') ||
          params.item.success === undefined
        )
          throw new Error('Native dynamic result receipt unavailable');
        this.toolReturned = params.item.status === 'completed' && params.item.success === true;
      }
      if (
        params.item.type === 'agentMessage' &&
        (params.item.phase == null || params.item.phase === 'final_answer')
      ) {
        const text = params.item.text;
        if (!text || Buffer.byteLength(text) > communicationLimits.payloadBytes)
          throw new Error('Native result exceeds local limits');
        active.result = text;
      }
    }
  }
  private correlate(threadId: string, turnId: string, active: Active): void {
    if (threadId !== this.threadId || turnId !== active.turnId)
      throw new Error('Codex thread/turn correlation denied');
  }
  private report(
    active: Active,
    event: PaneProviderEvidence['event'],
    result?: CommunicationContent,
  ): void {
    if (!this.owns()) throw new Error('Codex runtime ownership unavailable');
    active.emit(event, result);
  }

  private lose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.active) {
      clearTimeout(this.active.timer);
      try {
        this.active.emit('outcome_unknown');
      } catch {
        /* A failed owner cannot restore facts. */
      }
    }
    this.active = undefined;
    this.unavailable();
  }
}
