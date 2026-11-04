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
const sourceFile = z.strictObject({
  path: z.string().startsWith('/').max(2048),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
export const terminalModelSelectionSchema = z.strictObject({
  value: terminalModelValueSchema.nullable(),
  source: z.enum(['cli-default', 'native-config', 'cli-cache', 'official-alias']),
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

/** Evidence is checked again immediately before the existing PTY profile is dispatched. */
export function validateTerminalModelSelection(selection: TerminalModelSelection | undefined) {
  if (!selection) return;
  terminalModelSelectionSchema.parse(selection);
  if (selection.expiresAt !== undefined && Date.now() >= selection.expiresAt)
    throw new Error('CLI model catalogue expired; reload the terminal picker');
  for (const file of selection.files) {
    const bytes = read(file.path);
    if ((bytes === null ? null : terminalDigest(bytes)) !== file.sha256)
      throw new Error('CLI model catalogue changed; reload the terminal picker');
  }
}
export function terminalModelArguments(selection: TerminalModelSelection | undefined): string[] {
  validateTerminalModelSelection(selection);
  return selection?.value ? ['--model', selection.value] : [];
}

/** Configured identifiers and cached picker entries are choices, never account entitlement. */
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
  const sources = paths.map((path) => {
    const bytes = read(path);
    return { path, bytes, sha256: bytes === null ? null : terminalDigest(bytes) };
  });
  const files = sources.map(({ path, sha256 }) => ({ path, sha256 }));
  const options: { label: string; selection: TerminalModelSelection }[] = [
    {
      label: 'CLI default',
      selection: { value: null, source: 'cli-default', files },
    },
  ];
  let limited = true;
  // Claude Code 2.1.178: official alias contract, not account availability.
  // https://github.com/anthropics/claude-code/blob/64ceb97caab3fb898ece9a1b61e337470f805550/CHANGELOG.md
  // https://code.claude.com/docs/en/model-config#model-aliases
  const add = (
    value: unknown,
    source: TerminalModelSelection['source'],
    label?: unknown,
    expiresAt?: number,
  ) => {
    const parsed = terminalModelValueSchema.safeParse(value);
    if (
      !parsed.success ||
      options.length >= 128 ||
      options.some((option) => option.selection.value === parsed.data)
    )
      return;
    options.push({
      label:
        typeof label === 'string' && /^[^\p{Cc}\p{Cf}]{1,160}$/u.test(label) ? label : parsed.data,
      selection: { value: parsed.data, source, files, ...(expiresAt ? { expiresAt } : {}) },
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
        const data: unknown = JSON.parse(text);
        const cache = z
          .object({
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
          })
          .parse(data);
        const fetchedAt = Date.parse(cache.fetched_at);
        const expiresAt = fetchedAt + 300_000;
        if (fetchedAt > Date.now() || expiresAt <= Date.now()) continue;
        for (const model of cache.models)
          if (model.visibility === 'list')
            add(model.slug, 'cli-cache', model.display_name, expiresAt);
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
          const configured = z
            .object({
              provider: z
                .record(
                  z.string(),
                  z.object({ models: z.record(z.string(), z.unknown()).optional() }),
                )
                .optional(),
            })
            .parse(JSON.parse(text));
          for (const [providerId, configuration] of Object.entries(configured.provider ?? {}))
            for (const modelId of Object.keys(configuration.models ?? {}))
              add(`${providerId}/${modelId}`, 'native-config');
        }
      }
    } catch {
      /* Unknown CLI configuration remains CLI-owned; never fabricate a catalogue. */
    }
  }
  return {
    limited,
    options: options.map((option) => ({
      ...option,
      id: terminalDigest(JSON.stringify([provider, option.selection])),
    })),
  };
}
