import {
  kernelIdentityClient,
  kernelIdentityReplySchema,
  kernelLivenessClient,
  kernelLivenessReplySchema,
} from '../../../packages/core/src/terminal/kernel-channel.js';
import { TerminalCliPolicyStore } from '../../../packages/core/src/terminal/cli-authorization.js';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import {
  terminalStartupHostFailure,
  terminalStartupIdSchema,
} from '../../../packages/core/src/terminal/startup-failure.js';
import { join } from 'node:path';
import { createInstance } from 'i18next';
import { z } from 'zod';
import en from '../../dashboard/src/locales/en-US.json';
import pt from '../../dashboard/src/locales/pt-BR.json';
import { inspectManagedTerminalFiles } from '../../../packages/core/src/terminal/managed-files.js';
import {
  readInteractiveTerminalConfig,
  interactiveProvider,
} from '../../../packages/core/src/terminal/interactive-profile.js';
import { connectManagedTerminalCore } from './managed-terminal-core.js';
import { terminalDocument } from './terminal-document.js';
import { terminalLayoutStore } from './terminal-layout-store.js';
import { terminalEnrollmentFile } from '../../../packages/core/src/terminal/enrollment-files.js';
import { appendTerminalLayout } from './terminal-layout-enrollment.js';
import { TauriTerminalLayout } from './tauri-terminal-layout.js';
import { visualAllowedDuringFence } from './terminal-fence.js';
import {
  featureNativeReplySchema,
  featureNativeEnvelopeSchema,
  featurePermissionNativeEnvelopeSchema,
  terminalLayoutRecordSchema,
} from '@orqst/protocol';
import { TauriFeatureService } from './tauri-feature-service.js';
import { TauriTerminalService } from './tauri-terminal-service.js';

