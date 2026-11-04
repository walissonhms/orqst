import { createInstance } from 'i18next';
import { z } from 'zod';
import en from '../../dashboard/src/locales/en-US.json';
import pt from '../../dashboard/src/locales/pt-BR.json';
import { allowedNavigation } from './policy.js';
import { nativeFileFetch, TauriFilesService } from './tauri-files-service.js';

process.umask(0o077);
async function main() {
  const origin = z.string().max(200).parse(process.argv[2]);
  const fetcher = await nativeFileFetch(origin);
  const i18n = createInstance();
  await i18n.init({
    lng: process.env.LANG?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US',
    fallbackLng: 'en-US',
    resources: { 'en-US': { translation: en }, 'pt-BR': { translation: pt } },
  });
  const t = (key: string, values?: Record<string, unknown>) => String(i18n.t(key, values ?? {}));
  let live = true;
  let sequence = 0;
  let operation: string | undefined;
  let pending: { id: number; resolve(value: string | boolean | null): void } | undefined;
  const send = (value: object) => {
    const line = JSON.stringify(value) + '\n';
    if (!live || Buffer.byteLength(line) > 128 * 1024 || process.stdout.writableLength > 128 * 1024)
      throw new Error('File pipe capacity');
    process.stdout.write(line);
  };
  const ask = (value: object): Promise<string | boolean | null> => {
    if (pending || !live || !operation) return Promise.resolve(null);
    const id = ++sequence;
    return new Promise((resolve) => {
      pending = { id, resolve };
      send({ ...value, id, requestId: operation });
    });
  };
  const service = new TauriFilesService({
    origin,
    fetch: fetcher,
    translate: t,
    choose: async (dialog) => {
      // Analytics scope is reviewed in a separate native prompt before the save picker.
      if (
        dialog.message &&
        (await ask({
          kind: 'confirm',
          title: dialog.title,
          message: dialog.message,
          detail: '',
          cancel: t('artifacts.cancel'),
          approve: t('artifacts.nativeSave'),
        })) !== true
      )
        return undefined;
      const selected = await ask({ kind: 'choose', ...dialog });
      return typeof selected === 'string' ? selected : undefined;
    },
    confirm: async (title, path) =>
      (await ask({
        kind: 'confirm',
        title,
        message: t('artifacts.overwriteMessage'),
        detail: path,
        cancel: t('artifacts.cancel'),
        approve: t('artifacts.replace'),
      })) === true,
    open: async (path) => ((await ask({ kind: 'open', path })) === true ? '' : 'failed'),
  });
  const envelope = z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('request'),
      id: z.string().min(1).max(40),
      document: z.number().int().nonnegative().safe(),
      request: z.unknown(),
      source: z.string().min(1).max(4096),
    }),
    z.strictObject({ kind: z.literal('revoke'), document: z.number().int().positive().safe() }),
    z.strictObject({
      kind: z.literal('dialog'),
      id: z.number().int().positive(),
      value: z.union([z.string().min(1).max(4096), z.boolean(), z.null()]),
    }),
  ]);
  function close() {
    live = false;
    service.close();
    pending?.resolve(null);
    pending = undefined;
    process.stdin.destroy();
  }
  let buffer = Buffer.alloc(0);
  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 256 * 1024) return close();
    for (;;) {
      const end = buffer.indexOf(10);
      if (end < 0) return;
      const line = buffer.subarray(0, end);
      buffer = buffer.subarray(end + 1);
      if (line.toString() === 'shutdown') return close();
      try {
        if (line.length > 128 * 1024) return close();
        const value = envelope.parse(JSON.parse(line.toString('utf8')));
        if (value.kind === 'revoke') {
          service.revoke(value.document);
          pending?.resolve(null);
          pending = undefined;
        } else if (value.kind === 'dialog') {
          // Late replies to a revoked operation are inert.
          if (pending?.id === value.id) {
            const resolve = pending.resolve;
            pending = undefined;
            resolve(value.value);
          }
        } else {
          if (!allowedNavigation(value.source, origin) || new URL(value.source).origin !== origin) {
            send({ kind: 'reply', id: value.id, value: { status: 'failed' } });
            continue;
          }
          const context =
            value.request !== null &&
            typeof value.request === 'object' &&
            'kind' in value.request &&
            value.request.kind === 'analytics' &&
            'input' in value.request &&
            value.request.input !== null &&
            typeof value.request.input === 'object' &&
            'action' in value.request.input &&
            value.request.input.action === 'context';
          if (operation && !context) {
            send({ kind: 'reply', id: value.id, value: { status: 'busy' } });
            continue;
          }
          if (!context) operation = value.id;
          void service
            .request(value.request, value.document)
            .then((result) => {
              if (live) send({ kind: 'reply', id: value.id, value: result });
            })
            .catch(close)
            .finally(() => {
              if (operation === value.id) operation = undefined;
            });
        }
      } catch {
        return close();
      }
    }
  });
  process.stdin.on('end', close);
  process.stdin.on('error', close);
  process.stdout.on('error', close);
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
  process.stdin.resume();
  send({ kind: 'ready' });
}
void main().catch(() => {
  console.error('ORQST native file host refused.');
  process.exitCode = 1;
});
