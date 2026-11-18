// Passive local candidates only. Nothing here invokes a runtime, CLI, shell or provider.
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  discoverLocalClis,
  type LocalCliDiscovery,
  type LocalCliProvider,
} from '../../../packages/core/src/terminal/local-cli.js';
import { localCliPathDirectories } from '../../../packages/core/src/terminal/local-cli-path.js';
import {
  terminalExecutableSha256,
  cachedTerminalExecutableSha256,
  terminalFile,
} from '../../../packages/core/src/terminal/codex-profile.js';
import { reviewedProviderMcpBinaries } from '../../../packages/core/src/terminal/provider-mcp-config.js';
import {
  reviewedAntigravityBinary,
  reviewedClaudeTuiBinary,
} from '../../../packages/core/src/terminal/interactive-profile.js';
import { reviewedDesktopCodexBinaries } from './terminal-creation.js';

function inspectDiscovery(
  discovery: LocalCliDiscovery,
  pins: readonly { sha256: string }[],
  verify: (path: string) => string,
): {
  executables: string[];
  refusal: 'executable_not_found' | 'executable_unreviewed' | 'executable_inspection_failed';
} {
  const executables: string[] = [];
  let failed = discovery.lookup === 'incomplete';
  for (const { canonical } of discovery.candidates) {
    try {
      const sha256 = verify(canonical);
      if (!pins.some((pin) => pin.sha256 === sha256)) continue;
    } catch {
      failed = true;
      continue;
    }
    executables.push(canonical);
    // Providers without manual path pickers select the first reviewed PATH candidate.
    if (discovery.provider === 'opencode' || discovery.provider === 'antigravity') break;
  }
  const refusal = failed
    ? 'executable_inspection_failed'
    : discovery.candidates.length
      ? 'executable_unreviewed'
      : 'executable_not_found';
  return { executables, refusal };
}

export function inspectReviewedExecutables(
  provider: LocalCliProvider,
  searchPath: string,
  home: string | undefined,
  pins: readonly { sha256: string }[],
  verify = cachedTerminalExecutableSha256,
): ReturnType<typeof inspectDiscovery> {
  try {
    const [discovery] = discoverLocalClis(searchPath, home, [], [provider]);
    return inspectDiscovery(discovery!, pins, verify);
  } catch {
    return { executables: [], refusal: 'executable_inspection_failed' };
  }
}

function reviewedPins(provider: LocalCliProvider) {
  switch (provider) {
    case 'codex':
      return reviewedDesktopCodexBinaries;
    case 'claude':
      return [reviewedClaudeTuiBinary];
    case 'antigravity':
      return [reviewedAntigravityBinary];
    case 'opencode':
      return [reviewedProviderMcpBinaries.opencode];
  }
}

export function inspectTerminalExecutables(
  provider: LocalCliProvider,
  searchPath: string,
  home: string,
) {
  return inspectReviewedExecutables(provider, searchPath, home, reviewedPins(provider));
}

export function inspectCatalogExecutables(
  providers: readonly LocalCliProvider[],
  searchPath: string,
  home: string,
) {
  try {
    return discoverLocalClis(searchPath, home, [], [...new Set(providers)]).map((entry) => ({
      provider: entry.provider,
      ...inspectDiscovery(entry, reviewedPins(entry.provider), cachedTerminalExecutableSha256),
    }));
  } catch {
    return [...new Set(providers)].map((provider) => ({
      provider,
      executables: [],
      refusal: 'executable_inspection_failed' as const,
    }));
  }
}

export function discoverTerminalExecutable(
  provider: LocalCliProvider,
  searchPath: string,
  home: string,
): string[] {
  return inspectTerminalExecutables(provider, searchPath, home).executables;
}

export function discoverTerminalNode(searchPath: string, home: string): string[] {
  // The existing installer receipt is evidence of a previously checked Node 24, not a fresh run.
  const runtime = join(home, '.local/share/orqst/toolchain');
  try {
    const receipt: unknown = JSON.parse(
      terminalFile(join(runtime, 'runtime.json'), true).toString('utf8'),
    );
    const node = join(runtime, 'bin/node');
    if (
      receipt &&
      typeof receipt === 'object' &&
      /^v24\./.test(String(Reflect.get(receipt, 'nodeVersion'))) &&
      Reflect.get(receipt, 'nodeSha256') === terminalExecutableSha256(node)
    )
      return [node];
  } catch {
    /* Fall through to bounded PATH metadata; the native review still discloses the hash. */
  }
  const candidates = new Set<string>();
  for (const { path } of localCliPathDirectories(searchPath, home).directories) {
    if (candidates.size >= 16) break;
    try {
      const node = realpathSync(join(path, 'node'));
      terminalExecutableSha256(node);
      candidates.add(node);
    } catch {
      /* Missing, untrusted or shim candidates are not offered. */
    }
  }
  return [...candidates];
}
