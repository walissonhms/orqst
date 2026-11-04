import { generateKeyPairSync } from 'node:crypto';
import { join } from 'node:path';
import { createInstance } from 'i18next';
import { z } from 'zod';
import en from '../../dashboard/src/locales/en-US.json';
import pt from '../../dashboard/src/locales/pt-BR.json';
import { inspectManagedTerminalFiles } from '../../../packages/core/src/terminal/managed-files.js';
import { interactiveProvider } from '../../../packages/core/src/terminal/interactive-profile.js';
import { connectManagedTerminalCore } from './managed-terminal-core.js';
import { terminalDocument } from './terminal-document.js';
import { terminalLayoutStore } from './terminal-layout-store.js';
import { TauriTerminalLayout } from './tauri-terminal-layout.js';
import { featureNativeReplySchema, featureNativeEnvelopeSchema } from '@orqst/protocol';
import { TauriFeatureService } from './tauri-feature-service.js';
import { TauriTerminalService } from './tauri-terminal-service.js';

process.umask(0o077);
let activeCore: Awaited<ReturnType<typeof connectManagedTerminalCore>> | undefined;
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
  const core = await connectManagedTerminalCore(
    files,
    join(__dirname, 'managed-terminal-core.cjs'),
    keys.publicKey,
    directory,
    files.length,
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
  );
  const store = terminalLayoutStore(
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
    store,
    selection[0]!.config.project,
    async () => {
      await Promise.all(selection.map((_, slot) => service.receive({ kind: 'revoke', slot })));
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
    process.stdin.destroy();
    void core.closeAndWait().catch(() => {
      process.exitCode = 1;
    });
  }
  const visualMessageSchema = z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('layout-action'),
      slot: z
        .number()
        .int()
        .min(0)
        .max(files.length - 1),
      action: z.unknown(),
    }),
    z.strictObject({ kind: z.literal('layout-suspend') }),
    z.strictObject({
      kind: z.literal('layout-generation'),
      generation: z.number().int().nonnegative().safe(),
    }),
    z.strictObject({
      kind: z.literal('layout-focus'),
      slot: z
        .number()
        .int()
        .min(0)
        .max(files.length - 1),
    }),
    z.strictObject({
      kind: z.literal('layout-open'),
      slot: z
        .number()
        .int()
        .min(0)
        .max(files.length - 1),
    }),
    z.strictObject({
      kind: z.literal('layout-resize'),
      width: z.number().int().min(1).max(32768),
      height: z.number().int().min(1).max(32768),
    }),
  ]);

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
        const feature = featureNativeEnvelopeSchema.safeParse(raw);
        if (
          !feature.success &&
          raw &&
          typeof raw === 'object' &&
          Reflect.get(raw, 'kind') === 'feature-request'
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
          const allowed = !mutable || service.beginMetadata();
          void (
            allowed
              ? features.request(message.request)
              : Promise.resolve({ status: 'busy' as const })
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
          if (message.kind === 'layout-generation') layout.setNativeGeneration(message.generation);
          else if (message.kind === 'layout-action') layout.act(message.slot, message.action);
          else if (message.kind === 'layout-open') layout.open(message.slot);
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
void start().catch(() => {
  activeCore?.close();
  console.error('ORQST managed terminal startup refused.');
  process.exitCode = 1;
});
