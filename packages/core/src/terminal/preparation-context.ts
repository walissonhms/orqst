import { lstatSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { readTerminalWorkspace } from '@orqst/database';
import { stableId } from '@orqst/shared';
import { terminalDirectory } from './codex-profile.js';
import { featureConfigurationDatabase } from './feature-configuration.js';

const path = z.string().startsWith('/').min(1).max(2048);
/** Delivered by the owned native process, never copied from a renderer request. */
export const terminalPreparationContextSchema = z.strictObject({
  observerDatabase: path,
  preferencesDirectory: path,
});
export type TerminalPreparationContext = z.infer<typeof terminalPreparationContextSchema>;

export function resolveTerminalPreparationContext(
  trusted: TerminalPreparationContext,
  workspaceId: string,
  featureId: string | null,
) {
  terminalPreparationContextSchema.parse(trusted);
  // Bounded metadata validation without reading/copying captured session content.
  const db = lstatSync(trusted.observerDatabase);
  if (
    !db.isFile() ||
    db.isSymbolicLink() ||
    db.uid !== process.getuid?.() ||
    db.mode & 0o077 ||
    db.nlink !== 1 ||
    db.size > 2 * 1024 * 1024 * 1024 ||
    realpathSync(trusted.observerDatabase) !== trusted.observerDatabase
  )
    throw new Error('Unsafe workspace catalogue');
  terminalDirectory(dirname(trusted.observerDatabase), true);
  terminalDirectory(trusted.preferencesDirectory, true);
  const project = readTerminalWorkspace(trusted.observerDatabase, workspaceId);
  terminalDirectory(project);
  if (stableId('workspace', project) !== workspaceId) throw new Error('Workspace identity changed');
  const after = lstatSync(trusted.observerDatabase);
  if (db.ino !== after.ino || db.dev !== after.dev) throw new Error('Workspace catalogue changed');
  const features = featureConfigurationDatabase(trusted.preferencesDirectory, workspaceId);
  const view = features.readView();
  if (view.featureId !== featureId) throw new Error('Selected Feature changed');
  const feature = featureId === null ? null : features.read(featureId);
  if (feature?.status === 'archived') throw new Error('Selected Feature is archived');
  const directory = lstatSync(project);
  const fence = JSON.stringify([
    workspaceId,
    featureId,
    view.revision,
    feature?.status ?? null,
    directory.dev,
    directory.ino,
    db.dev,
    db.ino,
  ]);
  return { project, feature, features, fence };
}

export const terminalPreparationBindingSchema = terminalPreparationContextSchema.extend({
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/),
  featureId: z.uuid().nullable(),
  fence: z.string().min(1).max(4096),
});
export type TerminalPreparationBinding = z.infer<typeof terminalPreparationBindingSchema>;
export function validateTerminalPreparationBinding(
  binding: TerminalPreparationBinding | undefined,
  project: string,
) {
  if (!binding) return;
  terminalPreparationBindingSchema.parse(binding);
  const current = resolveTerminalPreparationContext(
    {
      observerDatabase: binding.observerDatabase,
      preferencesDirectory: binding.preferencesDirectory,
    },
    binding.workspaceId,
    binding.featureId,
  );
  // View changes never terminate or move existing processes. New launches require a fresh picker.
  if (current.project !== project || current.fence !== binding.fence)
    throw new Error('Workspace or Feature changed; reload terminal preparation');
}
