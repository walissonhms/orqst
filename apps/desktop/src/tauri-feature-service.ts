import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  featureNativeRequestSchema,
  featurePermissionNativeRequestSchema,
  featureNativeSnapshotSchema,
  type FeatureNativeReply,
  type FeatureNativeSnapshot,
  type FeatureViewState,
  type WorkspaceFeature,
} from '@orqst/protocol';
import type { connectManagedTerminalCore } from './managed-terminal-core.js';
import { FeaturePermissionUnavailable, FeatureRevisionConflict } from './managed-terminal-core.js';
import { featureLayout } from './feature-layout.js';
import type { TauriTerminalLayout } from './tauri-terminal-layout.js';
import type { terminalLayoutStore } from './terminal-layout-store.js';

/** Private metadata/view facade. The existing Core still owns all processes and SQLite. */
export class TauriFeatureService {
  private busy = false;
  private generation = 0;
  private catalog: WorkspaceFeature[] = [];
  private view!: FeatureViewState;
  private activeFeatureId: string | null = null;
  private initialized = false;

  constructor(
    private readonly core: Pick<
      Awaited<ReturnType<typeof connectManagedTerminalCore>>,
      'features' | 'identities'
    >,
    private readonly layout: TauriTerminalLayout,
    private readonly legacy: ReturnType<typeof terminalLayoutStore>,
    private readonly project: string,
    private readonly revoke: () => Promise<void>,
    private readonly changed: (snapshot: FeatureNativeSnapshot) => void,
    private readonly selectedModel: (slot: number) => string | null | undefined = () => undefined,
  ) {}

  async initialize(): Promise<void> {
    await this.refresh();
    await this.present(this.view.featureId, false, this.layout.presentationRevision());
    this.initialized = true;
  }

  private async refresh(): Promise<void> {
    const catalog = await this.core.features.list();
    const view = await this.core.features.readView();
    if (view.featureId !== null && !catalog.some((feature) => feature.featureId === view.featureId))
      throw new Error('Feature preference unavailable');
    this.catalog = catalog;
    this.view = view;
  }

  private async present(
    featureId: string | null,
    open: boolean,
    presentation: number,
    canvas = false,
  ): Promise<void> {
    const feature = this.catalog.find((entry) => entry.featureId === featureId);
    if (featureId !== null && !feature) throw new Error('Feature view unavailable');
    const assigned = this.catalog.flatMap((entry) => entry.terminalIds);
    const ids = this.core.identities.map((identity) => identity.terminalId);
    const members = feature?.terminalIds ?? ids.filter((id) => !assigned.includes(id));
    await this.layout.flush();
    await this.revoke();
    if (feature) {
      const mapping = featureLayout(
        ids,
        members,
        await this.core.features.readLayout(feature.featureId),
      );
      // Native navigation/quit can invalidate a command while SQLite/readLayout is in flight.
      // Its committed preference stays honest; the obsolete command cannot alter this view.
      if (presentation !== this.layout.presentationRevision())
        throw new Error('Stale presentation');
      this.layout.context(
        mapping.initial,
        async (state) => {
          await this.core.features.saveLayout(feature.featureId, mapping.record(state));
        },
        open,
        canvas,
      );
    } else {
      // Legacy preferences are never imported into a Feature. Partial unassigned views stay ephemeral.
      const initial = assigned.length ? undefined : await this.legacy.load();
      const mapping = featureLayout(ids, members, null);
      if (presentation !== this.layout.presentationRevision())
        throw new Error('Stale presentation');
      this.layout.context(
        initial ?? mapping.initial,
        assigned.length ? () => {} : this.legacy.save,
        open,
        canvas,
      );
    }
    this.activeFeatureId = featureId;
  }

  /** Refresh the retained view after native creation, fenced by the original presentation. */
  async enrolled(slot: number, presentation: number): Promise<boolean> {
    if (this.busy || !this.initialized) return false;
    this.busy = true;
    try {
      await this.refresh();
      await this.present(this.activeFeatureId, !this.layout.snapshot().suspended, presentation);
      if (presentation + 1 !== this.layout.presentationRevision()) return false;
      this.generation++;
      this.changed(this.snapshot());
      return this.layout.open(slot);
    } catch {
      return false;
    } finally {
      this.busy = false;
    }
  }

