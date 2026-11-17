import { randomUUID } from 'node:crypto';
import { redact } from '@orqst/shared';
import {
  structuredAgentsLimits as limits,
  type StructuredAgentsReply,
  type StructuredAgentsRequest,
  type StructuredAgentsScope,
  type StructuredAgentsSnapshot,
  type StructuredDelegation,
  type StructuredProvider,
} from '@orqst/protocol';
import { StructuredCodexSession } from './codex-session.js';
import { OwnedOpenCode } from './opencode-process.js';
import { StructuredOpenCodeSession } from './opencode-session.js';
import type { OwnedStructuredSession, StructuredDelegate } from './session.js';
import { spawnCodexAppServer, type StructuredProcessTransport } from './codex-process.js';

export interface StructuredLaunch {
  executable: string;
  cwd: string;
  env: Record<string, string>;
  provider?: StructuredProvider;
}

type Mutation = Exclude<StructuredAgentsRequest, { action: 'snapshot' }>;
const grantMs = 5 * 60_000;
const refusal = { success: false, text: 'No matching user grant or worker unavailable.' };

export class StructuredAgents {
  private readonly sessions = new Map<
    string,
    { scope: StructuredAgentsScope; session: OwnedStructuredSession }
  >();
  private readonly delegations: StructuredDelegation[] = [];
  private readonly grants = new Map<
    string,
    { targetId: string; task: string; expiresAt: number }
  >();
  private closed = false;

  constructor(
    private readonly ownProcess: (
      input: StructuredLaunch,
    ) => StructuredProcessTransport = spawnCodexAppServer,
    private readonly now = Date.now,
    private readonly ownOpenCode = (input: StructuredLaunch) => new OwnedOpenCode(input),
  ) {}

  private find(scope: StructuredAgentsScope, id: string): OwnedStructuredSession | undefined {
    const entry = this.sessions.get(id);
    if (entry?.scope.workspaceId === scope.workspaceId && entry.scope.featureId === scope.featureId)
      return entry.session;
  }

  snapshot(scope: StructuredAgentsScope): StructuredAgentsSnapshot {
    return {
      sessions: [...this.sessions.keys()].flatMap((key) => {
        const session = this.find(scope, key);
        return session ? [session.snapshot()] : [];
      }),
      delegations: this.delegations
        .filter(
          (entry) =>
            this.find(scope, entry.sourceSessionId) && this.find(scope, entry.targetSessionId),
        )
        .map((entry) => ({ ...entry })),
    };
  }

  review(scope: StructuredAgentsScope, request: Mutation): object | undefined {
    if (this.closed) return;
    if (request.action === 'start')
      return { label: request.label, provider: request.provider ?? 'codex' };
    if (request.action === 'grant') {
      const source = this.find(scope, request.sourceSessionId);
      const target = this.find(scope, request.targetSessionId);
      if (
        !source?.ready ||
        !target?.ready ||
        source === target ||
        redact(request.task) !== request.task
      )
        return;
      return {
        source: { label: source.snapshot().label, sessionId: source.id },
        target: { label: target.snapshot().label, sessionId: target.id },
        task: request.task,
        expiresInSeconds: grantMs / 1000,
      };
    }
    const session = this.find(scope, request.sessionId);
    if (!session) return;
    const { label, provider } = session.snapshot();
    const identity = { label, provider, sessionId: session.id };
    if (request.action === 'approval') {
      const approval = session.approval(request.approvalId, request.decision);
      return (
        approval && { ...identity, ...approval, decision: request.decision, decisions: undefined }
      );
    }
    if (request.action === 'turn')
      return session.ready ? { ...identity, text: request.text } : undefined;
    if (request.action === 'interrupt') {
      const state = session.snapshot();
      return state.lifecycle === 'ready' &&
        state.busy &&
        state.turn &&
        ['accepted', 'running'].includes(state.turn.state)
        ? { ...identity, turnId: state.turn.turnId }
        : undefined;
    }
    if (['exited', 'failed', 'stopping'].includes(session.lifecycle)) return;
    return identity;
  }

