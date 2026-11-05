import { generateKeyPairSync } from 'node:crypto';
import { createInstance } from 'i18next';
import { z } from 'zod';
import en from '../../dashboard/src/locales/en-US.json';
import pt from '../../dashboard/src/locales/pt-BR.json';
import { nativeManagedAgentsFeatureContext } from './managed-agents-context.js';
import { connectManagedAgents } from './managed-agents-core.js';
import { managedAgentsDocument } from './managed-agents-document.js';
import { TauriAgentsService } from './tauri-agents-service.js';

process.umask(0o077);
let activeCore: Awaited<ReturnType<typeof connectManagedAgents>> | undefined;
async function start() {
  if (
    process.platform !== 'darwin' ||
    process.arch !== 'arm64' ||
    process.getuid?.() === 0 ||
    !/^v24\./.test(process.version)
  )
    throw new Error('Unsupported managed agents host');
  const files = z
    .tuple([z.string().min(1).max(2048), z.string().min(1).max(2048)])
    .parse(JSON.parse(process.argv[2]!));
  const directory = process.argv[3];
  if (!directory || ![4, 5].includes(process.argv.length))
    throw new Error('Private native bootstrap required');
  const featureContext = nativeManagedAgentsFeatureContext(
    files,
    process.argv[4] === undefined ? undefined : JSON.parse(process.argv[4]),
  );
  const keys = generateKeyPairSync('ed25519');
  const core = await connectManagedAgents(files, keys.publicKey, directory, featureContext);
  activeCore = core;
  const language = process.env.LANG?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US';
  const i18n = createInstance();
  await i18n.init({
    lng: language,
    fallbackLng: 'en-US',
    resources: { 'en-US': { translation: en }, 'pt-BR': { translation: pt } },
  });
  const translate = (key: string) =>
    String(
      i18n.t(
        key === 'managedAgents.setup'
          ? 'managedAgents.tauriSetup'
          : key === 'managedAgents.lifetime_retired'
            ? 'managedAgents.tauriRetired'
            : key,
      ),
    );
  let closed = false;
  const send = (value: object) => {
    if (closed) return;
    const line = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(line) > 512 * 1024 || process.stdout.writableLength > 1024 * 1024)
      return shutdown();
    process.stdout.write(line);
  };
  const service = new TauriAgentsService(core, keys.privateKey, send, translate);
  function shutdown() {
    if (closed) return;
    closed = true;
    service.close();
    process.stdin.destroy();
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
        void service.receive(JSON.parse(line)).catch(shutdown);
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
  send({
    kind: 'ready',
    title: translate('managedAgents.title'),
    quitNotice: translate('managedAgents.quitNotice'),
    cancel: translate('terminalNative.cancel'),
    quit: translate('managedAgents.disconnectQuit'),
    html: managedAgentsDocument(language, translate)
      .replaceAll('orqst-terminal://local/client.js', 'client.js')
      .replaceAll('orqst-terminal://local/style.css', 'style.css'),
  });
}
void start().catch(() => {
  activeCore?.close();
  console.error('ORQST managed agents startup refused.');
  process.exitCode = 1;
});
