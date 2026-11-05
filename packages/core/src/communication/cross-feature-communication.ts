import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  communicationLimits,
  crossFeatureGrantSchema,
  crossFeatureRequestSchema,
  crossFeatureProviderEvidenceSchema,
  paneHandleSchema,
  type CommunicationJournal,
  type CommunicationPane,
  type CommunicationTransaction,
  type CrossFeatureAudit,
  type CrossFeatureGrant,
  type CrossFeatureMessage,
  type CrossFeatureRequest,
  type CrossFeatureProviderEvidence,
  type CommunicationContent,
} from '@orqst/protocol';
import type { CrossParentGate } from './service.js';
import { featurePermissionRevision, type FeaturePermissionReader } from './feature-permissions.js';
import type { FeatureConfigurationDatabase } from '../terminal/feature-configuration.js';

/** Trusted injected port. No production implementation or renderer endpoint is provided. */
export interface CrossFeatureAuthority {
  verify(grant: Readonly<CrossFeatureGrant>, proof: unknown): boolean;
}
type Snapshot = FeatureConfigurationDatabase['crossFeatureSnapshot'];
export interface CrossFeatureAdapter {
  ready(pane: Readonly<CommunicationPane>): boolean;
  submit(
    message: Readonly<CrossFeatureMessage>,
    content: Uint8Array,
    evidence: (event: CrossFeatureProviderEvidence) => void,
  ): Promise<void>;
}
export interface CrossFeatureTransport {
  adapter(paneId: string): CrossFeatureAdapter | undefined;
  resolve(
    grant: Readonly<CrossFeatureGrant>,
    purpose: 'request' | 'result',
    id: string,
  ): Uint8Array;
}
const activeCross = (state: CrossFeatureMessage['state']) =>
  [
    'dispatching',
    'accepted',
    'delivered',
    'running',
    'waiting_approval',
    'outcome_unknown',
  ].includes(state);

export const crossFeatureIntentDigest = (request: CrossFeatureRequest) =>
  createHash('sha256')
    .update(JSON.stringify(crossFeatureRequestSchema.parse(request)))
    .digest('hex');

/** Separate opt-in boundary. Never installed by the production composition. */
export class CrossFeatureCommunication {
  private readonly admittedGrants = new Map<string, unknown>();
  private activeSnapshot?: Snapshot;
  private activeLocalReader?: FeaturePermissionReader;
  private readonly listeners = new Map<string, Set<(message: CrossFeatureMessage) => void>>();

  constructor(
    private readonly journal: CommunicationJournal,
    private readonly snapshot: Snapshot,
    private readonly authority: CrossFeatureAuthority,
    private readonly now: () => number = Date.now,
    private readonly transport?: CrossFeatureTransport,
    private readonly snapshotLock?: FeatureConfigurationDatabase['withPermissionSnapshot'],
  ) {
    this.journal.enableCross();
  }

