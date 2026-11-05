import { createHash, randomUUID } from 'node:crypto';
import {
  communicationLimits,
  crossFeatureGrantSchema,
  crossFeatureRequestSchema,
  type CommunicationJournal,
  type CommunicationPane,
  type CommunicationTransaction,
  type CrossFeatureAudit,
  type CrossFeatureGrant,
  type CrossFeatureMessage,
  type CrossFeatureRequest,
} from '@orqst/protocol';
import type { FeatureConfigurationDatabase } from '../terminal/feature-configuration.js';

/** Trusted injected port. No production implementation or renderer endpoint is provided. */
export interface CrossFeatureAuthority {
  verify(grant: Readonly<CrossFeatureGrant>, proof: unknown): boolean;
}
type Snapshot = FeatureConfigurationDatabase['crossFeatureSnapshot'];
export const crossFeatureIntentDigest = (request: CrossFeatureRequest) =>
  createHash('sha256')
    .update(JSON.stringify(crossFeatureRequestSchema.parse(request)))
    .digest('hex');

/** Separate opt-in boundary. Never installed by the production composition. */
export class CrossFeatureCommunication {
  private readonly admittedGrants = new Map<string, unknown>();

  constructor(
    private readonly journal: CommunicationJournal,
    private readonly snapshot: Snapshot,
    private readonly authority: CrossFeatureAuthority,
    private readonly now: () => number = Date.now,
  ) {}

  private check(
    tx: CommunicationTransaction,
    grant: CrossFeatureGrant,
    operation: 'task.request' | 'task.view',
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
      !source.capabilities.canSend ||
      !target.capabilities.canSend ||
      !target.capabilities.canQueueWhileBusy ||
      !target.capabilities.canAcknowledge ||
      !target.capabilities.canReportTaskCompletion ||
      !source.routing?.allowedTargetPaneIds.includes(target.paneId)
    )
      throw new Error('Cross-Feature pane or route denied');
    // One synchronous snapshot, called while the journal transaction is held.
    const { source: a, target: b } = this.snapshot(grant.source.featureId, grant.target.featureId);
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
      outcome,
    };
  }
  admit(rawGrant: unknown, rawRequest: unknown, proof: unknown): CrossFeatureMessage {
    const grant = crossFeatureGrantSchema.parse(rawGrant);
    const request = crossFeatureRequestSchema.parse(rawRequest);
    if (
      grant.deadline <= this.now() ||
      grant.deadline > this.now() + communicationLimits.lifetimeMs ||
      grant.intentDigest !== crossFeatureIntentDigest(request) ||
      !this.authority.verify(grant, proof)
    )
      throw new Error('Cross-Feature authority denied');
    const admitted = this.journal.transaction((tx) => {
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
          .length >= communicationLimits.queuedPerPane
      )
        throw new Error('Cross-Feature queue capacity');
      const edges = all.map((m) => [m.grant.source.paneId, m.grant.target.paneId]);
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
        state: 'queued',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      tx.insertCross(message, this.audit(message, 'admitted'));
      return message;
    });
    this.admittedGrants.set(grant.grantId, proof);
    return admitted;
  }
  claim(messageId: string): CrossFeatureMessage | undefined {
    return this.journal.transaction((tx) => {
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
          tx.crossMessages().filter((m) => ['dispatching', 'outcome_unknown'].includes(m.state))
            .length +
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
            .some((m) => m.grant.target.paneId === target.paneId && m.state === 'dispatching')
        )
          return undefined;
      } catch {
        return undefined;
      }
      if (message.grant.deadline <= this.now()) return undefined;
      const claimed: CrossFeatureMessage = {
        ...message,
        state: 'dispatching',
        updatedAt: this.now(),
      };
      tx.updateCross(claimed, this.audit(claimed, 'dispatch_claimed'));
      return claimed;
    });
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
}