process.umask(0o077);
let activeCore: Awaited<ReturnType<typeof connectManagedTerminalCore>> | undefined;
// Correlation is supplied by the owned native parent; never an agent/renderer request.
const startupId = terminalStartupIdSchema.parse(process.argv[5] ?? randomUUID());
async function start() {
  if (
    process.platform !== 'darwin' ||
    process.arch !== 'arm64' ||
    process.getuid?.() === 0 ||
    !/^v24\./.test(process.version)
  )
    throw new Error('Unsupported managed terminal host');
  const files = z
    .array(z.string().min(1).max(2048))
    .min(1)
    .max(8)
    .parse(JSON.parse(process.argv[2]!));
  const directory = process.argv[3];
  const operationalOpen = process.argv[4] === 'true';
  if (!directory) throw new Error('Private native admission directory required');
  const selection = inspectManagedTerminalFiles(files, files.length);
  if (selection.some((p) => p.blocker)) throw new Error('Blocked terminal profile');
  const keys = generateKeyPairSync('ed25519');
  const nativeKernel = kernelIdentityClient((query) => send(query));
  const nativeLiveness = kernelLivenessClient((query) => send(query));
  const core = await connectManagedTerminalCore(
    files,
    join(__dirname, 'managed-terminal-core.cjs'),
    keys.publicKey,
    directory,
    8, // Native-owned capacity, fixed for this Core lifetime; never renderer supplied.
    startupId,
    nativeKernel.query,
    nativeLiveness.query,
  );
  const i18n = createInstance();
  activeCore = core;
  const language = process.env.LANG?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US';
  await i18n.init({
    lng: language,
    fallbackLng: 'en-US',
    resources: { 'en-US': { translation: en }, 'pt-BR': { translation: pt } },
  });
  const translate = (key: string) => String(i18n.t(key));
  let closed = false;
  let readySent = false;
  const send = (value: object) => {
    if (!readySent && 'kind' in value && value.kind === 'layout') return;
    const line = JSON.stringify(value) + '\n';
    // A slow native consumer must not create an unbounded output queue.
    if (Buffer.byteLength(line) > 512 * 1024 || process.stdout.writableLength > 1024 * 1024)
      return shutdown();
    process.stdout.write(line);
  };
  const mcpEnabled = !!selection[0]!.config.interactive?.mcp;
  const service = new TauriTerminalService(
    core.supervisors,
    keys,
    send,
    translate,
    mcpEnabled ? core : undefined,
    core,
    new TerminalCliPolicyStore(directory),
  );
  let store = terminalLayoutStore(
    directory,
    core.identities.map((identity) => identity.terminalId),
    core.layouts,
  );
  let initial;
  try {
    initial = await store.load();
  } catch {
    // Invalid private preferences never affect terminal admission or restore processes.
  }
  const layout = new TauriTerminalLayout(
    files.length,
    { initial, save: store.save },
    send,
    (slot) => {
      void service.receive({ kind: 'revoke', slot }).catch(shutdown);
    },
  );
  const features = new TauriFeatureService(
    core,
    layout,
    { load: () => store.load(), save: (state) => store.save(state) },
    selection[0]!.config.project,
    async () => {
      await Promise.all(
        core.identities.map((_, slot) => service.receive({ kind: 'revoke', slot })),
      );
    },
    () => {},
  );
  await features.initialize();
  const correlation = z.object({
    id: featureNativeEnvelopeSchema.shape.id,
    document: featureNativeEnvelopeSchema.shape.document,
  });
  function shutdown() {
    if (closed) return;
    closed = true;
    service.close();
    nativeKernel.close();
    nativeLiveness.close();
    process.stdin.destroy();
    void core.closeAndWait().catch(() => {
      process.exitCode = 1;
    });
  }
  const visualMessageSchema = z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('layout-action'),
      slot: z.number().int().min(0).max(7),
      action: z.unknown(),
      generation: z.number().int().nonnegative().safe().optional(),
    }),
    z.strictObject({ kind: z.literal('layout-suspend') }),
    z.strictObject({
      kind: z.literal('layout-generation'),
      generation: z.number().int().nonnegative().safe(),
    }),
    z.strictObject({
      kind: z.literal('layout-focus'),
      slot: z.number().int().min(0).max(7),
    }),
    z.strictObject({
      kind: z.literal('layout-open'),
      slot: z.number().int().min(0).max(7),
    }),
    z.strictObject({
      kind: z.literal('layout-resize'),
      width: z.number().int().min(1).max(32768),
      height: z.number().int().min(1).max(32768),
    }),
  ]);

  let nativeGeneration = 0;
  let enrollmentBusy = false;
  const enrollmentOperations = new Set<string>();
  const presentations = new Map<
    string,
    { slot: number; generation: number; presentation: number }
  >();
  const enrollmentMessage = z.strictObject({
    kind: z.literal('enroll'),
    id: z.uuid(),
    epoch: z.uuid(),
    generation: z.number().int().nonnegative().safe(),
    manifestFile: z.string().min(1).max(2048),
    previousLayout: terminalLayoutRecordSchema.nullable(),
  });
  const enrollmentPresent = z.strictObject({
    kind: z.literal('enrollment-present'),
    id: z.uuid(),
    generation: z.number().int().nonnegative().safe(),
  });
  const paneDocument = (config: ReturnType<typeof readInteractiveTerminalConfig>, slot: number) => {
    const providers = selection.map(({ config }) =>
      translate(`shell.adapters.${interactiveProvider(config)}`),
    );
    return {
      profileId: `${interactiveProvider(config)}-terminal-v1`,
      title: `${slot + 1} · ${providers[slot]}`,
      html: terminalDocument({
        language,
        slot,
        providers,
        provider: providers[slot]!,
        project: config.project,
        version: config.executableVersion,
        startProfile: `${interactiveProvider(config)}-terminal-v1`,
        operationalOpen: true,
        nativeAuthentication: !!config.authentication,
        scope: config.authentication ? 'reuseScope' : 'scope',
        terminalId: core.identities[slot]!.terminalId,
        translate,
      })
        .replaceAll('orqst-terminal://local/client.js', 'client.js')
        .replaceAll('orqst-terminal://local/style.css', 'style.css')
        .replace('<body>', '<body class="tauri-terminal">'),
    };
  };
  async function enroll(message: z.infer<typeof enrollmentMessage>) {
    const reply = (value: object) => {
      if (!closed) send({ kind: 'enrollment-reply', id: message.id, ...value });
    };
    // A duplicate pending operation must never receive a misleading pre-effect refusal.
    if (enrollmentOperations.has(message.id)) return;
    if (enrollmentOperations.size >= 128) return reply({ status: 'rejected' });
    enrollmentOperations.add(message.id);
    if (enrollmentBusy || !service.beginMetadata()) return reply({ status: 'rejected' });
    enrollmentBusy = true;
    const presentation = layout.presentationRevision();
    try {
      if (message.epoch !== core.epoch || message.generation !== nativeGeneration)
        return reply({ status: 'rejected' });
      const config = readInteractiveTerminalConfig(message.manifestFile);
      if (!config.preparation) return reply({ status: 'rejected' });
      await layout.flush();
      const inspection = await core.enrollmentInspect();
      if (closed || presentation !== layout.presentationRevision())
        return reply({ status: 'rejected' });
      const receipt = await core.enroll(
        {
          version: 1,
          epoch: core.epoch,
          opId: message.id,
          expectedRevision: inspection.revision,
          workspaceId: config.preparation.workspaceId,
          featureId: config.preparation.featureId,
        },
        message.manifestFile,
      );
      if (closed) return;
      if (receipt.status !== 'ready' || !receipt.member)
        return reply({ status: receipt.status, receipt });
      if (
        terminalEnrollmentFile(message.manifestFile, config).bindingDigest !==
        receipt.member.bindingDigest
      )
        throw new Error('Enrollment document source changed');
      const slot = receipt.member.slot;
      service.append(slot, core.supervisors[slot]!);
      layout.append(slot);
      selection.push({ config, blocker: undefined });
      if (receipt.featureId !== null && message.previousLayout) {
        const feature = await core.features.read(receipt.featureId);
        await core.features.saveLayout(
          receipt.featureId,
          appendTerminalLayout(message.previousLayout, feature.terminalIds),
        );
      }
      const previous = layout.snapshot();
      store = terminalLayoutStore(
        directory!,
        core.identities.map((i) => i.terminalId),
        core.layouts,
      );
      // Preserve the unassigned layout under its expanded UUID selection.
      if (receipt.featureId === null && previous.order.length === slot)
        await store.save({
          ...previous,
          order: [...previous.order, slot],
          shown: [...previous.shown, slot],
        });
      presentations.set(message.id, { slot, generation: message.generation, presentation });
      reply({ status: 'ready', receipt, pane: paneDocument(config, slot) });
    } catch {
      // The new operation alone is uncertain. Never shut down/recreate the original Core.
      reply({ status: 'uncertain' });
    } finally {
      enrollmentBusy = false;
      service.endMetadata();
    }
  }

  let pending = Buffer.alloc(0);
  process.stdin.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    if (pending.length > 128 * 1024) return shutdown();
    let end: number;
    while ((end = pending.indexOf(10)) !== -1) {
      const line = pending.subarray(0, end).toString('utf8');
      pending = pending.subarray(end + 1);
      if (line === 'shutdown') return shutdown();
      try {
        const raw: unknown = JSON.parse(line);
        if (kernelIdentityReplySchema.safeParse(raw).success) {
          if (!nativeKernel.accept(raw)) return shutdown();
          continue;
        }
        if (kernelLivenessReplySchema.safeParse(raw).success) {
          if (!nativeLiveness.accept(raw)) return shutdown();
          continue;
        }
        const enrollment = enrollmentMessage.safeParse(raw);
        if (enrollment.success) {
          void enroll(enrollment.data);
          continue;
        }
        const present = enrollmentPresent.safeParse(raw);
        if (present.success) {
          const accepted = presentations.get(present.data.id);
          presentations.delete(present.data.id); // One shot, including a stale presentation.
          const finish = (ready: boolean) =>
            send({
              kind: 'enrollment-presented',
              id: present.data.id,
              ready,
            });
          if (
            accepted &&
            accepted.generation === nativeGeneration &&
            present.data.generation === nativeGeneration &&
            service.beginMetadata()
          )
            void features
              .enrolled(accepted.slot, accepted.presentation)
              .then(finish, () => finish(false))
              .finally(() => service.endMetadata());
          else finish(false);
          continue;
        }
        const feature = featureNativeEnvelopeSchema
          .or(featurePermissionNativeEnvelopeSchema)
          .safeParse(raw);
        if (
          !feature.success &&
          raw &&
          typeof raw === 'object' &&
          ['feature-request', 'feature-permission-request'].includes(Reflect.get(raw, 'kind'))
        ) {
          const identity = correlation.safeParse(raw);
          if (identity.success)
            send({ kind: 'feature-reply', ...identity.data, value: { status: 'denied' } });
          // A rejected metadata packet has no execution effect and never shuts down the Core.
          continue;
        }
        if (feature.success) {
          const message = feature.data;
          const mutable = message.request.action !== 'snapshot';
          const actor = 'actorId' in message ? message.actorId : undefined;
          const nativeActorMatches = actor === undefined || actor === `native-${core.epoch}`;
          const allowed = nativeActorMatches && (!mutable || service.beginMetadata());
          void (
            allowed
              ? features.request(message.request, actor)
              : Promise.resolve({
                  status: nativeActorMatches ? ('busy' as const) : ('denied' as const),
                })
          )
            .then((value) =>
              send({
                kind: 'feature-reply',
                id: message.id,
                document: message.document,
                value: featureNativeReplySchema.parse(value),
              }),
            )
            .catch(shutdown)
            .finally(() => {
              if (allowed && mutable) service.endMetadata();
            });
          continue;
        }
        const visual = visualMessageSchema.safeParse(raw);
        if (visual.success) {
          const message = visual.data;
          // A delayed visual message must not reopen presentation during the fence.
          if (service.fenced() && !visualAllowedDuringFence(message.kind)) continue;
          if (message.kind === 'layout-generation') {
            nativeGeneration = Math.max(nativeGeneration, message.generation);
            layout.setNativeGeneration(message.generation);
          } else if (message.kind === 'layout-action') {
            if (message.action === 'reopen' && message.generation !== nativeGeneration) continue;
            layout.act(message.slot, message.action, message.generation);
          } else if (message.kind === 'layout-open') layout.open(message.slot);
          else if (message.kind === 'layout-focus') layout.focus(message.slot);
          else if (message.kind === 'layout-suspend') layout.suspend();
          else layout.resize(message.width, message.height);
        } else void service.receive(raw).catch(shutdown);
      } catch {
        shutdown();
      }
    }
  });
  process.stdin.on('end', shutdown);
  process.stdin.on('error', shutdown);
  process.stdout.on('error', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.stdin.resume();
  const providers = selection.map(({ config }) =>
    translate(`shell.adapters.${interactiveProvider(config)}`),
  );
  readySent = true;
  send({
    kind: 'ready',
    pendingOwnedExits: core.pendingOwnedExits,
    id: startupId,
    epoch: core.epoch,
    admissionOwner: core.admissionOwner,
    initialFiles: core.initialFiles,
    capacity: 8,
    layout: layout.snapshot(),
    title: translate('managedTerminal.title'),
    quitNotice: translate('managedTerminal.quitNotice'),
    cancel: translate('terminalNative.cancel'),
    quit: translate('managedAgents.disconnectQuit'),
    retire: translate('managedTerminal.retire'),
    retireDenied: translate('tauriPreparation.retireDenied'),
    retired: translate('tauriPreparation.retired'),
    mcpEnabled,
    mcpAuthorize: translate('managedTerminal.mcpAuthorize'),
    mcpDenied: translate('managedTerminal.mcpDenied'),
    panes: selection.map(({ config }, slot) => ({
      profileId: `${interactiveProvider(config)}-terminal-v1`,
      title: `${slot + 1} · ${providers[slot]}`,
      html: terminalDocument({
        language,
        slot,
        providers,
        provider: providers[slot]!,
        project: config.project,
        version: config.executableVersion,
        startProfile: `${interactiveProvider(config)}-terminal-v1`,
        operationalOpen,
        nativeAuthentication: !!config.authentication,
        scope: config.authentication ? 'reuseScope' : 'scope',
        terminalId: core.identities[slot]!.terminalId,
        translate,
      })
        .replaceAll('orqst-terminal://local/client.js', 'client.js')
        .replaceAll('orqst-terminal://local/style.css', 'style.css')
        .replace('<body>', '<body class="tauri-terminal">'),
    })),
  });
}
void start().catch((error: unknown) => {
  activeCore?.close();
  process.stdout.write(JSON.stringify(terminalStartupHostFailure(startupId, error)) + '\n');
  process.exitCode = 1;
});
