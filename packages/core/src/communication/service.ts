import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  communicationContentSchema,
  communicationLimits,
  communicationPaneSchema,
  paneProviderEvidenceSchema,
  paneSendSchema,
  paneRoutingUpdateSchema,
  type CommunicationAudit,
  type CommunicationContent,
  type CommunicationJournal,
  type CommunicationMessage,
  type CommunicationPane,
  type CommunicationTransaction,
  type PaneProviderEvidence,
  type PaneSend,
  type PaneRoutingUpdate,
} from '@orqst/protocol';
import { mentionedHandles } from './mentions.js';
import { featurePermissionRevision, type FeaturePermissionReader } from './feature-permissions.js';

const grantSchema = z.strictObject({
  actorId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  workspaceId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  featureId: z.uuid().optional(),
  sourcePaneId: z.uuid(),
  targetPaneIds: z.array(z.uuid()).min(1).max(32),
  expiresAt: z.number().int().nonnegative().safe(),
});
type GrantInput = z.infer<typeof grantSchema>;
interface Grant extends GrantInput {
  id: string;
  revoked: boolean;
  policyRevision: number | null;
}
export interface CommunicationClient {
  send(request: unknown): CommunicationMessage;
  status(messageId: string): CommunicationMessage;
  inbox(): CommunicationMessage[];
  events(after: number): CommunicationAudit[];
  cancelQueued(messageId: string): CommunicationMessage;
  subscribe(listener: (message: CommunicationMessage) => void): () => void;
}
/** Trusted structured transport only. There is deliberately no PTY write/input interface. */
export interface CommunicationAdapter {
  ready(pane: Readonly<CommunicationPane>): boolean;
  submit(
    message: Readonly<CommunicationMessage>,
    content: Uint8Array,
    evidence: (event: PaneProviderEvidence) => void,
  ): Promise<void>;
}
export interface CommunicationContentScope {
  workspaceId: string;
  featureId?: string;
  actorId: string;
  sourcePaneId: string;
  targetPaneId: string;
  purpose: 'request' | 'result';
}
/** Trusted local resolver must authorize this exact scope; no generic file/URL resolver. */
export type CommunicationResolver = (
  scope: Readonly<CommunicationContentScope>,
  contentId: string,
) => Uint8Array;
const crossActive = (state: string) =>
  [
    'dispatching',
    'accepted',
    'delivered',
    'running',
    'waiting_approval',
    'outcome_unknown',
  ].includes(state);
const terminalTask = (message: CommunicationMessage) =>
  ['completed', 'failed', 'cancelled', 'outcome_unknown'].includes(message.taskState);
const active = (message: CommunicationMessage) =>
  ['dispatching', 'accepted', 'delivered', 'delivery_unknown'].includes(message.deliveryState) &&
  !['completed', 'failed', 'cancelled'].includes(message.taskState);

/** Optional trusted cross-Feature ancestor reader; never configured by production composition. */
export type CrossParentGate = (
  tx: CommunicationTransaction,
  taskId: string,
  expected: { workspaceId: string; featureId: string; targetPaneId: string; correlationId: string },
) => { sourcePaneId: string; sourceFeatureId: string; parentTaskId: string | null } | undefined;

/** Trusted opt-in Core service. Never constructed by observer startup. */
export class PaneCommunication {
  private grants = new Map<string, Grant>();
  private clients = new WeakMap<CommunicationClient, Grant>();
  private adapters = new Map<string, CommunicationAdapter>();
  private listeners = new Map<Grant, Set<(message: CommunicationMessage) => void>>();

  constructor(
    private journal: CommunicationJournal,
    private resolve: CommunicationResolver,
    private now: () => number = Date.now,
    private readFeaturePermissions?: FeaturePermissionReader,
    private readonly crossParent?: CrossParentGate,
  ) {}

