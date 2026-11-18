import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { redact } from '@orqst/shared';
import {
  structuredAgentsLimits as limits,
  type StructuredApproval,
  type StructuredDecision,
  type StructuredItem,
  type StructuredSession,
  type StructuredTurn,
} from '@orqst/protocol';
import { z } from 'zod';
import { delegationArgumentsSchema, delegationTool } from '../managed-codex/dynamic-tools.js';
import { BoundedLineSplitter } from '../managed-codex/line-splitter.js';
import { reviewedStructuredClaudeBinary, type OwnedClaudeProcess } from './claude-process.js';
import {
  display,
  StructuredProjection,
  StructuredStartupFailure,
  type DelegationResult,
  type SessionScope,
  type StructuredDelegate,
  type StructuredTurnOptions,
  type TurnReport,
} from './session.js';
import { ClaudeUsageTracker } from './usage.js';

const id = z.string().min(1).max(200);
const lineBytes = 1024 * 1024;
const wireBytes = 24 * 1024 * 1024;
const initMs = 30_000;
const requestMs = 8_000;
const turnMs = 5 * 60_000;

const controlResponseSchema = z.object({
  type: z.literal('control_response'),
  response: z.discriminatedUnion('subtype', [
    z.object({
      subtype: z.literal('success'),
      request_id: id,
      response: z.record(z.string(), z.unknown()).optional(),
      pending_permission_requests: z.array(z.unknown()).optional(),
    }),
    z.object({
      subtype: z.literal('error'),
      request_id: id,
      error: z.string(),
    }),
  ]),
});

const controlCancelSchema = z.object({
  type: z.literal('control_cancel_request'),
  request_id: id,
});

const controlRequestSchema = z.object({
  type: z.literal('control_request'),
  request_id: id,
  request: z.object({ subtype: z.string().min(1).max(64) }).passthrough(),
});

const canUseToolSchema = z.object({
  subtype: z.literal('can_use_tool'),
  tool_name: z.string().min(1).max(128),
  input: z.record(z.string(), z.unknown()),
  tool_use_id: id.optional(),
  blocked_path: z.string().max(1024).optional(),
  decision_reason: z.string().max(1024).optional(),
  requires_user_interaction: z.boolean().optional(),
});

