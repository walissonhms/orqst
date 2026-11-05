import { lstatSync } from 'node:fs';
import { relative } from 'node:path';
import { stableId } from '@orqst/shared';
import type { TerminalEnrollmentInput } from '@orqst/protocol';
import { terminalDigest } from './authority.js';
import { cliProviderIdentities } from './cli-signature.js';
import { findCliContract } from './cli-contract.js';
import { v2CliBindingSchema } from './cli-binding.js';
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

function v2CliBinding(config: InteractiveTerminalConfig, source: Buffer) {
  let raw: unknown;
  try {
    raw = JSON.parse(source.toString('utf8'));
  } catch {
    return;
  }
  if (!raw || typeof raw !== 'object' || !('cliAuthorization' in raw)) return;
  const candidate = raw.cliAuthorization;
  // The earlier marker is not a v2 binding and remains under the historical serializer.
  if (candidate === 'local-v2') return;
  const binding = v2CliBindingSchema.parse(candidate);
  const expected = cliProviderIdentities[binding.provider];
  const provider = interactiveProvider(config);
  const mode = config.interactive?.mcp ? 'mcp' : 'tui';
  if (
    provider !== binding.provider ||
    mode !== binding.mode ||
    binding.teamId !== expected.teamId ||
    binding.identifier !== expected.identifier ||
    findCliContract(provider, mode, config.executableVersion)?.revision !== binding.contractRevision
  )
    throw new Error('Invalid v2 CLI binding identity or contract');
  const executable = (raw as { executable?: unknown }).executable;
  if (JSON.stringify(executable) !== JSON.stringify({ path: config.executable.path }))
    throw new Error('Invalid v2 CLI binding executable');
  return binding;
}

/** Historical v1 bytes remain exact; v2 excludes the mutable CLI digest and inode. */
export function terminalEnrollmentPreimage(
  config: InteractiveTerminalConfig,
  identities: readonly (string | null)[],
  source: Buffer,
  modelSources: readonly (readonly [string, string | null])[],
): string {
  const binding = v2CliBinding(config, source);
  if (!binding)
    return JSON.stringify([config, identities, source.toString('base64'), modelSources]);
  if (identities.length !== 5) throw new Error('Invalid v2 enrollment identities');
  const safeConfig = { ...config, executable: { path: config.executable.path } };
  return JSON.stringify([
    'orqst.terminal-enrollment-v2',
    safeConfig,
    [identities[0], identities[1], identities[2], null, identities[4]],
    source.toString('base64'),
    modelSources,
  ]);
}

/** Frozen originals are compared as metadata, never re-inspected as fresh/empty profiles. */
export function terminalEnrollmentFile(file: string, config: InteractiveTerminalConfig) {
  const source = terminalFile(file, true);
  const v2 = !!v2CliBinding(config, source);
  const paths = [file, config.state, config.project, config.executable.path, config.node.path];
  const identities = paths.map((path, index) => (v2 && index === 3 ? null : inode(path)));
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
    config.interactive.mcp
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