  /** Trusted composition only: enrollment must prove ownership; captured provider text cannot call this. */
  registerPane(
    input: Omit<
      CommunicationPane,
      'schemaVersion' | 'paneId' | 'displayId' | 'createdAt' | 'routing'
    > & {
      routing?: CommunicationPane['routing'];
    },
    adapter?: CommunicationAdapter,
  ): CommunicationPane {
    const pane = this.journal.transaction((tx) => {
      const panes = tx.panes();
      const value = communicationPaneSchema.parse({
        ...input,
        schemaVersion: 1,
        paneId: randomUUID(),
        displayId: `T-${String(panes.filter((p) => p.workspaceId === input.workspaceId).length + 1).padStart(3, '0')}`,
        createdAt: this.now(),
      });
      if (
        value.ownership === 'external' &&
        (value.binding || Object.values(value.capabilities).some(Boolean) || adapter)
      )
        throw new Error('External panes are read-only');
      if (value.terminalId && value.ownership !== 'managed')
        throw new Error('Stable terminal identity requires managed ownership');
      if (
        value.terminalId &&
        panes.some((pane) => pane.terminalId === value.terminalId && pane.state !== 'closed')
      )
        throw new Error('Stable terminal identity already registered');
      if (value.ownership === 'managed' && !value.binding)
        throw new Error('Managed ownership binding required');
      if (value.binding && panes.some((p) => p.binding?.instanceId === value.binding?.instanceId))
        throw new Error('Instance already registered');
      if (
        value.routing &&
        (value.ownership !== 'managed' || value.routing.allowedTargetPaneIds.length)
      )
        throw new Error('Routing enrollment requires managed ownership and an empty matrix');
      tx.savePane(value);
      this.audit(tx, value, 'pane_registered');
      return value;
    });
    if (adapter) this.adapters.set(pane.paneId, adapter);
    return pane;
  }

  /** Re-enrollment needs independent native proof of the exact existing live binding. No adoption or new instance. */
  enrollAdapter(
    paneId: string,
    binding: NonNullable<CommunicationPane['binding']>,
    adapter: CommunicationAdapter,
  ): void {
    this.journal.transaction((tx) => {
      const pane = this.pane(tx, paneId);
      if (
        pane.ownership !== 'managed' ||
        pane.state === 'closed' ||
        JSON.stringify(binding) !== JSON.stringify(pane.binding)
      )
        throw new Error('Adapter ownership binding denied');
    });
    this.adapters.set(paneId, adapter);
  }

  renamePane(paneId: string, name: string): CommunicationPane {
    return this.journal.transaction((tx) => {
      const pane = this.pane(tx, paneId);
      const updated = communicationPaneSchema.parse({ ...pane, name });
      tx.savePane(updated);
      this.audit(tx, pane, 'pane_renamed');
      return updated;
    });
  }

  /** Trusted host only. Roles are descriptive; permission edits do not issue task grants. */
  configureRouting(paneId: string, input: PaneRoutingUpdate): CommunicationPane {
    const { name, ...routing } = paneRoutingUpdateSchema.parse(input);
    return this.journal.transaction((tx) => {
      const pane = this.pane(tx, paneId);
      if (!pane.routing || pane.ownership !== 'managed' || pane.state === 'closed')
        throw new Error('Routed managed pane required');
      const panes = tx.panes();
      for (const id of routing.allowedTargetPaneIds) {
        const target = this.pane(tx, id);
        if (
          id === paneId ||
          target.workspaceId !== pane.workspaceId ||
          target.featureId !== pane.featureId ||
          target.ownership !== 'managed' ||
          !target.routing ||
          target.state === 'closed'
        )
          throw new Error('Routing target denied');
      }
      if (new Set(routing.allowedTargetPaneIds).size !== routing.allowedTargetPaneIds.length)
        throw new Error('Duplicate routing target');
      const visiting = new Set<string>();
      const visited = new Set<string>();
      const visit = (id: string) => {
        if (visiting.has(id)) throw new Error('Routing cycle denied');
        if (visited.has(id)) return;
        visiting.add(id);
        const targets =
          id === paneId
            ? routing.allowedTargetPaneIds
            : (panes.find((p) => p.paneId === id)?.routing?.allowedTargetPaneIds ?? []);
        targets.forEach(visit);
        visiting.delete(id);
        visited.add(id);
      };
      visit(paneId);
      const updated = communicationPaneSchema.parse({ ...pane, name, routing });
      tx.savePane(updated);
      this.audit(tx, pane, 'pane_routing_changed');
      return updated;
    });
  }

