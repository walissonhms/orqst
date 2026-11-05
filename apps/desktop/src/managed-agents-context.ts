import { createPublicKey } from 'node:crypto';
import { DesktopManagedAgents } from '../../../packages/core/src/managed-codex/desktop.js';
import {
  managedAgentsBootstrapSchema,
  readManagedAgentsPair,
  type ManagedAgentsBootstrap,
} from '../../../packages/core/src/managed-codex/feature-context.js';
import type { CodexRuntimeBackend } from '../../../packages/core/src/managed-codex/runtime.js';
import { terminalPreparationContextSchema } from '../../../packages/core/src/terminal/preparation-context.js';

/** Called only with the fixed native app-data paths, before the private Core fork. */
export function nativeManagedAgentsFeatureContext(
  files: [string, string],
  native: unknown,
): ManagedAgentsBootstrap | undefined {
  // Legacy callers have no Feature authority; a bound manifest still refuses missing context.
  const trusted = native === undefined ? undefined : terminalPreparationContextSchema.parse(native);
  const { configs, context } = readManagedAgentsPair(files, trusted);
  return configs.some((config) => config.preparation)
    ? managedAgentsBootstrapSchema.parse({ native: trusted, feature: context })
    : undefined;
}

/** The exact argv parser/factory used by the production IPC entrypoint. */
export function managedAgentsHostComposition(
  args: string[],
  backend: CodexRuntimeBackend,
  admission: ConstructorParameters<typeof DesktopManagedAgents>[3],
) {
  if (args.length !== 4 && args.length !== 5) throw new Error('Invalid private agents bootstrap');
  const context =
    args.length === 5 ? managedAgentsBootstrapSchema.parse(JSON.parse(args[4]!)) : undefined;
  return new DesktopManagedAgents(
    [args[0]!, args[1]!],
    createPublicKey({ key: Buffer.from(args[2]!, 'base64url'), format: 'der', type: 'spki' }),
    backend,
    admission,
    undefined,
    context?.feature,
    context?.native,
    context !== undefined,
  );
}
