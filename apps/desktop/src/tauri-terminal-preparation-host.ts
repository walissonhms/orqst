import {
  inspectPreparationDatabases,
  terminalPreparationContextSchema,
} from '../../../packages/core/src/terminal/preparation-context.js';
import { readStudioFeatureTree } from '../../../packages/core/src/terminal/layout-database.js';
import { discoverLocalClis } from '../../../packages/core/src/terminal/local-cli.js';
import { lookupTerminalWorkspace } from '@orqst/database';
import { cliDiscoverySchema, studioStartupSchema } from '@orqst/protocol';
import { basename } from 'node:path';
import { desktopAdmissionContextSchema } from '../../../packages/core/src/managed-codex/desktop-admission-inspection.js';
import { createInstance } from 'i18next';
import { z } from 'zod';
import en from '../../dashboard/src/locales/en-US.json';
import pt from '../../dashboard/src/locales/pt-BR.json';
import { savedTerminalMetadata } from './saved-terminal-metadata.js';
import { prepareTauriTerminals, tauriPreparationFailure } from './tauri-terminal-preparation.js';

process.umask(0o077);

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.getuid?.() === 0)
    throw new Error('Unsupported native preparation');
  if (!/^v24\./.test(process.version)) throw new Error('Node 24 required');
  const parent = z.string().min(1).max(2048).parse(process.argv[3]);
  const home = z.string().min(1).max(2048).parse(process.env.HOME);
  const raw: unknown = JSON.parse(process.argv[2]!);
  const passive = z.strictObject({ action: z.enum(['startup', 'discovery']) }).safeParse(raw);
  if (passive.success) {
    const trusted = terminalPreparationContextSchema.parse(JSON.parse(process.argv[4]!));
    const data =
      passive.data.action === 'startup'
        ? (() => {
            inspectPreparationDatabases(trusted);
            const tree = readStudioFeatureTree(trusted.preferencesDirectory);
            const metadata = savedTerminalMetadata(
              parent,
              new Set(
                tree.flatMap(({ features }) => features.flatMap(({ terminalIds }) => terminalIds)),
              ),
            );
            const workspaces = tree.map((workspace) => {
              const path = lookupTerminalWorkspace(trusted.observerDatabase, workspace.id);
              const features = workspace.features.map((feature) => {
                if (!feature.terminalDisplays) return feature;
                return {
                  ...feature,
                  terminalDisplays: feature.terminalDisplays.map((entry) => {
                    const saved = metadata.get(entry.terminalId);
                    if (!saved || saved.project !== path) return entry;
                    return {
                      ...entry,
                      provider: saved.provider,
                      activeReservation: entry.released ? undefined : saved.activeReservation,
                    };
                  }),
                };
              });
              return { ...workspace, features, name: (path && basename(path)) || workspace.id };
            });
            return { status: 'startup', startup: studioStartupSchema.parse({ workspaces }) };
          })()
        : {
            status: 'discovery',
            clis: cliDiscoverySchema.parse(
              discoverLocalClis(process.env.PATH ?? '', home).map(({ provider, lookup }) => ({
                provider,
                lookup,
              })),
            ),
          };
    const line = JSON.stringify({ kind: 'complete', ...data }) + '\n';
    if (Buffer.byteLength(line) > 96 * 1024) throw new Error('Studio startup metadata too large');
    process.stdout.write(line);
    return;
  }
  const i18n = createInstance();
  await i18n.init({
    lng: process.env.LANG?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US',
    fallbackLng: 'en-US',
    resources: { 'en-US': { translation: en }, 'pt-BR': { translation: pt } },
  });
  const translate = (key: string) => String(i18n.t(key));
  // These are plain native strings, never HTML. Escape controls in values before adding line breaks.
  const nativeText = (value: string) =>
    value.replace(
      /[\p{Cc}\p{Cf}]/gu,
      (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`,
    );

  let sequence = 0;
  let live = true;
  let pending: { id: number; resolve(value: string | boolean | null): void } | undefined;
  const deadline = setTimeout(() => close(), 300_000);
  function close() {
    live = false;
    clearTimeout(deadline);
    pending?.resolve(null);
    pending = undefined;
    process.stdin.destroy();
  }
  function send(value: object) {
    const line = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(line) > 128 * 1024 || process.stdout.writableLength > 128 * 1024)
      throw new Error('Preparation pipe capacity exceeded');
    process.stdout.write(line);
  }
  function ask(value: object): Promise<string | boolean | null> {
    if (!live || pending) throw new Error('Preparation is unavailable');
    const id = ++sequence;
    return new Promise((resolve) => {
      pending = { id, resolve };
      send({ ...value, id });
    });
  }
  const response = z.strictObject({
    id: z.number().int().positive(),
    value: z.union([z.string().min(1).max(2048), z.boolean(), z.null()]),
  });
  let buffer = Buffer.alloc(0);
  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 16 * 1024) return close();
    const end = buffer.indexOf(10);
    if (end < 0) return;
    try {
      const parsed = response.parse(JSON.parse(buffer.subarray(0, end).toString('utf8')));
      buffer = buffer.subarray(end + 1);
      if (!pending || pending.id !== parsed.id || buffer.length) return close();
      const resolve = pending.resolve;
      pending = undefined;
      resolve(parsed.value);
    } catch {
      close();
    }
  });
  process.stdin.on('end', close);
  process.stdin.on('error', close);
  process.stdout.on('error', close);
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
  process.stdin.resume();
  try {
    const result = await prepareTauriTerminals(
      raw,
      { parent, home, node: process.execPath, environment: process.env },
      {
        current: () => live,
        choose: async (directory) => {
          const value = await ask({
            kind: 'pick',
            directory,
            title: translate(`tauriPreparation.${directory ? 'project' : 'executable'}`),
          });
          return typeof value === 'string' ? value : undefined;
        },
        confirm: async (key, detail, overview) =>
          (await ask({
            kind: 'confirm',
            title: translate(
              key === 'cliUpdate' ? 'studio.cliReview.action' : 'managedTerminal.createTeam',
            ),
            message: translate(`tauriPreparation.${key}`),
            detail,
            ...(overview
              ? {
                  summary: [
                    i18n.t('tauriPreparation.reviewWorkspace', {
                      project: nativeText(overview.project),
                      interpolation: { escapeValue: false },
                    }),
                    ...overview.terminals.map((terminal) =>
                      i18n.t(
                        `tauriPreparation.${terminal.role === 'source' ? 'reviewSource' : terminal.role === 'worker' ? 'reviewWorker' : 'reviewTerminal'}`,
                        {
                          id: terminal.id,
                          provider: terminal.provider,
                          model: terminal.model ?? translate('studio.prepare.cliDefault'),
                          interpolation: { escapeValue: false },
                        },
                      ),
                    ),
                  ].join('\n'),
                  details: translate('tauriPreparation.reviewDetails'),
                  back: translate('tauriPreparation.reviewBack'),
                }
              : {}),
            cancel: translate('terminalNative.cancel'),
            approve: translate(`tauriPreparation.${key}Approve`),
          })) === true,
        check: async (cliUpdate) => (await ask({ kind: 'check', cliUpdate })) === true,
        commit: async () => (await ask({ kind: 'commit' })) === true,
      },
      Date.now,
      process.argv[4]
        ? terminalPreparationContextSchema.parse(JSON.parse(process.argv[4]))
        : undefined,
      process.argv[5] && process.argv[5] !== 'null'
        ? desktopAdmissionContextSchema.parse(JSON.parse(process.argv[5]))
        : undefined,
      process.argv[6] === undefined
        ? 8
        : z.number().int().min(0).max(8).parse(Number(process.argv[6])),
      process.argv[7] === 'true',
    );
    if (live) send({ kind: 'complete', ...result });
  } finally {
    close();
  }
}

void main().catch((error: unknown) => {
  // A fixed-size allowlisted envelope survives the native boundary; raw errors never leave here.
  process.stdout.write(
    JSON.stringify({ kind: 'failure', failure: tauriPreparationFailure(error) }) + '\n',
  );
  process.exitCode = 1;
});