  resolveMention(workspaceId: string, text: string, featureId?: string): CommunicationPane {
    if (featureId !== undefined) z.uuid().parse(featureId);
    const handles = mentionedHandles(z.string().min(1).max(2048).parse(text));
    if (handles.length !== 1) throw new Error('Exactly one explicit mention required');
    return this.journal.transaction((tx) => {
      const pane = tx
        .panes()
        .find(
          (p) =>
            p.workspaceId === workspaceId &&
            p.featureId === featureId &&
            p.routing?.handle === handles[0],
        );
      if (!pane || pane.ownership !== 'managed' || pane.state === 'closed')
        throw new Error('Mention target unavailable');
      return pane;
    });
  }

  /** A host-confirmed state only. Hiding/detaching a UI never calls this operation. */
  setPaneState(paneId: string, state: CommunicationPane['state']): void {
    const changed = this.journal.transaction((tx) => {
      const pane = this.pane(tx, paneId);
      if (pane.state === 'closed') throw new Error('Closed pane identity cannot be reused');
      tx.savePane(communicationPaneSchema.parse({ ...pane, state }));
      this.audit(tx, pane, 'pane_state');
      if (!['closed', 'unavailable'].includes(state)) return [];
      return tx
        .messages()
        .filter((m) => m.targetPaneId === paneId && !terminalTask(m))
        .map((m) => {
          if (m.deliveryState === 'queued') {
            // Unavailable after restart waits for explicit enrollment; only confirmed closure fails queued work.
            if (state !== 'closed') return m;
            return this.save(tx, m, {
              deliveryState: 'target_closed',
              taskState: 'failed',
              reason: 'target_closed',
            });
          }
          return this.save(tx, m, {
            deliveryState: m.deliveryState === 'dispatching' ? 'delivery_unknown' : m.deliveryState,
            taskState: 'outcome_unknown',
            reason: state === 'closed' ? 'target_closed' : 'transport_uncertain',
          });
        });
    });
    changed.forEach((m) => this.notify(m));
  }

  /** Native/trusted enrollment entry point, never an API accepting agent-supplied grant claims. */
  authorize(input: GrantInput): CommunicationClient {
    const parsed = grantSchema.parse(input);
    if (
      parsed.expiresAt <= this.now() ||
      parsed.expiresAt > this.now() + communicationLimits.lifetimeMs
    )
      throw new Error('Grant expiry outside policy');
    const grant: Grant = { ...parsed, id: randomUUID(), revoked: false, policyRevision: null };
    this.operation(grant, (tx) => {
      for (const paneId of [parsed.sourcePaneId, ...parsed.targetPaneIds]) {
        const pane = this.pane(tx, paneId);
        if (
          pane.workspaceId !== parsed.workspaceId ||
          pane.featureId !== parsed.featureId ||
          pane.ownership !== 'managed' ||
          pane.state === 'closed'
        )
          throw new Error('Grant scope denied');
      }
      const source = this.pane(tx, parsed.sourcePaneId);
      if (
        source.routing &&
        parsed.targetPaneIds.some((id) => !source.routing!.allowedTargetPaneIds.includes(id))
      )
        throw new Error('Routing permission denied');
      for (const id of parsed.targetPaneIds) {
        const revision = this.policy(source, this.pane(tx, id), ['delegate', 'execute']);
        if (grant.policyRevision !== null && grant.policyRevision !== revision)
          throw new Error('Feature permission revision changed');
        grant.policyRevision = revision;
      }
    });
    this.grants.set(grant.id, grant);
    const client: CommunicationClient = {
      send: (request) =>
        this.operation(grant, (tx) => this.admit(tx, grant, paneSendSchema.parse(request))),
      status: (id) => this.operation(grant, (tx) => this.visible(tx, grant, id)),
      inbox: () =>
        this.operation(grant, (tx) =>
          tx.messages().filter((m) => this.canRead(tx, grant, m) && terminalTask(m)),
        ),
      events: (after) =>
        this.operation(grant, (tx) =>
          tx
            .events(after, {
              workspaceId: grant.workspaceId,
              paneId: grant.sourcePaneId,
              actorId: grant.actorId,
            })
            .filter(
              (event) =>
                event.featureId === grant.featureId &&
                (event.messageId
                  ? tx
                      .messages()
                      .some((m) => m.messageId === event.messageId && this.canRead(tx, grant, m))
                  : grant.targetPaneIds.every((id) => this.permitted(tx, grant, id, ['view']))),
            ),
        ),
      cancelQueued: (id) => {
        const message = this.operation(grant, (tx) => {
          const m = this.visible(tx, grant, id);
          if (!this.pane(tx, grant.sourcePaneId).capabilities.canCancel)
            throw new Error('Queued cancellation capability unavailable');
          if (m.deliveryState !== 'queued' || m.taskState !== 'pending')
            throw new Error('Cancellation requires undispatched work');
          return this.save(tx, m, { taskState: 'cancelled', reason: 'cancelled_before_dispatch' });
        });
        this.notify(message);
        return message;
      },
      subscribe: (listener) => {
        this.operation(grant, () => undefined);
        const listeners = this.listeners.get(grant) ?? new Set();
        listeners.add(listener);
        this.listeners.set(grant, listeners);
        return () => listeners.delete(listener);
      },
    };
    this.clients.set(client, grant);
    return Object.freeze(client);
  }