const mcpMessageSchema = z.object({
  subtype: z.literal('mcp_message'),
  server_name: z.string().min(1).max(64),
  message: z.object({
    jsonrpc: z.literal('2.0').optional(),
    id: z.union([z.string().max(128), z.number().int().safe(), z.null()]).optional(),
    method: z.string().min(1).max(128),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
});

const systemInitSchema = z.object({
  type: z.literal('system'),
  subtype: z.literal('init'),
  session_id: id,
  cwd: z.string().optional(),
  model: z.string().min(1).max(128).optional(),
  permissionMode: z.string().optional(),
  claude_code_version: z.string().optional(),
});

const streamDeltaSchema = z.object({
  type: z.literal('stream_event'),
  session_id: id,
  parent_tool_use_id: z.string().nullish(),
  event: z.object({
    type: z.string().max(64),
    index: z.int().nonnegative().optional(),
    delta: z
      .object({
        type: z.string().max(64),
        text: z.string().optional(),
      })
      .optional(),
  }),
});

const assistantSchema = z.object({
  type: z.literal('assistant'),
  session_id: id,
  parent_tool_use_id: z.string().nullish(),
  isSidechain: z.boolean().optional(),
  isApiErrorMessage: z.boolean().optional(),
  message: z.object({
    id: id.optional(),
    model: z.string().min(1).max(128).optional(),
    content: z.array(z.object({ type: z.string().max(64) }).passthrough()).max(128),
  }),
});

const userToolResultSchema = z.object({
  type: z.literal('user'),
  session_id: id,
  parent_tool_use_id: z.string().nullish(),
  isMeta: z.boolean().optional(),
  message: z.object({
    content: z.array(z.unknown()).max(128),
  }),
});

const resultSchema = z.object({
  type: z.literal('result'),
  subtype: z.string().min(1).max(64),
  session_id: id,
  is_error: z.boolean().optional(),
  terminal_reason: z.string().max(64).optional(),
  result: z.string().optional(),
  user_message_uuids: z.array(z.string()).max(32).optional(),
});

interface PendingControl {
  resolve(value: Record<string, unknown>): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface ApprovalRecord {
  approval: StructuredApproval;
  requestId: string;
  toolUseId?: string;
  input: Record<string, unknown>;
}

interface ActiveTurn {
  turn: StructuredTurn;
  timer: ReturnType<typeof setTimeout>;
  report?: TurnReport;
  finishWait?: () => void;
  result?: string;
  streamText: string;
  streamItemId?: string;
  interruptRequested: boolean;
  delegationAttempted: boolean;
  delegationToolUseId?: string;
  pendingReceipt?: DelegationResult;
  toolItems: Map<string, { id: string; kind: StructuredItem['kind']; text: string }>;
  declinedTools: Set<string>;
}

const ansiEscape = new RegExp(String.fromCharCode(0x1b) + '\\[[0-?]*[ -/]*[@-~]', 'g');

function sanitizePlainText(value: string): string {
  return value
    .replace(ansiEscape, '')
    .replace(/[\p{Cf}\u2028\u2029]/gu, '')
    .replace(/[^\P{Cc}\n\t]/gu, '');
}

function isDelegationToolName(name: string): boolean {
  return name === delegationTool.name || name === `mcp__orqst__${delegationTool.name}`;
}

export class StructuredClaudeSession extends StructuredProjection {
  private readonly lines = new BoundedLineSplitter(lineBytes);
  private readonly usageTracker = new ClaudeUsageTracker();
  private readonly pendingControls = new Map<string, PendingControl>();
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly seenControlRequests = new Set<string>();
  private readonly unsubscribe: () => void;
  private active?: ActiveTurn;
  private available = true;
  private bytes = 0;
  private expectedCwd?: string;
  private stopPromise?: Promise<void>;

  constructor(
    scope: SessionScope,
    private readonly owned: OwnedClaudeProcess,
    private readonly delegate: StructuredDelegate,
  ) {
    super(scope, 'claude');
    this.unsubscribe = owned.transport.listen(
      (chunk) => this.receiveChunk(chunk),
      () => this.lost(),
    );
  }

  get ready() {
    return this.state.lifecycle === 'ready' && this.available && !this.active;
  }

  snapshot(): StructuredSession {
    return structuredClone({ ...this.state, busy: !!this.active });
  }

  async initialize(cwd: string): Promise<void> {
    this.expectedCwd = cwd;
    let failure: StructuredStartupFailure['reason'] = 'provider_connection_failed';
    try {
      const response = await this.controlRequest(
        {
          subtype: 'initialize',
          sdkMcpServers: ['orqst'],
          sdkMcpServerConfigs: {
            orqst: { disableAutoBackground: true, timeout: 360_000 },
          },
        },
        initMs,
        'provider_startup_timeout',
      );
      failure = 'provider_session_rejected';
      const version = response.claude_code_version;
      if (version !== undefined && version !== reviewedStructuredClaudeBinary.version)
        throw new Error('Unreviewed Claude version');
      if (!this.available || this.stopPromise) throw new Error('Claude session closed');
      this.state.threadId = this.owned.sessionId;
      this.state.lifecycle = 'ready';
    } catch (error) {
      await this.stop(true);
      throw error instanceof StructuredStartupFailure
        ? error
        : new StructuredStartupFailure(failure);
    }
  }

  async startTurn(
    text: string,
    origin: StructuredTurn['origin'],
    report?: TurnReport,
    { delegation, peerContext }: StructuredTurnOptions = {},
  ): Promise<void> {
    if (!this.ready || !text.trim() || Buffer.byteLength(text) > limits.turnText * 4)
      throw new Error('Claude turn unavailable');
    const turnId = randomUUID();
    const active: ActiveTurn = {
      turn: { turnId, state: 'accepted', origin },
      timer: setTimeout(() => void this.stop(true), turnMs),
      report,
      streamText: '',
      interruptRequested: false,
      delegationAttempted: false,
      toolItems: new Map(),
      declinedTools: new Set(),
    };
    this.active = active;
    this.state.turn = active.turn;
    const content = [
      { type: 'text', text },
      ...(peerContext ? [{ type: 'text', text: peerContext }] : []),
      ...(delegation && origin === 'human'
        ? [
            {
              type: 'text',
              text:
                'ORQST one-use grant. To use it, call mcp__orqst__orqst_delegate_task with exactly these arguments: ' +
                JSON.stringify(delegation),
            },
          ]
        : []),
    ];
    try {
      this.sendJson({
        type: 'user',
        uuid: turnId,
        session_id: this.owned.sessionId,
        parent_tool_use_id: null,
        message: { role: 'user', content },
      });
      this.put({
        id: turnId,
        turnId,
        kind: 'user_message',
        text: display(text),
      });
      this.report(active);
    } catch {
      await this.stop(true);
      throw new Error('Claude dispatch outcome unknown');
    }
  }

  async interrupt(): Promise<void> {
    if (!this.available || !this.active || this.stopPromise)
      throw new Error('Active Claude turn unavailable');
    this.active.interruptRequested = true;
    await this.controlRequest({ subtype: 'interrupt', reason: 'user-cancel' }, requestMs);
  }

  approval(approvalId: string, decision: StructuredDecision): StructuredApproval | undefined {
    const entry = this.approvals.get(approvalId);
    if (
      this.available &&
      entry?.approval.state === 'pending' &&
      this.active?.turn.turnId === entry.approval.turnId &&
      entry.approval.decisions.includes(decision)
    )
      return entry.approval;
  }

  answer(approvalId: string, decision: StructuredDecision): void {
    const entry = this.approvals.get(approvalId);
    const active = this.active;
    if (!entry || !active || !this.approval(approvalId, decision))
      throw new Error('Stale Claude approval');
    const toolUse = entry.toolUseId ? { toolUseID: entry.toolUseId } : {};
    if (decision === 'accept') {
      this.sendControlResponse(entry.requestId, {
        subtype: 'success',
        response: {
          behavior: 'allow',
          updatedInput: entry.input,
          ...toolUse,
        },
      });
    } else {
      if (entry.toolUseId) active.declinedTools.add(entry.toolUseId);
      if (decision === 'cancel') active.interruptRequested = true;
      this.sendControlResponse(entry.requestId, {
        subtype: 'success',
        response: {
          behavior: 'deny',
          message:
            decision === 'cancel' ? 'Cancelled in ORQST Studio.' : 'Declined in ORQST Studio.',
          ...(decision === 'cancel' ? { interrupt: true } : {}),
          ...toolUse,
        },
      });
    }
    entry.approval.state = 'answered';
  }

  stop(failed = false): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.state.lifecycle = 'stopping';
    this.stopPromise = Promise.resolve().then(async () => {
      const active = this.active;
      if (!failed && active && this.available) {
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
          // Fall back to closing stdin and terminating the owned process group.
        } finally {
          timer.abort();
        }
      }
      this.closeTransport();
      if (this.active) this.finish(this.active, 'unknown');
      try {
        const exit = await this.owned.transport.terminate();
        if (exit.code === null && exit.signal === null) {
          this.state.lifecycle = 'failed';
          return;
        }
        this.state.exit = exit;
        this.state.lifecycle = failed ? 'failed' : 'exited';
      } catch {
        this.state.lifecycle = 'failed';
      }
    });
    return this.stopPromise;
  }

  private controlRequest(
    request: Record<string, unknown>,
    timeoutMs: number,
    timeoutReason?: StructuredStartupFailure['reason'],
  ): Promise<Record<string, unknown>> {
    if (!this.available || this.pendingControls.size >= 4)
      return Promise.reject(new Error('Claude control channel unavailable'));
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.pendingControls.delete(requestId);
        reject(
          timeoutReason
            ? new StructuredStartupFailure(timeoutReason)
            : new Error('Claude control request timed out'),
        );
        void this.stop(true);
      }, timeoutMs);
      this.pendingControls.set(requestId, { resolve, reject, timer });
      try {
        this.sendJson({ type: 'control_request', request_id: requestId, request });
      } catch (error) {
        clearTimeout(timer);
        this.pendingControls.delete(requestId);
        reject(error instanceof Error ? error : new Error('Claude send failed'));
      }
    });
  }

  private sendControlResponse(
    requestId: string,
    payload:
      | { subtype: 'success'; response: Record<string, unknown> }
      | { subtype: 'error'; error: string },
  ): void {
    this.sendJson({
      type: 'control_response',
      response:
        payload.subtype === 'success'
          ? { subtype: 'success', request_id: requestId, response: payload.response }
          : { subtype: 'error', request_id: requestId, error: payload.error },
    });
  }

  private sendJson(payload: object): void {
    if (!this.available) throw new Error('Claude wire closed');
    this.owned.transport.send(JSON.stringify(payload) + '\n');
  }

  private lost(): void {
    this.closeTransport();
    if (!this.stopPromise) void this.stop(true);
  }

  private closeTransport(): void {
    if (!this.available) return;
    this.available = false;
    this.unsubscribe();
    this.lines.clear();
    this.owned.transport.detach();
    for (const pending of this.pendingControls.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Claude transport closed'));
    }
    this.pendingControls.clear();
  }

  private receiveChunk(chunk: Uint8Array): void {
    if (!this.available) return;
    this.bytes += chunk.byteLength;
    if (chunk.byteLength > lineBytes || this.bytes > wireBytes) {
      void this.stop(true);
      return;
    }
    try {
      for (const line of this.lines.push(Buffer.from(chunk))) {
        if (!this.available) return;
        const decoded = new TextDecoder('utf8', { fatal: true }).decode(line).trim();
        if (!decoded) continue;
        this.handleFrame(JSON.parse(decoded));
      }
    } catch {
      void this.stop(true);
    }
  }

  private handleFrame(raw: unknown): void {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Invalid Claude stream-json frame');
    const frameType = Reflect.get(raw, 'type');
    if (frameType === 'control_response') {
      const parsed = controlResponseSchema.parse(raw);
      const pending = this.pendingControls.get(parsed.response.request_id);
      if (!pending) throw new Error('Uncorrelated Claude control_response');
      this.pendingControls.delete(parsed.response.request_id);
      clearTimeout(pending.timer);
      if (parsed.response.subtype === 'error') {
        pending.reject(new Error('Claude rejected control_request'));
        return;
      }
      if ((parsed.response.pending_permission_requests?.length ?? 0) > 0 && !this.active) {
        pending.reject(new Error('Unexpected inherited Claude permission request'));
        return;
      }
      pending.resolve(parsed.response.response ?? {});
      return;
    }
    if (frameType === 'control_cancel_request') {
      const { request_id } = controlCancelSchema.parse(raw);
      for (const entry of this.approvals.values()) {
        if (
          entry.requestId === request_id &&
          (entry.approval.state === 'pending' || entry.approval.state === 'answered')
        )
          entry.approval.state = 'unavailable';
      }
      return;
    }
    if (frameType === 'control_request') {
      this.handleControlRequest(controlRequestSchema.parse(raw));
      return;
    }
    if (frameType === 'system' && Reflect.get(raw, 'subtype') === 'init') {
      this.handleSystemInit(systemInitSchema.parse(raw));
      return;
    }
    if (frameType === 'stream_event') {
      this.handleStreamEvent(raw);
      return;
    }
    if (frameType === 'assistant') {
      this.handleAssistant(raw);
      return;
    }
    if (frameType === 'user') {
      this.handleUser(raw);
      return;
    }
    if (frameType === 'result') {
      this.handleResult(raw);
    }
  }

  private handleControlRequest(envelope: z.infer<typeof controlRequestSchema>): void {
    if (this.seenControlRequests.has(envelope.request_id) || this.seenControlRequests.size >= 512)
      throw new Error('Duplicate or excessive Claude control_request');
    this.seenControlRequests.add(envelope.request_id);
    const { subtype } = envelope.request;
    if (subtype === 'mcp_message') {
      this.handleMcpMessage(envelope.request_id, mcpMessageSchema.parse(envelope.request));
      return;
    }
    if (subtype === 'can_use_tool') {
      const active = this.active;
      if (!active) throw new Error('Uncorrelated Claude approval outside active turn');
      this.markRunning(active);
      this.requestApproval(active, envelope.request_id, canUseToolSchema.parse(envelope.request));
      return;
    }
    this.sendControlResponse(envelope.request_id, {
      subtype: 'error',
      error: 'Unsupported control_request in ORQST Studio',
    });
  }

  private handleMcpMessage(requestId: string, payload: z.infer<typeof mcpMessageSchema>): void {
    if (payload.server_name !== 'orqst') {
      this.sendControlResponse(requestId, {
        subtype: 'error',
        error: 'Unknown SDK MCP server',
      });
      return;
    }
    const { id: rpcId = null, method, params } = payload.message;
    const replyMcp = (result: Record<string, unknown>) =>
      this.sendControlResponse(requestId, {
        subtype: 'success',
        response: { mcp_response: { jsonrpc: '2.0', id: rpcId, result } },
      });
    const replyMcpError = (code: number, message: string) =>
      this.sendControlResponse(requestId, {
        subtype: 'success',
        response: { mcp_response: { jsonrpc: '2.0', id: rpcId, error: { code, message } } },
      });

    if (method === 'initialize') {
      const requested =
        typeof params?.protocolVersion === 'string' && params.protocolVersion.length <= 32
          ? params.protocolVersion
          : '2025-11-25';
      replyMcp({
        protocolVersion: requested,
        capabilities: { tools: {} },
        serverInfo: { name: 'orqst', version: '0.1.0' },
      });
      return;
    }
    if (method === 'notifications/initialized' || method === 'ping') {
      replyMcp({});
      return;
    }
    if (method === 'tools/list') {
      replyMcp({
        tools: [
          {
            name: delegationTool.name,
            description: delegationTool.description,
            inputSchema: delegationTool.inputSchema,
          },
        ],
      });
      return;
    }
    if (method === 'tools/call') {
      const active = this.active;
      const toolName = typeof params?.name === 'string' ? params.name : '';
      const parsedArgs = delegationArgumentsSchema.safeParse(params?.arguments);
      if (
        !active ||
        active.turn.origin === 'delegation' ||
        active.delegationAttempted ||
        !isDelegationToolName(toolName) ||
        !parsedArgs.success
      ) {
        replyMcp({
          content: [{ type: 'text', text: 'No matching user grant.' }],
          isError: true,
        });
        return;
      }
      active.delegationAttempted = true;
      this.markRunning(active);
      void this.delegate({ arguments: parsedArgs.data, turnId: active.turn.turnId })
        .then((result) => {
          if (this.active !== active || !this.available) {
            result.receipt?.(false);
            return;
          }
          if (result.success) active.pendingReceipt = result;
          replyMcp({
            content: [{ type: 'text', text: result.text }],
            isError: !result.success,
          });
        })
        .catch(() => void this.stop(true));
      return;
    }
    replyMcpError(-32601, 'MCP method unavailable');
  }

  private requestApproval(
    active: ActiveTurn,
    requestId: string,
    request: z.infer<typeof canUseToolSchema>,
  ): void {
    const existing = this.state.approvals;
    if (existing.filter((entry) => entry.state === 'pending').length >= 4)
      throw new Error('Claude approval capacity');
    if (existing.length >= 8) {
      const index = existing.findIndex((entry) => entry.state !== 'pending');
      if (index < 0) throw new Error('Claude approval buffer full');
      this.approvals.delete(existing[index]!.approvalId);
      existing.splice(index, 1);
    }

    let kind: StructuredApproval['kind'] = 'unsupported';
    let detail = display(sanitizePlainText(request.tool_name), 128);
    let decisions: StructuredDecision[] = ['decline'];
    const reason = request.decision_reason
      ? sanitizePlainText(request.decision_reason).slice(0, 300)
      : undefined;

    if (!request.requires_user_interaction && request.tool_name !== 'AskUserQuestion') {
      if (request.tool_name === 'Bash') {
        const command = z
          .object({
            command: z.string().min(1).max(1200),
            description: z.string().max(400).optional(),
          })
          .safeParse(request.input);
        if (command.success) {
          const review = JSON.stringify(
            {
              tool: 'Bash',
              command: sanitizePlainText(command.data.command),
              cwd: this.expectedCwd,
              ...(command.data.description
                ? { description: sanitizePlainText(command.data.description) }
                : {}),
              ...(reason ? { reason } : {}),
            },
            null,
            2,
          );
          if (review.length <= 2000 && review === redact(review)) {
            kind = 'command';
            detail = review;
            decisions = ['accept', 'decline', 'cancel'];
          }
        }
      } else if (['Edit', 'Write', 'NotebookEdit'].includes(request.tool_name)) {
        const pathValue =
          typeof request.input.file_path === 'string'
            ? request.input.file_path
            : typeof request.input.notebook_path === 'string'
              ? request.input.notebook_path
              : '';
        if (pathValue.trim().length > 0 && pathValue.length <= 500) {
          const review = JSON.stringify(
            {
              tool: request.tool_name,
              path: sanitizePlainText(pathValue),
              input: request.input,
              ...(reason ? { reason } : {}),
            },
            null,
            2,
          );
          if (review.length <= 2000 && review === redact(review)) {
            kind = 'file_change';
            detail = review;
            decisions = ['accept', 'decline', 'cancel'];
          }
        }
      } else if (['Read', 'Glob', 'Grep'].includes(request.tool_name)) {
        const target =
          request.input.file_path ?? request.input.pattern ?? request.input.path ?? undefined;
        if (typeof target === 'string' && target.trim().length > 0 && target !== '*') {
          const review = JSON.stringify(
            {
              tool: request.tool_name,
              input: request.input,
              ...(request.blocked_path
                ? { blockedPath: sanitizePlainText(request.blocked_path) }
                : {}),
              ...(reason ? { reason } : {}),
            },
            null,
            2,
          );
          if (review.length <= 2000 && review === redact(review)) {
            kind = 'permission';
            detail = review;
            decisions = ['accept', 'decline'];
          }
        }
      }
    }

    const approval: StructuredApproval = {
      approvalId: randomUUID(),
      turnId: active.turn.turnId,
      kind,
      detail,
      decisions,
      state: 'pending',
    };
    this.approvals.set(approval.approvalId, {
      approval,
      requestId,
      toolUseId: request.tool_use_id,
      input: structuredClone(request.input),
    });
    existing.push(approval);
  }

  private handleSystemInit(init: z.infer<typeof systemInitSchema>): void {
    if (init.session_id !== this.owned.sessionId) return;
    if (
      (init.claude_code_version &&
        init.claude_code_version !== reviewedStructuredClaudeBinary.version) ||
      (init.cwd && this.expectedCwd && init.cwd !== this.expectedCwd) ||
      (init.permissionMode && !['default', 'plan'].includes(init.permissionMode))
    )
      throw new Error('Claude session policy mismatch');
    if (init.model && init.model !== '<synthetic>')
      this.state.reportedModel = display(sanitizePlainText(init.model), 128);
    if (this.active) this.markRunning(this.active);
  }

  private handleStreamEvent(raw: unknown): void {
    const metric = this.usageTracker.observeStreamEvent(
      raw,
      this.owned.sessionId,
      this.active?.turn.turnId,
    );
    if (metric) this.state.usage = metric;
    const parsed = streamDeltaSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.session_id !== this.owned.sessionId ||
      parsed.data.parent_tool_use_id != null ||
      !this.active
    )
      return;
    const active = this.active;
    this.markRunning(active);
    if (
      parsed.data.event.type === 'content_block_delta' &&
      parsed.data.event.delta?.type === 'text_delta' &&
      typeof parsed.data.event.delta.text === 'string'
    ) {
      active.streamItemId ??= 'stream:' + active.turn.turnId;
      active.streamText = (active.streamText + parsed.data.event.delta.text).slice(
        0,
        limits.itemText * 2,
      );
      if (!active.streamText.startsWith('[Request interrupted')) {
        this.put({
          id: active.streamItemId,
          turnId: active.turn.turnId,
          kind: 'agent_message',
          text: display(sanitizePlainText(active.streamText)),
          status: 'in_progress',
        });
      }
    }
  }

  private handleAssistant(raw: unknown): void {
    const metric = this.usageTracker.observeAssistant(
      raw,
      this.owned.sessionId,
      this.active?.turn.turnId,
    );
    if (metric) this.state.usage = metric;
    const parsed = assistantSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.session_id !== this.owned.sessionId ||
      parsed.data.parent_tool_use_id != null ||
      parsed.data.isSidechain ||
      !this.active
    )
      return;
    const active = this.active;
    this.markRunning(active);
    if (parsed.data.message.model && parsed.data.message.model !== '<synthetic>')
      this.state.reportedModel = display(sanitizePlainText(parsed.data.message.model), 128);

    const turnId = active.turn.turnId;
    const msgId = parsed.data.message.id ?? randomUUID();
    for (const [ordinal, block] of parsed.data.message.content.entries()) {
      if (block.type === 'text') {
        const text = typeof block.text === 'string' ? sanitizePlainText(block.text) : '';
        if (!text || text.startsWith('[Request interrupted')) continue;
        const itemId = active.streamItemId ?? `${msgId}:${ordinal}`;
        active.streamItemId = undefined;
        active.streamText = '';
        this.put({
          id: itemId,
          turnId,
          kind: 'agent_message',
          text: display(text),
          status: 'completed',
        });
        active.result = display(text).trim() || active.result;
      } else if (block.type === 'tool_use') {
        if (active.streamItemId) {
          if (active.streamText && !active.streamText.startsWith('[Request interrupted')) {
            this.put({
              id: active.streamItemId,
              turnId,
              kind: 'agent_message',
              text: display(sanitizePlainText(active.streamText)),
              status: 'completed',
            });
          }
          active.streamItemId = undefined;
          active.streamText = '';
        }
        const toolId = typeof block.id === 'string' && block.id ? block.id : `${msgId}:${ordinal}`;
        const name =
          typeof block.name === 'string' && block.name ? sanitizePlainText(block.name) : 'tool';
        const input =
          block.input && typeof block.input === 'object' && !Array.isArray(block.input)
            ? (block.input as Record<string, unknown>)
            : {};
        let kind: StructuredItem['kind'] = 'tool_call';
        let label = display(name);
        if (name === 'Bash') {
          kind = 'command';
          label = display(
            typeof input.command === 'string' ? sanitizePlainText(input.command) : 'Bash',
          );
        } else if (['Edit', 'Write', 'NotebookEdit'].includes(name)) {
          kind = 'file_change';
          const pathValue =
            typeof input.file_path === 'string'
              ? input.file_path
              : typeof input.notebook_path === 'string'
                ? input.notebook_path
                : name;
          label = display(sanitizePlainText(pathValue));
        } else if (isDelegationToolName(name)) {
          active.delegationToolUseId = toolId;
          label = delegationTool.name;
        }
        const entry = { id: `tool:${toolId}`, kind, text: label };
        active.toolItems.set(toolId, entry);
        this.put({ ...entry, turnId, status: 'in_progress' });
      }
    }
  }

  private handleUser(raw: unknown): void {
    const parsed = userToolResultSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.session_id !== this.owned.sessionId ||
      parsed.data.parent_tool_use_id != null ||
      parsed.data.isMeta ||
      !this.active
    )
      return;
    const active = this.active;
    const turnId = active.turn.turnId;
    for (const block of parsed.data.message.content) {
      const resultBlock = z
        .object({
          type: z.literal('tool_result'),
          tool_use_id: id,
          is_error: z.boolean().optional(),
        })
        .safeParse(block);
      if (!resultBlock.success) continue;
      this.markRunning(active);
      const { tool_use_id: toolUseId, is_error: isError } = resultBlock.data;
      for (const approvalEntry of this.approvals.values()) {
        if (approvalEntry.toolUseId === toolUseId && approvalEntry.approval.state === 'answered')
          approvalEntry.approval.state = 'resolved';
      }
      const existing = active.toolItems.get(toolUseId);
      if (existing) {
        const status: NonNullable<StructuredItem['status']> = active.declinedTools.has(toolUseId)
          ? 'declined'
          : isError
            ? 'failed'
            : 'completed';
        this.put({ ...existing, turnId, status });
      }
      if (toolUseId === active.delegationToolUseId && active.pendingReceipt) {
        active.pendingReceipt.receipt?.(isError !== true);
        active.pendingReceipt = undefined;
      }
    }
  }

  private handleResult(raw: unknown): void {
    const metric = this.usageTracker.observeResult(
      raw,
      this.owned.sessionId,
      this.active?.turn.turnId,
    );
    if (metric) this.state.usage = metric;
    const parsed = resultSchema.safeParse(raw);
    if (!parsed.success || parsed.data.session_id !== this.owned.sessionId || !this.active) return;
    const active = this.active;
    const uuids = parsed.data.user_message_uuids;
    if (uuids && uuids.length > 0 && !uuids.includes(active.turn.turnId))
      throw new Error('Uncorrelated Claude turn result');

    if (parsed.data.subtype === 'success' && parsed.data.is_error !== true) {
      if (typeof parsed.data.result === 'string' && parsed.data.result.trim() && !active.result) {
        const cleaned = sanitizePlainText(parsed.data.result);
        if (!cleaned.startsWith('[Request interrupted')) {
          active.result = display(cleaned).trim() || undefined;
          const itemId = active.streamItemId ?? `result:${active.turn.turnId}`;
          this.put({
            id: itemId,
            turnId: active.turn.turnId,
            kind: 'agent_message',
            text: display(cleaned),
            status: 'completed',
          });
        }
      }
      this.finish(active, 'completed');
      return;
    }

    const aborted =
      active.interruptRequested ||
      ['aborted_tools', 'aborted_streaming', 'interrupted'].includes(
        parsed.data.terminal_reason ?? '',
      );
    this.finish(active, aborted ? 'interrupted' : 'failed');
  }

  private markRunning(active: ActiveTurn): void {
    if (active.turn.state === 'accepted') {
      active.turn.state = 'running';
      this.report(active);
    }
  }

  private finish(
    active: ActiveTurn,
    outcome: 'completed' | 'failed' | 'interrupted' | 'unknown',
  ): void {
    clearTimeout(active.timer);
    if (this.active === active) this.active = undefined;
    active.finishWait?.();
    for (const entry of this.approvals.values()) {
      if (entry.approval.state === 'pending') entry.approval.state = 'unavailable';
      else if (entry.approval.state === 'answered' && outcome !== 'unknown')
        entry.approval.state = 'resolved';
      else if (entry.approval.state === 'answered') entry.approval.state = 'unavailable';
    }
    active.pendingReceipt?.receipt?.(false);
    active.pendingReceipt = undefined;
    active.turn.state = outcome;
    this.report(active);
  }

  private report(active: ActiveTurn): void {
    active.report?.({ ...active.turn }, active.result);
  }
}