  private snapshot(): FeatureNativeSnapshot {
    const value = featureNativeSnapshotSchema.parse({
      contractVersion: 1,
      storage: 'core',
      generation: this.generation,
      workspace: { id: this.view.workspaceId, name: basename(this.project) || this.project },
      features: this.catalog,
      view: this.view,
      activeFeatureId: this.activeFeatureId,
      slots: this.core.identities.map(({ slot, terminalId, provider }) => {
        const selectedModel = this.selectedModel(slot);
        return {
          slot,
          terminalId,
          provider,
          ...(selectedModel === undefined ? {} : { selectedModel }),
        };
      }),
      layoutSaved:
        this.layout.snapshot().persisted &&
        (this.activeFeatureId !== null ||
          !this.catalog.some((feature) => feature.terminalIds.length > 0)),
    });
    if (Buffer.byteLength(JSON.stringify(value)) > 96 * 1024)
      throw new Error('Feature snapshot capacity exceeded');
    return value;
  }

  async request(raw: unknown, actorId?: string): Promise<FeatureNativeReply> {
    const parsed = featureNativeRequestSchema
      .or(featurePermissionNativeRequestSchema)
      .safeParse(raw);
    if (!parsed.success) return { status: 'denied' };
    if (!this.initialized) return { status: 'unavailable' };
    if (this.busy) return { status: 'busy' };
    this.busy = true;
    const request = parsed.data;
    const presentation = this.layout.presentationRevision();
    try {
      if (
        ['canvas', 'select', 'organize', 'pane', 'renamePane', 'movePane'].includes(request.action)
      )
        await this.revoke();
      await this.refresh();
      if (request.action !== 'snapshot' && request.generation !== this.generation)
        return { status: 'stale', snapshot: this.snapshot() };
      switch (request.action) {
        case 'snapshot':
          break;
        case 'canvas':
          if (presentation !== this.layout.presentationRevision())
            throw new Error('Stale presentation');
          this.layout.showCanvas();
          this.generation++;
          break;
        case 'arrange': {
          if (presentation !== this.layout.presentationRevision()) return { status: 'stale' };
          const state = this.layout.snapshot();
          if (
            request.panes.length !== state.order.length ||
            request.panes.some(
              (pane) =>
                !state.order.includes(pane.slot) ||
                this.core.identities[pane.slot]?.terminalId !== pane.terminalId,
            )
          )
            return { status: 'denied' };
          if (!this.layout.arrange(request)) return { status: 'denied' };
          break;
        }
        case 'create':
          await this.core.features.create(request.input);
          this.generation++;
          break;
        case 'update': {
          const feature = this.catalog.find((entry) => entry.featureId === request.featureId);
          if (!feature) return { status: 'denied' };
          if (feature.revision !== request.input.expectedRevision)
            return { status: 'stale', snapshot: this.snapshot() };
          if (request.input.status === 'archived' && feature.terminalIds.length)
            return { status: 'archive_blocked', snapshot: this.snapshot() };
          await this.core.features.update(request.featureId, request.input);
          this.generation++;
          break;
        }
        case 'assign': {
          const open = !this.layout.snapshot().suspended;
          if (!this.core.identities.some((identity) => identity.slot === request.slot))
            return { status: 'denied' };
          const feature = this.catalog.find((entry) => entry.featureId === request.featureId);
          if (!feature) return { status: 'denied' };
          if (feature.revision !== request.expectedRevision)
            return { status: 'stale', snapshot: this.snapshot() };
          await this.core.features.assign(
            request.featureId,
            request.slot,
            request.expectedRevision,
          );
          this.generation++;
          await this.refresh();
          if (this.activeFeatureId === request.featureId || this.activeFeatureId === null)
            await this.present(
              this.activeFeatureId,
              open,
              presentation,
              this.layout.snapshot().canvas === true,
            );
          break;
        }
        case 'select': {
          if (request.expectedRevision !== this.view.revision)
            return { status: 'stale', snapshot: this.snapshot() };
          if (
            request.featureId !== null &&
            !this.catalog.some((feature) => feature.featureId === request.featureId)
          )
            return { status: 'denied' };
          await this.layout.flush();
          await this.core.features.saveView({
            featureId: request.featureId,
            expectedRevision: request.expectedRevision,
          });
          this.generation++;
          await this.refresh();
          await this.present(request.featureId, true, presentation, true);
          break;
        }
        case 'readPermissions': {
          const permissions = await this.core.features.readPermissions(request.featureId);
          return { status: 'ok', permissions, snapshot: this.snapshot() };
        }
        case 'savePermissions': {
          if (!actorId || !/^native-[a-fA-F0-9-]{36}$/.test(actorId)) return { status: 'denied' };
          let plan: unknown;
          try {
            plan = JSON.parse(request.reviewPlan);
          } catch {
            return { status: 'denied' };
          }
          if (
            !plan ||
            typeof plan !== 'object' ||
            createHash('sha256').update(request.reviewPlan).digest('hex') !==
              request.reviewDigest ||
            Reflect.get(plan, 'featureId') !== request.featureId ||
            Reflect.get(plan, 'expectedRevision') !== request.expectedRevision ||
            Reflect.get(plan, 'expectedFeatureRevision') !== request.expectedFeatureRevision ||
            Reflect.get(plan, 'expectedViewRevision') !== request.expectedViewRevision ||
            !isDeepStrictEqual(Reflect.get(plan, 'snapshot'), this.snapshot()) ||
            Reflect.get(plan, 'generation') !== request.generation ||
            `native-${Reflect.get(plan, 'epoch')}` !== actorId ||
            JSON.stringify(Reflect.get(plan, 'configuration')) !==
              JSON.stringify(request.configuration) ||
            this.activeFeatureId !== request.featureId
          )
            return { status: 'denied' };
          let permissions;
          try {
            permissions = await this.core.features.savePermissions(request.featureId, actorId, {
              expectedRevision: request.expectedRevision,
              expectedFeatureRevision: request.expectedFeatureRevision,
              expectedViewRevision: request.expectedViewRevision,
              configuration: request.configuration,
              reviewDigest: request.reviewDigest,
            });
          } catch (error) {
            if (error instanceof FeatureRevisionConflict) return { status: 'stale' };
            if (error instanceof FeaturePermissionUnavailable) return { status: 'unavailable' };
            return { status: 'unknown' };
          }
          try {
            this.generation++;
            await this.refresh();
            return { status: 'ok', permissions, snapshot: this.snapshot() };
          } catch {
            return { status: 'unknown' };
          }
        }
        case 'pane':
        case 'renamePane':
        case 'movePane': {
          if (presentation !== this.layout.presentationRevision())
            throw new Error('Stale presentation');
          const state = this.layout.snapshot();
          if (
            this.core.identities[request.slot]?.terminalId !== request.terminalId ||
            !state.order.includes(request.slot)
          )
            return { status: 'denied' };
          if (
            request.action === 'movePane' &&
            (this.core.identities[request.beforeSlot]?.terminalId !== request.beforeTerminalId ||
              !state.order.includes(request.beforeSlot))
          )
            return { status: 'denied' };
          const action =
            request.action === 'renamePane'
              ? { name: request.name }
              : request.action === 'movePane'
                ? { moveTo: request.beforeSlot }
                : request.command;
          if (request.action === 'pane' && request.command === 'focus' && state.suspended)
            this.layout.showCanvas();
          if (!this.layout.workspaceAct(request.slot, action)) return { status: 'denied' };
          await this.layout.flush();
          this.generation++;
          break;
        }
        case 'organize': {
          if (presentation !== this.layout.presentationRevision())
            throw new Error('Stale presentation');
          const state = this.layout.snapshot();
          if (state.active < 0) return { status: 'denied' };
          const action = request.command.startsWith('columns-')
            ? { columns: Number(request.command.slice(-1)) }
            : request.command;
          if (!this.layout.workspaceAct(state.active, action)) return { status: 'denied' };
          await this.layout.flush();
          this.generation++;
          break;
        }
      }
      await this.refresh();
      const snapshot = this.snapshot();
      this.changed(snapshot);
      return { status: 'ok', snapshot };
    } catch (error) {
      if (error instanceof FeatureRevisionConflict) return { status: 'stale' };
      // No automatic retry of a metadata command whose commit may have succeeded.
      return { status: 'unavailable' };
    } finally {
      this.busy = false;
    }
  }
}