  revoke(client: CommunicationClient): void {
    const grant = this.clients.get(client);
    if (grant) {
      grant.revoked = true;
      this.listeners.delete(grant);
    }
  }

  /** Recovery never restores grants. Explicit native authorization must choose individual queued messages. */
  reauthorize(client: CommunicationClient, messageId: string): void {
    const grant = this.clients.get(client);
    if (!grant) throw new Error('Unknown client');
    this.operation(grant, (tx) => {
      const m = this.visible(tx, grant, messageId);
      if (m.deliveryState !== 'queued' || m.taskState !== 'pending' || m.deadline <= this.now())
        throw new Error('Only undispatched live work can be reauthorized');
      this.save(tx, m, { grantId: grant.id, reason: 'reauthorized' });
    });
  }

  /** Exact IDs or unambiguous names, always workspace-scoped. Trusted host inspection only. */
  resolvePane(workspaceId: string, reference: string): CommunicationPane {
    return this.journal.transaction((tx) => {
      const panes = tx.panes().filter((p) => p.workspaceId === workspaceId);
      const exact = panes.find((p) => p.paneId === reference || p.displayId === reference);
      if (exact) return exact;
      const named = panes.filter((p) => p.name === reference);
      if (named.length !== 1) throw new Error('Pane reference missing or ambiguous');
      return named[0]!;
    });
  }