  async apply(
    scope: StructuredAgentsScope,
    request: Mutation,
    launch?: StructuredLaunch,
  ): Promise<StructuredAgentsReply> {
    if (!this.review(scope, request)) return { status: 'denied' };
    if (request.action === 'start') {
      const provider = request.provider ?? 'codex';
      if (!launch || provider !== (launch.provider ?? 'codex')) return { status: 'denied' };
      if (this.sessions.size >= limits.sessions) {
        const old = [...this.sessions].find(([, entry]) =>
          ['exited', 'failed'].includes(entry.session.lifecycle),
        );
        if (!old) return { status: 'busy' };
        this.sessions.delete(old[0]);
        this.grants.delete(old[0]);
      }
      const sessionScope = { ...scope, label: request.label };
      const delegate: StructuredDelegate = (call) => this.delegate(scope, session.id, call);
      const session: OwnedStructuredSession =
        provider === 'opencode'
          ? new StructuredOpenCodeSession(sessionScope, this.ownOpenCode(launch), delegate)
          : new StructuredCodexSession(sessionScope, this.ownProcess(launch), delegate);
      this.sessions.set(session.id, { scope: { ...scope }, session });
      await session.initialize(launch.cwd);
    } else if (request.action === 'grant') {
      this.grants.set(request.sourceSessionId, {
        targetId: request.targetSessionId,
        task: request.task,
        expiresAt: this.now() + grantMs,
      });
    } else {
      const session = this.find(scope, request.sessionId)!;
      switch (request.action) {
        case 'turn': {
          const grant = this.grants.get(session.id);
          const delegation =
            grant && grant.expiresAt > this.now()
              ? { targetPaneId: grant.targetId, task: grant.task }
              : undefined;
          await session.startTurn(request.text, 'human', undefined, { delegation });
          break;
        }
        case 'approval':
          await session.answer(request.approvalId, request.decision);
          break;
        case 'interrupt':
          await session.interrupt();
          break;
        case 'stop':
          this.grants.delete(session.id);
          await session.stop();
          break;
      }
    }
    return { status: 'ok' };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.grants.clear();
    await Promise.all([...this.sessions.values()].map(({ session }) => session.stop()));
  }

  private async delegate(
    scope: StructuredAgentsScope,
    sourceId: string,
    call: Parameters<StructuredDelegate>[0],
  ): ReturnType<StructuredDelegate> {
    const grant = this.grants.get(sourceId);
    const target = this.find(scope, call.arguments.targetPaneId);
    const source = this.find(scope, sourceId);
    if (
      this.closed ||
      !grant ||
      grant.expiresAt <= this.now() ||
      grant.targetId !== call.arguments.targetPaneId ||
      grant.task !== call.arguments.task ||
      !target?.ready
    )
      return refusal;
    this.grants.delete(sourceId);
    const record: StructuredDelegation = {
      delegationId: randomUUID(),
      sourceSessionId: sourceId,
      targetSessionId: target.id,
      state: 'requested',
      targetTurnId: null,
    };
    this.delegations.push(record);
    if (this.delegations.length > limits.delegations) this.delegations.shift();
    return new Promise((resolve) => {
      void target
        .startTurn(
          grant.task,
          'delegation',
          (turn, result) => {
            record.targetTurnId = turn.turnId;
            record.state = turn.state;
            if (turn.state === 'accepted' || turn.state === 'running') return;
            if (turn.state === 'completed' && result) {
              resolve({
                success: true,
                text: JSON.stringify({
                  delegationId: record.delegationId,
                  untrustedWorkerResult: result.slice(0, 2000),
                  truncated: result.length > 2000,
                }),
                receipt: (received) => {
                  record.state = received ? 'returned' : 'unknown';
                },
              });
            } else {
              resolve({ success: false, text: 'Worker result unavailable.' });
            }
          },
          {
            parentTurnId:
              source?.snapshot().provider === 'codex' && target.snapshot().provider === 'codex'
                ? call.turnId
                : undefined,
          },
        )
        .catch(() => {
          record.state = 'unknown';
          resolve({ success: false, text: 'Worker turn outcome unknown.' });
        });
    });
  }
}