  private check(
    tx: CommunicationTransaction,
    grant: CrossFeatureGrant,
    operation: 'task.request' | 'task.view',
    snapshotReader: Snapshot = this.activeSnapshot ?? this.snapshot,
  ) {
    const panes = tx.panes();
    const source = panes.find((p) => p.paneId === grant.source.paneId);
    const target = panes.find((p) => p.paneId === grant.target.paneId);
    const matches = (pane: CommunicationPane | undefined, endpoint: CrossFeatureGrant['source']) =>
      pane &&
      pane.workspaceId === grant.workspaceId &&
      pane.featureId === endpoint.featureId &&
      pane.terminalId === endpoint.terminalId &&
      pane.ownership === 'managed' &&
      pane.state !== 'closed' &&
      pane.state !== 'unavailable' &&
      JSON.stringify(pane.binding) === JSON.stringify(endpoint.binding);
    if (
      !matches(source, grant.source) ||
      !matches(target, grant.target) ||
      !source ||
      !target ||
      !source.routing ||
      !target.routing ||
      !source.capabilities.canSend ||
      !target.capabilities.canSend ||
      !target.capabilities.canQueueWhileBusy ||
      !target.capabilities.canAcknowledge ||
      !target.capabilities.canReportTaskCompletion ||
      !tx
        .crossRoutes()
        .some(
          (route) =>
            route.workspaceId === grant.workspaceId &&
            JSON.stringify(route.source) === JSON.stringify(grant.source) &&
            JSON.stringify(route.target) === JSON.stringify(grant.target),
        )
    )
      throw new Error('Cross-Feature pane or route denied');
    // One synchronous snapshot, called while the journal transaction is held.
    const { source: a, target: b } = snapshotReader(grant.source.featureId, grant.target.featureId);
    if (
      a.state.workspaceId !== grant.workspaceId ||
      b.state.workspaceId !== grant.workspaceId ||
      a.state.featureId !== grant.source.featureId ||
      b.state.featureId !== grant.target.featureId ||
      a.feature.workspaceId !== grant.workspaceId ||
      b.feature.workspaceId !== grant.workspaceId ||
      a.feature.featureId !== grant.source.featureId ||
      b.feature.featureId !== grant.target.featureId ||
      a.feature.status === 'archived' ||
      b.feature.status === 'archived' ||
      !a.feature.terminalIds.includes(grant.source.terminalId) ||
      !b.feature.terminalIds.includes(grant.target.terminalId) ||
      a.state.revision !== grant.sourceRevision ||
      b.state.revision !== grant.targetRevision
    )
      throw new Error('Cross-Feature scope or revision denied');
    const allowed = (
      rules: typeof a.state.policy,
      direction: 'outbound' | 'inbound',
      local: CrossFeatureGrant['source'],
      remote: CrossFeatureGrant['target'],
    ) =>
      rules?.rules.some(
        (r) =>
          r.direction === direction &&
          r.localTerminalId === local.terminalId &&
          r.remoteFeatureId === remote.featureId &&
          r.remoteTerminalId === remote.terminalId &&
          r.operation === operation,
      );
    if (
      !allowed(a.state.policy, 'outbound', grant.source, grant.target) ||
      !allowed(b.state.policy, 'inbound', grant.target, grant.source)
    )
      throw new Error('Cross-Feature policy denied');
    return { source, target };
  }
  /** Trusted host review; this records an exact route and grants no send authority. */
  configureRoute(rawGrant: unknown, rawRequest: unknown, proof: unknown): void {
    const grant = crossFeatureGrantSchema.parse(rawGrant);
    const request = crossFeatureRequestSchema.parse(rawRequest);
    if (
      grant.deadline <= this.now() ||
      grant.intentDigest !== crossFeatureIntentDigest(request) ||
      !this.authority.verify(grant, proof)
    )
      throw new Error('Cross-Feature route authority denied');
    this.journal.transaction((tx) => {
      const source = tx.panes().find((pane) => pane.paneId === grant.source.paneId);
      const target = tx.panes().find((pane) => pane.paneId === grant.target.paneId);
      const matches = (
        pane: CommunicationPane | undefined,
        endpoint: CrossFeatureGrant['source'],
      ) =>
        pane?.workspaceId === grant.workspaceId &&
        pane.featureId === endpoint.featureId &&
        pane.terminalId === endpoint.terminalId &&
        pane.ownership === 'managed' &&
        pane.routing &&
        !['closed', 'unavailable'].includes(pane.state) &&
        JSON.stringify(pane.binding) === JSON.stringify(endpoint.binding);
      if (!matches(source, grant.source) || !matches(target, grant.target))
        throw new Error('Cross-Feature route scope denied');
      const snapshot = this.snapshot(grant.source.featureId, grant.target.featureId);
      if (
        snapshot.source.feature.workspaceId !== grant.workspaceId ||
        snapshot.target.feature.workspaceId !== grant.workspaceId ||
        snapshot.source.feature.featureId !== grant.source.featureId ||
        snapshot.target.feature.featureId !== grant.target.featureId ||
        snapshot.source.feature.status === 'archived' ||
        snapshot.target.feature.status === 'archived' ||
        !snapshot.source.feature.terminalIds.includes(grant.source.terminalId) ||
        !snapshot.target.feature.terminalIds.includes(grant.target.terminalId) ||
        grant.deadline <= this.now() ||
        !this.authority.verify(grant, proof)
      )
        throw new Error('Cross-Feature route membership denied');
      tx.saveCrossRoute({
        schemaVersion: 1,
        workspaceId: grant.workspaceId,
        source: grant.source,
        target: grant.target,
      });
    });
  }
  private audit(
    message: CrossFeatureMessage,
    outcome: CrossFeatureAudit['outcome'],
  ): Omit<CrossFeatureAudit, 'sequence'> {
    const { grant: g, request } = message;
    return {
      schemaVersion: 1,
      eventId: randomUUID(),
      timestamp: this.now(),
      actorId: g.actorId,
      workspaceId: g.workspaceId,
      sourceFeatureId: g.source.featureId,
      targetFeatureId: g.target.featureId,
      sourceTerminalId: g.source.terminalId,
      targetTerminalId: g.target.terminalId,
      sourcePaneId: g.source.paneId,
      targetPaneId: g.target.paneId,
      operation: g.operation,
      grantId: g.grantId,
      intentId: g.intentId,
      messageId: request.messageId,
      sourceRevision: g.sourceRevision,
      targetRevision: g.targetRevision,
      state: message.state,
      outcome,
    };
  }
  admit(rawGrant: unknown, rawRequest: unknown, proof: unknown): CrossFeatureMessage {
    const grant = crossFeatureGrantSchema.parse(rawGrant);
    const request = crossFeatureRequestSchema.parse(rawRequest);
    if (
      grant.intentDigest !== crossFeatureIntentDigest(request) ||
      !this.authority.verify(grant, proof)
    )
      throw new Error('Cross-Feature authority denied');
    const proposed: CrossFeatureMessage = {
      schemaVersion: 1,
      grant,
      request,
      state: 'queued',
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    if (
      grant.deadline <= this.now() ||
      grant.deadline > this.now() + communicationLimits.lifetimeMs
    ) {
      this.journal.transaction((tx) => tx.auditCross(proposed, this.audit(proposed, 'denied')));
      throw new Error('Cross-Feature authority denied');
    }
    let admitted: CrossFeatureMessage;
    try {
      admitted = this.journal.transaction((tx) => {
        const invoke = () => {
          if (request.parentTaskId && (!this.activeSnapshot || !this.activeLocalReader))
            throw new Error('Cross-Feature parent snapshot unavailable');
          this.check(tx, grant, 'task.request');
          if (grant.deadline <= this.now() || !this.authority.verify(grant, proof))
            throw new Error('Cross-Feature authority expired');
          const local = tx.messages();
          if (
            local.some(
              (m) =>
                m.messageId === request.messageId ||
                m.taskId === request.taskId ||
                (m.workspaceId === grant.workspaceId &&
                  m.targetPaneId === grant.target.paneId &&
                  m.idempotencyKey === request.idempotencyKey),
            )
          )
            throw new Error('Cross-Feature message identity conflict');
          const all = tx.crossMessages();
          if (
            all.length + local.length >= communicationLimits.messages ||
            all.filter((m) => m.state === 'queued' && m.grant.target.paneId === grant.target.paneId)
              .length +
              local.filter(
                (m) =>
                  m.targetPaneId === grant.target.paneId &&
                  m.deliveryState === 'queued' &&
                  m.taskState === 'pending',
              ).length >=
              communicationLimits.queuedPerPane ||
            all.filter((m) => m.grant.actorId === grant.actorId && m.createdAt > this.now() - 60000)
              .length +
              local.filter((m) => m.actorId === grant.actorId && m.createdAt > this.now() - 60000)
                .length >=
              communicationLimits.admissionsPerMinute
          )
            throw new Error('Cross-Feature queue or rate limit');
          let depth = 0;
          let parentId = request.parentTaskId ?? null;
          let expectedPane = grant.source.paneId;
          let expectedFeature = grant.source.featureId;
          const ancestors = new Set([grant.target.paneId]);
          while (parentId) {
            if (
              !request.correlationId ||
              ancestors.has(expectedPane) ||
              ++depth > communicationLimits.maxDepth
            )
              throw new Error('Cross-Feature parent cycle or depth denied');
            ancestors.add(expectedPane);
            const cross = all.find((m) => m.request.taskId === parentId);
            const legacy = local.find((m) => m.taskId === parentId);
            if (cross) {
              const allowed = this.crossParent(
                tx,
                parentId,
                {
                  workspaceId: grant.workspaceId,
                  featureId: expectedFeature,
                  targetPaneId: expectedPane,
                  correlationId: request.correlationId,
                },
                this.activeSnapshot!,
              );
              if (!allowed) throw new Error('Cross-Feature parent denied');
              expectedPane = allowed.sourcePaneId;
              expectedFeature = allowed.sourceFeatureId;
              parentId = allowed.parentTaskId;
            } else if (legacy) {
              if (
                legacy.workspaceId !== grant.workspaceId ||
                legacy.featureId !== expectedFeature ||
                legacy.targetPaneId !== expectedPane ||
                legacy.correlationId !== request.correlationId ||
                ['completed', 'failed', 'cancelled', 'outcome_unknown'].includes(legacy.taskState)
              )
                throw new Error('Cross-Feature parent denied');
              const sourcePane = tx.panes().find((pane) => pane.paneId === legacy.sourcePaneId);
              const targetPane = tx.panes().find((pane) => pane.paneId === legacy.targetPaneId);
              if (!sourcePane || !targetPane || !this.activeLocalReader)
                throw new Error('Cross-Feature parent unavailable');
              featurePermissionRevision(sourcePane, targetPane, ['view'], this.activeLocalReader);
              expectedPane = legacy.sourcePaneId;
              parentId = legacy.parentTaskId;
            } else throw new Error('Cross-Feature parent unavailable');
          }
          if (ancestors.has(expectedPane)) throw new Error('Cross-Feature parent cycle denied');
          const edges = all
            .filter((m) => !['completed', 'failed'].includes(m.state))
            .map((m) => [m.grant.source.paneId, m.grant.target.paneId]);
          edges.push(
            ...local
              .filter((m) => !['completed', 'failed', 'cancelled'].includes(m.taskState))
              .map((m) => [m.sourcePaneId, m.targetPaneId]),
          );
          const reachable = (from: string, seen: Set<string>): boolean => {
            if (from === grant.source.paneId) return true;
            if (seen.has(from)) return false;
            seen.add(from);
            return edges.some(([a, b]) => a === from && b !== undefined && reachable(b, seen));
          };
          if (reachable(grant.target.paneId, new Set())) throw new Error('Cross-Feature cycle');
          const timestamp = this.now();
          const message: CrossFeatureMessage = {
            schemaVersion: 1,
            grant,
            request,
            depth,
            state: 'queued',
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          tx.auditCross(message, this.audit(message, 'grant_issued'));
          tx.insertCross(message, this.audit(message, 'admitted'));
          return message;
        };
        if (!this.snapshotLock) return invoke();
        return this.snapshotLock((local, cross) => {
          this.activeSnapshot = cross;
          this.activeLocalReader = local;
          try {
            return invoke();
          } finally {
            this.activeSnapshot = undefined;
            this.activeLocalReader = undefined;
          }
        });
      });
    } catch (error) {
      this.journal.transaction((tx) => tx.auditCross(proposed, this.audit(proposed, 'denied')));
      throw error;
    }
    this.admittedGrants.set(grant.grantId, proof);
    this.notify(admitted);
    return admitted;
  }
  claim(messageId: string): CrossFeatureMessage | undefined {
    const result = this.journal.transaction((tx) => {
      const message = tx.crossMessages().find((m) => m.request.messageId === messageId);
      if (
        !message ||
        message.state !== 'queued' ||
        !this.admittedGrants.has(message.grant.grantId) ||
        message.grant.deadline <= this.now()
      )
        return undefined;
      try {
        const { target } = this.check(tx, message.grant, 'task.request');
        if (!this.authority.verify(message.grant, this.admittedGrants.get(message.grant.grantId)))
          return undefined;
        if (
          target.state !== 'ready' ||
          tx.crossMessages().filter((m) => activeCross(m.state)).length +
            tx
              .messages()
              .filter(
                (m) =>
                  ['dispatching', 'accepted', 'delivered', 'delivery_unknown'].includes(
                    m.deliveryState,
                  ) && !['completed', 'failed', 'cancelled'].includes(m.taskState),
              ).length >=
            communicationLimits.activeTasks ||
          tx
            .messages()
            .some(
              (m) =>
                m.targetPaneId === target.paneId &&
                ['dispatching', 'accepted', 'delivered', 'delivery_unknown'].includes(
                  m.deliveryState,
                ) &&
                !['completed', 'failed', 'cancelled'].includes(m.taskState),
            ) ||
          tx
            .crossMessages()
            .some((m) => m.grant.target.paneId === target.paneId && activeCross(m.state))
        )
          return undefined;
      } catch {
        return undefined;
      }
      if (message.grant.deadline <= this.now()) return undefined;
      const claimed: CrossFeatureMessage = {
        ...message,
        state: 'dispatching',
        attemptId: randomUUID(),
        updatedAt: this.now(),
      };
      tx.updateCross(claimed, this.audit(claimed, 'dispatch_claimed'));
      return claimed;
    });
    if (result) this.notify(result);
    return result;
  }
  view(
    messageId: string,
    grant: CrossFeatureGrant,
    proof: unknown,
  ): CrossFeatureMessage | undefined {
    const parsed = crossFeatureGrantSchema.parse(grant);
    if (
      parsed.deadline <= this.now() ||
      !this.admittedGrants.has(parsed.grantId) ||
      !this.authority.verify(parsed, proof)
    )
      return undefined;
    return this.journal.transaction((tx) => {
      const message = tx.crossMessages().find((m) => m.request.messageId === messageId);
      if (!message || JSON.stringify(message.grant) !== JSON.stringify(parsed)) return undefined;
      try {
        this.check(tx, message.grant, 'task.view');
        if (parsed.deadline <= this.now() || !this.authority.verify(parsed, proof))
          return undefined;
      } catch {
        return undefined;
      }
      return message;
    });
  }
  /** Trusted, opt-in ancestor gate: both policies and the retained authority must allow view. */
  readonly crossParent: CrossParentGate = (tx, taskId, expected, snapshot) => {
    if (!snapshot) return undefined;
    const message = tx.crossMessages().find((item) => item.request.taskId === taskId);
    if (
      !message ||
      message.grant.workspaceId !== expected.workspaceId ||
      message.grant.target.featureId !== expected.featureId ||
      message.grant.target.paneId !== expected.targetPaneId ||
      message.request.correlationId !== expected.correlationId ||
      message.grant.deadline <= this.now() ||
      !this.admittedGrants.has(message.grant.grantId) ||
      ['completed', 'failed', 'outcome_unknown'].includes(message.state)
    )
      return undefined;
    try {
      this.check(tx, message.grant, 'task.view', snapshot);
      if (!this.authority.verify(message.grant, this.admittedGrants.get(message.grant.grantId)))
        return undefined;
    } catch {
      return undefined;
    }
    return {
      sourcePaneId: message.grant.source.paneId,
      sourceFeatureId: message.grant.source.featureId,
      parentTaskId: message.request.parentTaskId ?? null,
    };
  };
  /** Exact Feature ID is required; duplicate or missing handles are never guessed. */
  resolveTarget(workspaceId: string, featureId: string, handle: string): CommunicationPane {
    z.string()
      .regex(/^[a-zA-Z0-9_-]{1,128}$/)
      .parse(workspaceId);
    z.uuid().parse(featureId);
    paneHandleSchema.parse(handle);
    return this.journal.transaction((tx) => {
      const candidates = tx
        .panes()
        .filter(
          (p) =>
            p.workspaceId === workspaceId &&
            p.featureId === featureId &&
            p.routing?.handle === handle &&
            p.ownership === 'managed' &&
            !['closed', 'unavailable'].includes(p.state),
        );
      if (candidates.length !== 1) throw new Error('Cross-Feature target missing or ambiguous');
      const target = candidates[0]!;
      const { target: snapshot } = this.snapshot(featureId, featureId);
      if (
        snapshot.feature.workspaceId !== workspaceId ||
        snapshot.feature.featureId !== featureId ||
        snapshot.feature.status === 'archived' ||
        !target.terminalId ||
        !snapshot.feature.terminalIds.includes(target.terminalId)
      )
        throw new Error('Cross-Feature target scope denied');
      return target;
    });
  }
  revoke(messageId: string, grant: CrossFeatureGrant, proof: unknown): void {
    const parsed = crossFeatureGrantSchema.parse(grant);
    if (!this.authority.verify(parsed, proof) || !this.admittedGrants.has(parsed.grantId))
      throw new Error('Cross-Feature revocation denied');
    this.admittedGrants.delete(parsed.grantId);
    this.journal.transaction((tx) => {
      const message = tx
        .crossMessages()
        .find((m) => m.request.messageId === messageId && m.grant.grantId === parsed.grantId);
      if (!message || JSON.stringify(message.grant) !== JSON.stringify(parsed))
        throw new Error('Cross-Feature message unavailable');
      tx.auditCross(message, this.audit(message, 'revoked'));
    });
  }
  subscribe(
    messageId: string,
    grant: CrossFeatureGrant,
    proof: unknown,
    listener: (m: CrossFeatureMessage) => void,
  ): () => void {
    if (!this.view(messageId, grant, proof)) throw new Error('Cross-Feature view denied');
    const listeners = this.listeners.get(messageId) ?? new Set();
    const guarded = (message: CrossFeatureMessage) => {
      if (this.view(messageId, grant, proof)) listener(message);
    };
    listeners.add(guarded);
    this.listeners.set(messageId, listeners);
    return () => {
      listeners.delete(guarded);
      if (!listeners.size) this.listeners.delete(messageId);
    };
  }
  private notify(message: CrossFeatureMessage): void {
    const listeners = this.listeners.get(message.request.messageId);
    if (!listeners) return;
    for (const listener of listeners)
      queueMicrotask(() => {
        if (!listeners.has(listener)) return;
        try {
          listener(structuredClone(message));
        } catch {
          /* Consumer failure does not alter journal facts. */
        }
      });
  }
  private content(
    grant: CrossFeatureGrant,
    purpose: 'request' | 'result',
    ref: CommunicationContent,
  ): Uint8Array {
    if (!this.transport) throw new Error('Cross-Feature transport unavailable');
    const value = this.transport.resolve(Object.freeze(structuredClone(grant)), purpose, ref.id);
    if (
      !(value instanceof Uint8Array) ||
      value.byteLength !== ref.bytes ||
      createHash('sha256').update(value).digest('hex') !== ref.sha256
    )
      throw new Error('Cross-Feature content unavailable');
    return Uint8Array.from(value);
  }
  async dispatch(messageId: string): Promise<CrossFeatureMessage | undefined> {
    const prepared = this.journal.transaction((tx) => {
      const message = tx.crossMessages().find((m) => m.request.messageId === messageId);
      if (
        !message ||
        message.state !== 'queued' ||
        !this.admittedGrants.has(message.grant.grantId) ||
        message.grant.deadline <= this.now()
      )
        return undefined;
      const { target } = this.check(tx, message.grant, 'task.request');
      if (!this.authority.verify(message.grant, this.admittedGrants.get(message.grant.grantId)))
        return undefined;
      const adapter = this.transport?.adapter(target.paneId);
      if (!adapter || !adapter.ready(target)) return undefined;
      return { adapter, content: this.content(message.grant, 'request', message.request.payload) };
    });
    if (!prepared) return undefined;
    const claim = this.claim(messageId);
    if (!claim) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        prepared.adapter.submit(structuredClone(claim), prepared.content, (event) =>
          this.evidence(claim, event),
        ),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Cross-Feature dispatch timeout')),
            communicationLimits.dispatchMs,
          );
        }),
      ]);
      const stillDispatching = this.journal.transaction((tx) =>
        tx
          .crossMessages()
          .some((m) => m.request.messageId === messageId && m.state === 'dispatching'),
      );
      if (stillDispatching) this.uncertain(messageId);
    } catch {
      this.uncertain(messageId);
    } finally {
      if (timer) clearTimeout(timer);
    }
    return this.journal.transaction((tx) =>
      tx.crossMessages().find((m) => m.request.messageId === messageId),
    );
  }
  private evidence(claim: CrossFeatureMessage, raw: CrossFeatureProviderEvidence): void {
    const event = crossFeatureProviderEvidenceSchema.parse(raw);
    const updated = this.journal.transaction((tx) => {
      const message = tx
        .crossMessages()
        .find((m) => m.request.messageId === claim.request.messageId);
      const pane = tx.panes().find((p) => p.paneId === claim.grant.target.paneId);
      if (
        !message ||
        !pane?.binding ||
        ['closed', 'unavailable'].includes(pane.state) ||
        event.messageId !== message.request.messageId ||
        event.taskId !== message.request.taskId ||
        event.correlationId !== message.request.correlationId ||
        event.targetPaneId !== message.grant.target.paneId ||
        event.attemptId !== message.attemptId ||
        event.instanceId !== pane.binding.instanceId ||
        event.terminalEpoch !== pane.binding.terminalEpoch ||
        JSON.stringify(pane.binding) !== JSON.stringify(message.grant.target.binding)
      )
        throw new Error('Cross-Feature provider correlation denied');
      if (
        ['accepted', 'delivered'].includes(event.event)
          ? !pane.capabilities.canAcknowledge
          : !pane.capabilities.canReportTaskCompletion
      )
        throw new Error('Cross-Feature provider capability denied');
      const state = event.event === 'started' ? 'running' : event.event;
      if (event.result) this.content(message.grant, 'result', event.result);
      const next: CrossFeatureMessage = {
        ...message,
        state,
        evidenceId: event.evidenceId,
        ...(event.result ? { result: event.result } : {}),
        updatedAt: Math.max(this.now(), message.updatedAt),
      };
      tx.updateCross(next, this.audit(next, 'provider_evidence'));
      return next;
    });
    this.notify(updated);
  }
  private uncertain(messageId: string): void {
    const changed = this.journal.transaction((tx) => {
      const message = tx.crossMessages().find((m) => m.request.messageId === messageId);
      if (!message || !activeCross(message.state) || message.state === 'outcome_unknown')
        return undefined;
      const next: CrossFeatureMessage = {
        ...message,
        state: 'outcome_unknown',
        updatedAt: Math.max(this.now(), message.updatedAt),
      };
      tx.updateCross(next, this.audit(next, 'outcome_unknown'));
      return next;
    });
    if (changed) this.notify(changed);
  }
}