  /** One bounded dispatch; no timer, polling loop, retry, process creation or provider fallback. */
  async dispatchNext(targetPaneId: string): Promise<CommunicationMessage | undefined> {
    const claim = this.journal.transaction((tx) => {
      const pane = this.pane(tx, targetPaneId);
      const messages = tx.messages();
      const next = messages.find(
        (m) =>
          m.targetPaneId === pane.paneId &&
          m.deliveryState === 'queued' &&
          m.taskState === 'pending',
      );
      if (!next) return undefined;
      if (next.deadline <= this.now())
        return {
          message: this.save(tx, next, {
            deliveryState: 'delivery_failed',
            taskState: 'failed',
            reason: 'deadline',
          }),
        };
      const source = this.pane(tx, next.sourcePaneId);
      const grant = this.grants.get(next.grantId);
      const adapter = this.adapters.get(targetPaneId);
      if (
        source.featureId !== next.featureId ||
        pane.featureId !== next.featureId ||
        source.state === 'closed' ||
        source.ownership !== 'managed' ||
        !source.capabilities.canSend ||
        (source.routing !== null && !source.routing.allowedTargetPaneIds.includes(targetPaneId)) ||
        !grant ||
        !this.valid(grant) ||
        !this.matches(grant, next) ||
        !this.permitted(tx, grant, targetPaneId, ['delegate', 'execute']) ||
        pane.state !== 'ready' ||
        !adapter ||
        !pane.capabilities.canSend ||
        !pane.capabilities.canQueueWhileBusy ||
        !pane.capabilities.canAcknowledge ||
        !pane.capabilities.canReportTaskCompletion ||
        !adapter.ready(pane) ||
        messages.some((m) => m.targetPaneId === targetPaneId && active(m)) ||
        tx.crossUsage().some((m) => m.targetPaneId === targetPaneId && crossActive(m.state)) ||
        messages.filter(active).length +
          tx.crossUsage().filter((m) => crossActive(m.state)).length >=
          communicationLimits.activeTasks
      )
        return undefined;
      let content: Uint8Array;
      try {
        content = this.content({ ...next, purpose: 'request' }, next.payload);
      } catch {
        return {
          message: this.save(tx, next, {
            deliveryState: 'delivery_failed',
            taskState: 'failed',
            reason: 'payload_unavailable',
          }),
        };
      }
      if (!this.permitted(tx, grant, targetPaneId, ['delegate', 'execute'])) return undefined;
      return {
        message: this.save(tx, next, {
          attemptId: randomUUID(),
          deliveryState: 'dispatching',
          reason: 'dispatch',
        }),
        adapter,
        content,
      };
    });
    if (!claim) return undefined;
    this.notify(claim.message);
    if (!claim.adapter || !claim.content) return claim.message;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        claim.adapter.submit(structuredClone(claim.message), claim.content, (evidence) =>
          this.evidence(claim.message, evidence),
        ),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Structured dispatch timed out')),
            communicationLimits.dispatchMs,
          );
        }),
      ]);
      const missingAcceptance = this.journal.transaction((tx) =>
        tx
          .messages()
          .some(
            (m) => m.messageId === claim.message.messageId && m.deliveryState === 'dispatching',
          ),
      );
      if (missingAcceptance) this.uncertain(claim.message.messageId);
    } catch {
      // The provider may have acted before throwing or timing out. Never retry from this exception.
      this.uncertain(claim.message.messageId);
    } finally {
      if (timer) clearTimeout(timer);
    }
    return this.journal.transaction((tx) =>
      tx.messages().find((m) => m.messageId === claim.message.messageId),
    );
  }

  private evidence(claim: CommunicationMessage, raw: PaneProviderEvidence): void {
    const event = paneProviderEvidenceSchema.parse(raw);
    const updated = this.journal.transaction((tx) => {
      const m = tx.messages().find((message) => message.messageId === claim.messageId);
      const pane = this.pane(tx, claim.targetPaneId);
      if (
        !m ||
        terminalTask(m) ||
        !pane.binding ||
        ['closed', 'unavailable'].includes(pane.state) ||
        event.messageId !== m.messageId ||
        event.taskId !== m.taskId ||
        event.correlationId !== m.correlationId ||
        event.targetPaneId !== m.targetPaneId ||
        event.attemptId !== m.attemptId ||
        event.instanceId !== pane.binding.instanceId ||
        event.terminalEpoch !== pane.binding.terminalEpoch
      )
        throw new Error('Provider correlation or ownership denied');
      if (
        ['accepted', 'delivered'].includes(event.event)
          ? !pane.capabilities.canAcknowledge
          : !pane.capabilities.canReportTaskCompletion
      )
        throw new Error('Provider evidence capability unavailable');
      const patch: Partial<CommunicationMessage> = {
        evidenceId: event.evidenceId,
        reason: 'provider_evidence',
      };
      if (event.event === 'accepted') {
        if (m.deliveryState !== 'dispatching' || m.taskState !== 'pending')
          throw new Error('Invalid acceptance');
        patch.deliveryState = 'accepted';
      } else if (event.event === 'delivered') {
        if (m.deliveryState !== 'accepted') throw new Error('Receipt requires acceptance');
        patch.deliveryState = 'delivered';
      } else {
        if (!['accepted', 'delivered'].includes(m.deliveryState))
          throw new Error('Execution requires acceptance');
        if (event.event === 'started') {
          if (!['pending', 'waiting_approval'].includes(m.taskState))
            throw new Error('Invalid task start');
          patch.taskState = 'running';
        } else if (event.event === 'waiting_approval') {
          if (!['pending', 'running'].includes(m.taskState))
            throw new Error('Invalid approval transition');
          patch.taskState = 'waiting_approval';
        } else {
          if (m.taskState !== 'running') throw new Error('Task outcome requires start evidence');
          patch.taskState = event.event;
          if (event.result) {
            this.content({ ...m, purpose: 'result' }, event.result);
            patch.result = event.result;
          }
        }
      }
      return this.save(tx, m, patch);
    });
    this.notify(updated);
  }

  private uncertain(messageId: string): void {
    const changed = this.journal.transaction((tx) => {
      const m = tx.messages().find((message) => message.messageId === messageId);
      if (!m || terminalTask(m)) return undefined;
      return this.save(tx, m, {
        deliveryState: m.deliveryState === 'dispatching' ? 'delivery_unknown' : m.deliveryState,
        taskState: 'outcome_unknown',
        reason: 'transport_uncertain',
      });
    });
    if (changed) this.notify(changed);
  }

  private admit(
    tx: CommunicationTransaction,
    grant: Grant,
    request: PaneSend,
  ): CommunicationMessage {
    if (
      request.workspaceId !== grant.workspaceId ||
      request.featureId !== grant.featureId ||
      request.sourcePaneId !== grant.sourcePaneId ||
      !grant.targetPaneIds.includes(request.targetPaneId)
    )
      throw new Error('Sender or workspace denied');
    const source = this.pane(tx, request.sourcePaneId);
    const target = this.pane(tx, request.targetPaneId);
    if (
      source.workspaceId !== grant.workspaceId ||
      source.featureId !== grant.featureId ||
      target.featureId !== grant.featureId ||
      target.workspaceId !== grant.workspaceId ||
      source.state === 'closed' ||
      source.ownership !== 'managed' ||
      !source.capabilities.canSend ||
      (source.routing !== null && !source.routing.allowedTargetPaneIds.includes(target.paneId)) ||
      target.ownership !== 'managed' ||
      target.state === 'closed' ||
      !target.capabilities.canSend ||
      !target.capabilities.canQueueWhileBusy ||
      !target.capabilities.canAcknowledge ||
      !target.capabilities.canReportTaskCompletion
    )
      throw new Error('Pane ownership or structured capabilities unavailable');
    if (!this.permitted(tx, grant, target.paneId, ['delegate', 'execute']))
      throw new Error('Feature permission denied or revision changed');
    const messages = tx.messages();
    const crossUsage = tx.crossUsage();
    const duplicate = messages.find(
      (m) =>
        m.workspaceId === request.workspaceId &&
        m.targetPaneId === request.targetPaneId &&
        m.idempotencyKey === request.idempotencyKey,
    );
    if (duplicate) {
      // A key collision cannot silently replace task/content/authority or reveal another sender's message.
      const logical = (value: PaneSend) => JSON.stringify({ ...value, messageId: undefined });
      const original = paneSendSchema.parse(
        Object.fromEntries(
          Object.keys(paneSendSchema.shape).map((key) => [
            key,
            duplicate[key as keyof CommunicationMessage],
          ]),
        ),
      );
      if (!this.canRead(tx, grant, duplicate) || logical(original) !== logical(request))
        throw new Error('Idempotency conflict');
      return duplicate;
    }
    if (messages.length + crossUsage.length >= communicationLimits.messages)
      throw new Error('Message history capacity');
    if (messages.some((m) => m.messageId === request.messageId || m.taskId === request.taskId))
      throw new Error('Message or task identity already used');
    if (
      request.deadline <= this.now() ||
      request.deadline > Math.min(grant.expiresAt, this.now() + communicationLimits.lifetimeMs)
    )
      throw new Error('Deadline outside grant');
    if (
      messages.filter(
        (m) =>
          m.targetPaneId === request.targetPaneId &&
          m.deliveryState === 'queued' &&
          m.taskState === 'pending',
      ).length +
        crossUsage.filter((m) => m.targetPaneId === request.targetPaneId && m.state === 'queued')
          .length >=
        communicationLimits.queuedPerPane ||
      messages.filter((m) => m.actorId === grant.actorId && m.createdAt > this.now() - 60000)
        .length +
        crossUsage.filter((m) => m.actorId === grant.actorId && m.createdAt > this.now() - 60000)
          .length >=
        communicationLimits.admissionsPerMinute
    )
      throw new Error('Queue or rate limit');
    const ancestry = [request.targetPaneId];
    let parent = request.parentTaskId;
    let expectedSource = request.sourcePaneId;
    let expectedFeature = grant.featureId;
    let depth = 0;
    while (parent) {
      const previous = messages.find((m) => m.taskId === parent);
      if (previous) {
        if (
          previous.workspaceId !== grant.workspaceId ||
          previous.featureId !== expectedFeature ||
          previous.correlationId !== request.correlationId ||
          previous.targetPaneId !== expectedSource ||
          terminalTask(previous)
        )
          throw new Error('Delegation parent denied');
        ancestry.push(expectedSource);
        expectedSource = previous.sourcePaneId;
        parent = previous.parentTaskId;
      } else {
        if (!this.crossParent || !expectedFeature) throw new Error('Delegation parent denied');
        const cross = this.crossParent(tx, parent, {
          workspaceId: grant.workspaceId,
          featureId: expectedFeature,
          targetPaneId: expectedSource,
          correlationId: request.correlationId,
        });
        if (!cross) throw new Error('Delegation parent denied');
        ancestry.push(expectedSource);
        expectedSource = cross.sourcePaneId;
        expectedFeature = cross.sourceFeatureId;
        parent = cross.parentTaskId;
      }
      if (++depth > communicationLimits.maxDepth) throw new Error('Delegation depth exceeded');
    }
    ancestry.push(expectedSource);
    if (new Set(ancestry).size !== ancestry.length) throw new Error('Delegation cycle');
    this.content({ ...request, actorId: grant.actorId, purpose: 'request' }, request.payload);
    const message: CommunicationMessage = {
      ...request,
      actorId: grant.actorId,
      grantId: grant.id,
      depth,
      deliveryState: 'queued',
      taskState: 'pending',
      createdAt: this.now(),
      updatedAt: this.now(),
      attemptId: null,
      result: null,
      evidenceId: null,
      reason: 'admitted',
    };
    tx.saveMessage(message);
    this.audit(tx, source, 'admitted', message);
    return message;
  }

  private content(scope: CommunicationContentScope, input: CommunicationContent): Uint8Array {
    const ref = communicationContentSchema.parse(input);
    const bytes = this.resolve(
      Object.freeze({
        workspaceId: scope.workspaceId,
        actorId: scope.actorId,
        sourcePaneId: scope.sourcePaneId,
        targetPaneId: scope.targetPaneId,
        purpose: scope.purpose,
      }),
      ref.id,
    );
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength !== ref.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== ref.sha256
    )
      throw new Error('Content identity unavailable');
    return Uint8Array.from(bytes);
  }
  private valid(grant: Grant): boolean {
    return !grant.revoked && grant.expiresAt > this.now();
  }
  private matches(grant: Grant, m: CommunicationMessage): boolean {
    return (
      m.workspaceId === grant.workspaceId &&
      m.featureId === grant.featureId &&
      m.sourcePaneId === grant.sourcePaneId &&
      m.actorId === grant.actorId &&
      grant.targetPaneIds.includes(m.targetPaneId)
    );
  }
  /** Trusted root-plan gate; revision must also be bound to its native signed digest. */
  delegationRevision(sourcePaneId: string, targetPaneId: string): number | null {
    return this.journal.transaction((tx) => {
      const source = this.pane(tx, sourcePaneId);
      const target = this.pane(tx, targetPaneId);
      if (
        source.paneId === target.paneId ||
        source.ownership !== 'managed' ||
        target.ownership !== 'managed' ||
        source.state !== 'ready' ||
        target.state !== 'ready' ||
        !source.binding ||
        !target.binding ||
        !source.capabilities.canSend ||
        !target.capabilities.canSend ||
        !target.capabilities.canQueueWhileBusy ||
        !target.capabilities.canAcknowledge ||
        !target.capabilities.canReportTaskCompletion ||
        (source.routing && !source.routing.allowedTargetPaneIds.includes(target.paneId))
      )
        throw new Error('Routing or ownership permission denied');
      return this.policy(source, target, ['delegate', 'execute']);
    });
  }
  private policy(
    source: CommunicationPane,
    target: CommunicationPane,
    operations: readonly import('@orqst/protocol').FeaturePermissionOperation[],
  ) {
    return featurePermissionRevision(source, target, operations, this.readFeaturePermissions);
  }
  private permitted(
    tx: CommunicationTransaction,
    grant: Grant,
    targetPaneId: string,
    operations: readonly import('@orqst/protocol').FeaturePermissionOperation[],
  ): boolean {
    try {
      const source = this.pane(tx, grant.sourcePaneId);
      const target = this.pane(tx, targetPaneId);
      return (
        source.workspaceId === grant.workspaceId &&
        target.workspaceId === grant.workspaceId &&
        source.featureId === grant.featureId &&
        target.featureId === grant.featureId &&
        grant.targetPaneIds.includes(targetPaneId) &&
        this.policy(source, target, operations) === grant.policyRevision
      );
    } catch {
      return false;
    }
  }
  private canRead(tx: CommunicationTransaction, grant: Grant, m: CommunicationMessage): boolean {
    return this.matches(grant, m) && this.permitted(tx, grant, m.targetPaneId, ['view']);
  }
  private visible(tx: CommunicationTransaction, grant: Grant, id: string): CommunicationMessage {
    const message = tx.messages().find((m) => m.messageId === id);
    if (!message || !this.canRead(tx, grant, message)) throw new Error('Message unavailable');
    return message;
  }
  private pane(tx: CommunicationTransaction, id: string): CommunicationPane {
    const pane = tx.panes().find((p) => p.paneId === id);
    if (!pane) throw new Error('Pane unavailable');
    return pane;
  }
  private operation<T>(grant: Grant, action: (tx: CommunicationTransaction) => T): T {
    const result = this.journal.transaction((tx) => {
      try {
        if (!this.valid(grant)) throw new Error('Grant expired or revoked');
        return { ok: true as const, value: action(tx) };
      } catch (error) {
        this.audit(
          tx,
          {
            workspaceId: grant.workspaceId,
            paneId: grant.sourcePaneId,
            featureId: grant.featureId,
          },
          'denied',
          undefined,
          grant.actorId,
        );
        return { ok: false as const, error };
      }
    });
    if (!result.ok) throw result.error;
    return result.value;
  }
  private save(
    tx: CommunicationTransaction,
    m: CommunicationMessage,
    patch: Partial<CommunicationMessage>,
  ): CommunicationMessage {
    const updated = { ...m, ...patch, updatedAt: Math.max(this.now(), m.updatedAt) };
    tx.saveMessage(updated);
    this.audit(
      tx,
      { workspaceId: m.workspaceId, paneId: m.sourcePaneId, featureId: m.featureId },
      'state_changed',
      updated,
    );
    return updated;
  }
  private audit(
    tx: CommunicationTransaction,
    pane: Pick<CommunicationPane, 'paneId' | 'workspaceId' | 'featureId'>,
    action: CommunicationAudit['action'],
    message?: CommunicationMessage,
    actorId?: string,
  ): void {
    tx.audit({
      timestamp: this.now(),
      actorId: message?.actorId ?? actorId ?? null,
      workspaceId: pane.workspaceId,
      ...(pane.featureId === undefined ? {} : { featureId: pane.featureId }),
      paneId: pane.paneId,
      messageId: message?.messageId ?? null,
      action,
      deliveryState: message?.deliveryState ?? null,
      taskState: message?.taskState ?? null,
    });
  }
  private readable(grant: Grant, message: CommunicationMessage): boolean {
    try {
      return this.journal.transaction((tx) => this.canRead(tx, grant, message));
    } catch {
      return false;
    }
  }
  private notify(message: CommunicationMessage): void {
    // Post-commit only; a subscriber cannot roll back delivery evidence or receive after revocation.
    for (const [grant, listeners] of this.listeners)
      if (this.valid(grant) && this.readable(grant, message))
        for (const listener of listeners)
          queueMicrotask(() => {
            if (!this.valid(grant) || !listeners.has(listener)) return;
            try {
              if (this.readable(grant, message)) listener(structuredClone(message));
            } catch {
              /* Client failure does not alter durable facts. */
            }
          });
  }
}
