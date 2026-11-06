import { lstatSync } from 'node:fs';
import { relative } from 'node:path';
import { stableId } from '@orqst/shared';
import type { TerminalEnrollmentInput } from '@orqst/protocol';
import { terminalDigest } from './authority.js';
import { terminalFile } from './codex-profile.js';
import { terminalIdentity } from './identity.js';
import { inspectManagedTerminalFiles } from './managed-files.js';
import {
  interactiveProvider,
  readInteractiveTerminalConfig,
  type InteractiveTerminalConfig,
} from './interactive-profile.js';

function inode(path: string, missing = false): string | null {
  try {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) throw new Error('Enrollment source is a symlink');
    return `${info.dev}:${info.ino}`;
  } catch (error) {
    if (missing && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Exact historical enrollment serializer. No authority or filesystem effects. */
export function terminalEnrollmentPreimage(
  config: InteractiveTerminalConfig,
  identities: readonly (string | null)[],
  source: Buffer,
  modelSources: readonly (readonly [string, string | null])[],
): string {
  return JSON.stringify([config, identities, source.toString('base64'), modelSources]);
}

/** Frozen originals are compared as metadata, never re-inspected as fresh/empty profiles. */
export function terminalEnrollmentFile(file: string, config: InteractiveTerminalConfig) {
  const paths = [file, config.state, config.project, config.executable.path, config.node.path];
  const identities = paths.map((path) => inode(path));
  const source = terminalFile(file, true);
  const modelSources =
    config.model?.files.map(({ path }): [string, string | null] => [path, inode(path, true)]) ?? [];
  const bindingDigest = terminalDigest(
    terminalEnrollmentPreimage(config, identities, source, modelSources),
  );
  return { file, config, identities, bindingDigest };
}
export type TerminalEnrollmentFile = ReturnType<typeof terminalEnrollmentFile>;

/** Includes catalogue/context validation from the existing trusted profile chain. No writes. */
export function inspectTerminalEnrollment(
  file: string,
  input: TerminalEnrollmentInput,
  existing: readonly TerminalEnrollmentFile[],
) {
  const before = inode(file);
  const selected = inspectManagedTerminalFiles([file], 1)[0]!;
  const config = selected.config;
  if (
    selected.blocker ||
    !config.identity ||
    !config.model ||
    !config.preparation ||
    !config.interactive ||
    // Only hub MCP may enroll; the disposable pair is never extended.
    (config.interactive.mcp && !config.interactive.hub)
  )
    throw new Error('Enrollment requires a prepared independent native profile');
  if (
    config.project !== existing[0]?.config.project ||
    stableId('workspace', config.project) !== input.workspaceId ||
    config.preparation.workspaceId !== input.workspaceId ||
    config.preparation.featureId !== input.featureId
  )
    throw new Error('Enrollment workspace or Feature changed');
  const candidate = terminalEnrollmentFile(file, config);
  if (candidate.identities[0] !== before) throw new Error('Enrollment manifest replaced');
  for (const member of existing) {
    if (terminalIdentity(member.config).terminalId === config.identity.terminalId)
      throw new Error('Duplicate terminal identity');
    for (const identity of candidate.identities.slice(0, 2))
      if (member.identities.slice(0, 2).includes(identity))
        throw new Error('Duplicate terminal manifest or state');
    for (const path of [
      relative(member.config.state, config.state),
      relative(config.state, member.config.state),
    ])
      if (path === '' || (path !== '..' && !path.startsWith('../')))
        throw new Error('Overlapping terminal state');
    if (
      config.version === 2 &&
      member.config.version === 2 &&
      config.sessionId === member.config.sessionId
    )
      throw new Error('Duplicate Claude session UUID');
  }
  const validate = () => {
    const current = readInteractiveTerminalConfig(file);
    if (terminalEnrollmentFile(file, current).bindingDigest !== candidate.bindingDigest)
      throw new Error('Enrollment profile or source identity changed');
  };
  validate();
  return {
    candidate,
    validate,
    member: {
      ...terminalIdentity(config),
      provider: interactiveProvider(config),
      requestedModel: config.model.value,
      workspaceId: input.workspaceId,
      featureId: input.featureId,
      bindingDigest: candidate.bindingDigest,
    },
  };
}
