// Passive CLI-owned catalogue/configuration evidence. Never execute a provider or inspect auth.
import { join } from 'node:path';
import { z } from 'zod';
import { terminalDigest } from './authority.js';
import { terminalFile } from './codex-profile.js';
import type { LocalCliProvider } from './local-cli.js';

export const terminalModelValueSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/#@+-]*$/);
// OpenCode 2.2.5 ConfigModel.Selection / Model.Ref.parse, reviewed at 9bbb8ce.
// Retain the shared safe-character budget and require the native reference grammar.
const openCodeModelValueSchema = terminalModelValueSchema.regex(/^[^/#]+\/[^#]+(?:#[^#]+)?$/u);
const openCodeModelPartSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9._:/@+-]+$/);
const openCodeConfiguredModelSchema = z.object({
  providerID: terminalModelValueSchema.regex(/^[^/#]+$/u),
  model: openCodeModelPartSchema,
  variant: openCodeModelPartSchema.optional(),
});
const sourceFile = z.strictObject({
  path: z.string().startsWith('/').max(2048),
  codexModel: terminalModelValueSchema.optional(),
  openCodeModel: terminalModelValueSchema.optional(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
export const terminalModelSelectionSchema = z.strictObject({
  value: terminalModelValueSchema.nullable(),
  source: z.enum(['cli-default', 'native-config', 'cli-cache', 'official-alias', 'native-state']),
  expiresAt: z.number().int().positive().safe().optional(),
  files: z.array(sourceFile).min(1).max(8),
});
export type TerminalModelSelection = z.infer<typeof terminalModelSelectionSchema>;

const maximumBytes = 2 * 1024 * 1024;
function read(path: string): Buffer | null {
  try {
    return terminalFile(path, false, maximumBytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

const codexCacheSchema = z.object({
  client_version: z.literal('0.162.1'),
  fetched_at: z.iso.datetime({ offset: true }),
  models: z
    .array(
      z.object({
        slug: z.string(),
        display_name: z.string().optional(),
        visibility: z.enum(['list', 'hide', 'none']),
      }),
    )
    .max(128),
});

function codexCache(bytes: Buffer) {
  let cache: z.infer<typeof codexCacheSchema>;
  try {
    cache = codexCacheSchema.parse(JSON.parse(bytes.toString('utf8')));
  } catch {
    throw new Error('CLI model catalogue changed; reload the terminal picker');
  }
  const fetchedAt = Date.parse(cache.fetched_at);
  const expiresAt = fetchedAt + 300_000;
  if (fetchedAt > Date.now() || expiresAt <= Date.now())
    throw new Error('CLI model catalogue expired; reload the terminal picker');
  return { ...cache, expiresAt };
}

function cachedModelDigest(cache: ReturnType<typeof codexCache>, value: string) {
  const matches = cache.models.filter((model) => model.slug === value);
  if (matches.length !== 1 || matches[0]!.visibility !== 'list')
    throw new Error('CLI model catalogue changed; reload the terminal picker');
  const model = matches[0]!;
  // Only the selected visible entry is source evidence. Freshness is checked separately.
  return terminalDigest(
    JSON.stringify([
      cache.client_version,
      model.slug,
      model.display_name ?? model.slug,
      model.visibility,
    ]),
  );
}

/** Evidence is checked again immediately before the existing PTY profile is dispatched. */
export function validateTerminalModelSelection(selection: TerminalModelSelection | undefined) {
  if (!selection) return;
  terminalModelSelectionSchema.parse(selection);
  if (selection.expiresAt !== undefined && Date.now() >= selection.expiresAt)
    throw new Error('CLI model catalogue expired; reload the terminal picker');
  for (const file of selection.files) {
    const bytes = read(file.path);
    const cache = file.codexModel && bytes ? codexCache(bytes) : undefined;
    if (
      file.codexModel &&
      (!cache ||
        selection.value !== file.codexModel ||
        selection.source !== 'cli-cache' ||
        selection.expiresAt === undefined ||
        cache.expiresAt < selection.expiresAt)
    )
      throw new Error('CLI model catalogue changed; reload the terminal picker');
    const digest = cache
      ? cachedModelDigest(cache, file.codexModel!)
      : file.openCodeModel
        ? openCodeStateDigest(
            bytes === null ? null : decodeOpenCodeState(bytes),
            file.openCodeModel,
          )
        : bytes === null
          ? null
          : terminalDigest(bytes);
    if (
      file.openCodeModel &&
      (selection.source !== 'native-state' || selection.value !== file.openCodeModel || !digest)
    )
      throw new Error('CLI model catalogue changed; reload the terminal picker');
    if (digest !== file.sha256)
      throw new Error('CLI model catalogue changed; reload the terminal picker');
  }
}
export function terminalModelArguments(selection: TerminalModelSelection | undefined): string[] {
  validateTerminalModelSelection(selection);
  return selection?.value ? ['--model', selection.value] : [];
}

/** Full TUI Root has no --model consumer; use the native V2 inline default instead. */
export function openCodeModelConfiguration(selection: TerminalModelSelection | undefined) {
  validateTerminalModelSelection(selection);
  if (!selection?.value) return undefined;
  const value = openCodeModelValueSchema.parse(selection.value);
  const [reference, variant] = value.split('#');
  const providerEnd = reference!.indexOf('/');
  return openCodeConfiguredModelSchema.parse({
    providerID: reference!.slice(0, providerEnd),
    model: reference!.slice(providerEnd + 1),
    ...(variant ? { variant } : {}),
  });
}

/**
 * OpenCode 2.2.5 records the models the person chose in its own state document.
 * Adapted (bounded, preference-only subset) from its MIT-licensed
 * `packages/tui/src/model-preference.ts`, `decodeModelPreference`/`modelPreferenceKey`
 * at 9bbb8ce18c80f099e0e448775f59d965ead40a21; the file is always
 * `<XDG_STATE_HOME|~/.local/state>/opencode/model.json` (`context/local.tsx`).
 * Copyright (c) 2025 opencode. MIT license and full attribution: root NOTICE.
 * This is a native preference log, never an entitlement or credential source.
 */
const openCodeStateModelSchema = z.object({
  providerID: z.string().min(1).max(160),
  modelID: z.string().min(1).max(160),
});
const openCodeStateSchema = z.object({
  recent: z.array(openCodeStateModelSchema).max(64).optional(),
  favorite: z.array(openCodeStateModelSchema).max(64).optional(),
  variant: z
    .record(z.string().max(322), z.string().max(160))
    .refine((value) => Object.keys(value).length <= 128)
    .optional(),
});

/** `favorite` precedes `recent`; saved variants add their own `provider/model` references. */
function decodeOpenCodeState(bytes: Buffer) {
  const document = openCodeStateSchema.parse(JSON.parse(bytes.toString('utf8')));
  const entries: { provider: string; model: string; variant?: string }[] = [];
  const add = (provider: string, model: string) => {
    if (entries.some((entry) => entry.provider === provider && entry.model === model)) return;
    const variant = document.variant?.[`${provider}/${model}`];
    entries.push({
      provider,
      model,
      ...(variant && variant !== 'default' ? { variant } : {}),
    });
  };
  for (const entry of [...(document.favorite ?? []), ...(document.recent ?? [])])
    add(entry.providerID, entry.modelID);
  for (const key of Object.keys(document.variant ?? {})) {
    const end = key.indexOf('/');
    if (end > 0) add(key.slice(0, end), key.slice(end + 1));
  }
  return { document, entries };
}

/** Source evidence is the chosen reference only; unrelated preference edits stay irrelevant. */
function openCodeStateDigest(state: ReturnType<typeof decodeOpenCodeState> | null, value: string) {
  if (!state) return null;
  const end = value.indexOf('/');
  const providerID = value.slice(0, end);
  const rest = value.slice(end + 1);
  const hash = rest.indexOf('#');
  const modelID = hash < 0 ? rest : rest.slice(0, hash);
  const entry = state.entries.find(
    (candidate) => candidate.provider === providerID && candidate.model === modelID,
  );
  if (!entry) return null;
  // A saved variant only counts when it is the exact reference recorded for this entry.
  if (entry.variant !== (hash < 0 ? undefined : rest.slice(hash + 1))) return null;
  return terminalDigest(
    JSON.stringify(['opencode-model-state', providerID, modelID, entry.variant ?? null]),
  );
}

/** Passive CLI-owned catalogue/configuration evidence. Never execute a provider or inspect auth. */

export function discoverTerminalModels(
  provider: LocalCliProvider,
  project: string,
  home: string,
  environment: NodeJS.ProcessEnv,
) {
  const codexHome = environment.CODEX_HOME ?? join(home, '.codex');
  const claudeHome = environment.CLAUDE_CONFIG_DIR ?? join(home, '.claude');
  const opencodeHome =
    environment.OPENCODE_CONFIG_DIR ??
    join(environment.XDG_CONFIG_HOME ?? join(home, '.config'), 'opencode');
  const paths =
    provider === 'codex'
      ? [
          join(codexHome, 'config.toml'),
          join(project, '.codex/config.toml'),
          join(codexHome, 'models_cache.json'),
        ]
      : provider === 'claude'
        ? [
            join(claudeHome, 'settings.json'),
            join(project, '.claude/settings.json'),
            join(project, '.claude/settings.local.json'),
          ]
        : [
            join(opencodeHome, 'opencode.json'),
            join(opencodeHome, 'opencode.jsonc'),
            join(project, 'opencode.json'),
            join(project, 'opencode.jsonc'),
          ];
  // The native preference document is separate state, never merged into configuration evidence.
  const openCodeStatePath =
    provider === 'opencode'
      ? join(environment.XDG_STATE_HOME ?? join(home, '.local', 'state'), 'opencode', 'model.json')
      : null;
  const readSources = (all: string[]) =>
    all.map((path) => {
      const bytes = read(path);
      return { path, bytes, sha256: bytes === null ? null : terminalDigest(bytes) };
    });
  const sources = readSources(paths);
  const stateSource = openCodeStatePath ? readSources([openCodeStatePath])[0]! : null;
  let nativeState: ReturnType<typeof decodeOpenCodeState> | null = null;
  if (stateSource?.bytes) {
    try {
      nativeState = decodeOpenCodeState(stateSource.bytes);
    } catch {
      // Unknown/unsafe preference documents stay CLI-owned; never guess a model from them.
      nativeState = null;
    }
  }
  // Native defaults/configured models do not consume the picker cache.
  const files = sources
    .filter(({ path }) => !path.endsWith('models_cache.json'))
    .map(({ path, sha256 }) => ({ path, sha256 }));
  const options: { label: string; selection: TerminalModelSelection }[] = [
    {
      label: 'CLI default',
      selection: { value: null, source: 'cli-default', files },
    },
  ];
  let limited = true;
  // Claude Code 2.1.178 and 2.1.318: reviewed aliases, not account availability.
  // Passive 2.1.318 review: docs/research/claude-code-tauri.md (2026-11-05).
  // https://code.claude.com/docs/en/model-config#model-aliases
  const add = (
    value: unknown,
    source: TerminalModelSelection['source'],
    label?: unknown,
    expiresAt?: number,
    cacheFile?: z.infer<typeof sourceFile>,
  ) => {
    const parsed = terminalModelValueSchema.safeParse(value);
    if (
      !parsed.success ||
      (provider === 'opencode' && !openCodeModelValueSchema.safeParse(parsed.data).success) ||
      options.length >= 128 ||
      options.some((option) => option.selection.value === parsed.data)
    )
      return;
    options.push({
      label:
        typeof label === 'string' && /^[^\p{Cc}\p{Cf}]{1,160}$/u.test(label) ? label : parsed.data,
      selection: {
        value: parsed.data,
        source,
        files: cacheFile ? [...files, cacheFile] : files,
        ...(expiresAt ? { expiresAt } : {}),
      },
    });
  };
  if (provider === 'claude') {
    for (const alias of ['sonnet', 'opus', 'haiku']) add(alias, 'official-alias');
    limited = false;
  }
  for (const { path, bytes } of sources) {
    if (!bytes) continue;
    const text = bytes.toString('utf8');
    try {
      if (path.endsWith('models_cache.json')) {
        const cache = codexCache(bytes);
        for (const model of cache.models)
          if (model.visibility === 'list')
            add(model.slug, 'cli-cache', model.display_name, cache.expiresAt, {
              path,
              codexModel: model.slug,
              sha256: cachedModelDigest(cache, model.slug),
            });
        if (options.some((option) => option.selection.source === 'cli-cache')) limited = false;
      } else if (path.endsWith('.toml')) {
        // Deliberately narrow: JSON-compatible TOML basic strings only. No TOML evaluation.
        for (const match of text.matchAll(/^\s*model\s*=\s*("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/gm))
          add(JSON.parse(match[1]!), 'native-config');
      } else {
        // JSONC/interpolation is delegated to the CLI default rather than guessed or executed.
        const value = z.object({ model: z.unknown().optional() }).parse(JSON.parse(text));
        add(value.model, 'native-config');
        if (provider === 'opencode') {
          const group = z.record(
            z.string(),
            z.object({
              models: z
                .record(z.string(), z.object({ disabled: z.boolean().optional() }))
                .optional(),
            }),
          );
          const configured = z
            .object({
              // 2.2.5 accepts native V2 fields and migrates legacy provider maps.
              providers: group.optional(),
              provider: group.optional(),
              model: z.union([z.string(), openCodeConfiguredModelSchema]).optional(),
            })
            .parse(JSON.parse(text));
          if (configured.model && typeof configured.model !== 'string') {
            const chosen = configured.model;
            add(
              `${chosen.providerID}/${chosen.model}${chosen.variant ? `#${chosen.variant}` : ''}`,
              'native-config',
            );
          }
          for (const [providerId, configuration] of Object.entries({
            ...configured.provider,
            ...configured.providers,
          }))
            for (const [modelId, model] of Object.entries(configuration.models ?? {}))
              if (!model.disabled) add(`${providerId}/${modelId}`, 'native-config');
        }
      }
    } catch {
      /* Unknown CLI configuration remains CLI-owned; never fabricate a catalogue. */
    }
  }
  // Models the person already chose in this CLI, in its own declared order. Availability stays
  // unverified: a native preference is a real reference, not a credential or entitlement claim.
  for (const entry of nativeState?.entries ?? []) {
    const value = `${entry.provider}/${entry.model}${entry.variant ? `#${entry.variant}` : ''}`;
    add(value, 'native-state', undefined, undefined, {
      path: openCodeStatePath!,
      openCodeModel: value,
      sha256: openCodeStateDigest(nativeState, value),
    });
  }
  return {
    limited,
    options: options.map((option) => ({
      ...option,
      id: terminalDigest(JSON.stringify([provider, option.selection])),
    })),
  };
}
