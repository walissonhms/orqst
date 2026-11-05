import { createPublicKey } from 'node:crypto';
import { DesktopManagedAgents } from '../../../packages/core/src/managed-codex/desktop.js';
import {
  managedAgentsFeatureContextSchema,
  resolveManagedAgentsFeatureContext,
  type ManagedAgentsFeatureContext,
} from '../../../packages/core/src/managed-codex/feature-context.js';
import type { CodexRuntimeBackend } from '../../../packages/core/src/managed-codex/runtime.js';
import { readManagedCodexConfig } from '../../../packages/core/src/terminal/codex-profile.js';
import { terminalPreparationContextSchema } from '../../../packages/core/src/terminal/preparation-context.js';

/** Called only with the fixed native app-data paths, before the private Core fork. */
export function nativeManagedAgentsFeatureContext(
  files: [string, string],
  native: unknown,
): ManagedAgentsFeatureContext | undefined {
  // Legacy callers have no Feature authority; a bound manifest still refuses missing context.
  const trusted = native === undefined ? undefined : terminalPreparationContextSchema.parse(native);
  return resolveManagedAgentsFeatureContext(files.map(readManagedCodexConfig), trusted);
}

/** The exact argv parser/factory used by the production IPC entrypoint. */
export function managedAgentsHostComposition(
  args: string[],
  backend: CodexRuntimeBackend,
  admission: ConstructorParameters<typeof DesktopManagedAgents>[3],
) {
  if (args.length !== 4 && args.length !== 5) throw new Error('Invalid private agents bootstrap');
  const context =
    args.length === 5 ? managedAgentsFeatureContextSchema.parse(JSON.parse(args[4]!)) : undefined;
  return new DesktopManagedAgents(
    [args[0]!, args[1]!],
    createPublicKey({ key: Buffer.from(args[2]!, 'base64url'), format: 'der', type: 'spki' }),
    backend,
    admission,
    undefined,
    context,
  );
}
