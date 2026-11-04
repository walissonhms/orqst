import { basename } from 'node:path';
import {
  featureNativeRequestSchema,
  featureNativeSnapshotSchema,
  type FeatureNativeReply,
  type FeatureNativeSnapshot,
  type FeatureViewState,
  type WorkspaceFeature,
} from '@orqst/protocol';
import type { connectManagedTerminalCore } from './managed-terminal-core.js';
import { featureLayout } from './feature-layout.js';
import type { TauriTerminalLayout } from './tauri-terminal-layout.js';
import type { terminalLayoutStore } from './terminal-layout-store.js';

/** Private metadata/view facade. The existing Core still owns all processes and SQLite. */
export class TauriFeatureService {
  private busy = false;
  private generation = 0;
  private catalog: WorkspaceFeature[] = [];
  private view!: FeatureViewState;
  private membership = '';
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
  ) {}

  async initialize(): Promise<void> {
    await this.refresh(false);
    this.initialized = true;
  }

  private async refresh(open?: boolean): Promise<void> {
    const resume = open ?? !this.layout.snapshot().suspended;
    const catalog = await this.core.features.list();
    const view = await this.core.features.readView();
    const assigned = catalog.flatMap((feature) => feature.terminalIds);
    const feature = catalog.find((entry) => entry.featureId === view.featureId);
    if (view.featureId !== null && !feature) throw new Error('Feature view unavailable');
    const members =
      feature?.terminalIds ??
      this.core.identities.map((i) => i.terminalId).filter((id) => !assigned.includes(id));
    const membership = JSON.stringify([view.featureId, members]);
    if (membership !== this.membership || open) {
      await this.layout.flush();
      await this.revoke();
      const ids = this.core.identities.map((identity) => identity.terminalId);
      if (feature) {
        const mapping = featureLayout(
          ids,
          members,
          await this.core.features.readLayout(feature.featureId),
        );
        this.layout.context(
          mapping.initial,
          async (state) => {
            await this.core.features.saveLayout(feature.featureId, mapping.record(state));
          },
          resume,
        );
      } else {
        // Legacy preferences are never imported into a Feature. Partial unassigned views stay ephemeral.
        const initial = assigned.length ? undefined : await this.legacy.load();
        const mapping = featureLayout(ids, members, null);
        this.layout.context(
          initial ?? mapping.initial,
          assigned.length ? () => {} : this.legacy.save,
          resume,
        );
      }
      this.membership = membership;
    }
    this.catalog = catalog;
    this.view = view;
  }

  private snapshot(): FeatureNativeSnapshot {
    const value = featureNativeSnapshotSchema.parse({
      contractVersion: 1,
      storage: 'core',
      generation: this.generation,
      workspace: { id: this.view.workspaceId, name: basename(this.project) || this.project },
      features: this.catalog,
      view: this.view,
      slots: this.core.identities.map(({ slot, terminalId, provider }) => ({
        slot,
        terminalId,
        provider,
      })),
      layoutSaved:
        this.layout.snapshot().persisted &&
        (this.view.featureId !== null ||
          !this.catalog.some((feature) => feature.terminalIds.length > 0)),
    });
    if (Buffer.byteLength(JSON.stringify(value)) > 96 * 1024)
      throw new Error('Feature snapshot capacity exceeded');
    return value;
  }

  async request(raw: unknown): Promise<FeatureNativeReply> {
    const parsed = featureNativeRequestSchema.safeParse(raw);
    if (!parsed.success) return { status: 'denied' };
    if (!this.initialized) return { status: 'unavailable' };
    if (this.busy) return { status: 'busy' };
    this.busy = true;
    const request = parsed.data;
    try {
      await this.refresh();
      if (request.action !== 'snapshot' && request.generation !== this.generation)
        return { status: 'stale', snapshot: this.snapshot() };
      switch (request.action) {
        case 'snapshot':
          break;
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
          break;
        }
        case 'select': {
          const presentation = this.layout.presentationRevision();
          if (request.expectedRevision !== this.view.revision)
            return { status: 'stale', snapshot: this.snapshot() };
          if (
            request.featureId !== null &&
            !this.catalog.some((feature) => feature.featureId === request.featureId)
          )
            return { status: 'denied' };
          await this.revoke();
          await this.layout.flush();
          await this.core.features.saveView({
            featureId: request.featureId,
            expectedRevision: request.expectedRevision,
          });
          await this.refresh(presentation === this.layout.presentationRevision());
          this.generation++;
          break;
        }
        case 'organize': {
          await this.revoke();
          const state = this.layout.snapshot();
          if (state.active < 0) return { status: 'denied' };
          if (!state.visible.includes(state.active)) this.layout.open(state.active);
          const action = request.command.startsWith('columns-')
            ? { columns: Number(request.command.slice(-1)) }
            : request.command;
          if (!this.layout.act(state.active, action)) return { status: 'denied' };
          await this.layout.flush();
          this.generation++;
          break;
        }
      }
      await this.refresh();
      const snapshot = this.snapshot();
      this.changed(snapshot);
      return { status: 'ok', snapshot };
    } catch {
      // No automatic retry of a metadata command whose commit may have succeeded.
      return { status: 'unavailable' };
    } finally {
      this.busy = false;
    }
  }
}
