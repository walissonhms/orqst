import { randomUUID } from 'node:crypto';
import { redact } from '@orqst/shared';
import {
  structuredAgentsLimits as limits,
  type StructuredAgentsUnavailableReason,
  type StructuredApproval,
  type StructuredDecision,
  type StructuredItem,
  type StructuredProvider,
  type StructuredSession,
  type StructuredTurn,
} from '@orqst/protocol';

export type SessionScope = Pick<StructuredSession, 'featureId' | 'workspaceId' | 'label'>;
export type TurnReport = (turn: StructuredTurn, result?: string) => void;
export interface DelegationTask {
  targetPaneId: string;
  task: string;
}

export interface DelegationResult {
  success: boolean;
  text: string;
  receipt?(received: boolean): void;
}

export type StructuredDelegate = (call: {
  arguments: DelegationTask;
  turnId: string;
}) => Promise<DelegationResult>;

export class StructuredStartupFailure extends Error {
  constructor(readonly reason: Extract<StructuredAgentsUnavailableReason, `provider_${string}`>) {
    super(reason);
  }
}

export interface StructuredTurnOptions {
  parentTurnId?: string;
  delegation?: DelegationTask;
  peerContext?: string;
}

export interface OwnedStructuredSession {
  readonly id: string;
  readonly ready: boolean;
  readonly lifecycle: StructuredSession['lifecycle'];
  snapshot(): StructuredSession;
  initialize(cwd: string): Promise<void>;
  startTurn(
    text: string,
    origin: StructuredTurn['origin'],
    report?: TurnReport,
    options?: StructuredTurnOptions,
  ): Promise<void>;
  approval(id: string, decision: StructuredDecision): StructuredApproval | undefined;
  answer(id: string, decision: StructuredDecision): void | Promise<void>;
  interrupt(): Promise<void>;
  stop(): Promise<void>;
}

export function display(text: string, max: number = limits.itemText): string {
  return redact(text).slice(0, max);
}

export class StructuredProjection {
  protected readonly state: StructuredSession;
  private itemBytes = 0;

  constructor(scope: SessionScope, provider: StructuredProvider) {
    this.state = {
      ...scope,
      sessionId: randomUUID(),
      provider,
      lifecycle: 'starting',
      reportedModel: null,
      threadId: null,
      items: [],
      droppedItems: 0,
      approvals: [],
      turn: null,
      busy: false,
      exit: null,
    };
  }

  get id() {
    return this.state.sessionId;
  }

  get lifecycle() {
    return this.state.lifecycle;
  }

  protected put(item: StructuredItem): void {
    const items = this.state.items;
    const index = items.findIndex((old) => old.id === item.id && old.turnId === item.turnId);
    if (index >= 0) {
      this.itemBytes -= Buffer.byteLength(JSON.stringify(items[index]));
      items[index] = item;
    } else items.push(item);
    this.itemBytes += Buffer.byteLength(JSON.stringify(item));
    while (items.length > limits.items || this.itemBytes > 32 * 1024) {
      this.itemBytes -= Buffer.byteLength(JSON.stringify(items.shift()));
      this.state.droppedItems++;
    }
  }
}
