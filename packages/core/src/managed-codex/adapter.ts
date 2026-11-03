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
  }),
});
const threadResponseSchema = z.object({
  thread: z.object({ id: nativeId }),
  model: nativeId.optional(),
});
export type CodexResultWriter = (
  scope: Readonly<CommunicationContentScope>,
  bytes: Uint8Array,
) => CommunicationContent;
interface Active {
  message: Readonly<CommunicationMessage>;
  report(event: PaneProviderEvidence): void;
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

  constructor(
    private channel: CodexChannel,
    private pane: Readonly<CommunicationPane>,
    private writeResult: CodexResultWriter,
    private unavailable: () => void,
    private owns: () => boolean,
    private now: () => number = Date.now,
  ) {
    channel.onNotification((event) => this.event(event));
    channel.onLost(() => this.lose());
  }

  async initialize(cwd: string, requestedModel: string | null): Promise<void> {
    if (!this.owns()) throw new Error('Codex owner is not confirmed');
    await this.channel.request('initialize', {
      clientInfo: { name: 'orqst', title: 'ORQST', version: '0.1.0' },
    });
    if (!this.owns()) throw new Error('Codex owner was revoked during initialization');
    this.channel.initialized();
    const reply = threadResponseSchema.parse(
      await this.channel.request('thread/start', {
        cwd,
        sandbox: 'read-only',
        approvalPolicy: 'on-request',
        ...(requestedModel === null ? {} : { model: requestedModel }),
      }),
    );
    if (requestedModel !== null && reply.model !== requestedModel)
      throw new Error('Requested Codex model was not confirmed; no substitution');
    if (!this.channel.available || this.closed) throw new Error('Codex initialization lost');
    this.threadId = reply.thread.id;
    this.observedModel = reply.model ?? null;
  }
  snapshot() {
    return {
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
    const text = new TextDecoder('utf8', { fatal: true }).decode(content);
    const active: Active = {
      message,
      report,
      accepted: false,
      started: false,
      waiting: false,
      early: [],
      timer: setTimeout(
        () => this.lose(),
        Math.min(message.deadline - this.now(), communicationLimits.lifetimeMs),
      ),
    };
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
        return;
      }
      if (!active.started || active.waiting)
        throw new Error('Native completion lacks task start or approval resolution');
      if (params.turn.status === 'inProgress' || params.turn.status === 'interrupted')
        throw new Error('Task outcome unconfirmed');
      if (params.turn.status === 'failed') this.report(active, 'failed');
      else {
        if (!active.result) throw new Error('Native result unavailable');
        const bytes = Buffer.from(active.result);
        const result = this.writeResult(
          Object.freeze({
            workspaceId: active.message.workspaceId,
            actorId: active.message.actorId,
            sourcePaneId: active.message.sourcePaneId,
            targetPaneId: active.message.targetPaneId,
            purpose: 'result',
          }),
          bytes,
        );
        this.report(active, 'completed', result);
      }
      clearTimeout(active.timer);
      this.active = undefined;
    } else if (event.method === 'item/completed') {
      const params = itemSchema.parse(event.params);
      this.correlate(params.threadId, params.turnId, active);
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
    const binding = this.pane.binding!;
    active.report({
      messageId: active.message.messageId,
      taskId: active.message.taskId,
      correlationId: active.message.correlationId,
      targetPaneId: this.pane.paneId,
      attemptId: active.message.attemptId!,
      instanceId: binding.instanceId,
      terminalEpoch: binding.terminalEpoch,
      evidenceId: randomUUID(),
      event,
      ...(result === undefined ? {} : { result }),
    });
  }
  private lose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.active) clearTimeout(this.active.timer);
    this.active = undefined;
    this.unavailable();
  }
}
