// Passive local candidates only. Nothing here invokes a runtime, CLI, shell or provider.
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  discoverLocalClis,
  type LocalCliProvider,
} from '../../../packages/core/src/terminal/local-cli.js';
import { localCliPathDirectories } from '../../../packages/core/src/terminal/local-cli-path.js';
import {
  terminalExecutableSha256,
  cachedTerminalExecutableSha256,
  terminalFile,
} from '../../../packages/core/src/terminal/codex-profile.js';
import { reviewedProviderMcpBinaries } from '../../../packages/core/src/terminal/provider-mcp-config.js';
import { reviewedClaudeTuiBinary } from '../../../packages/core/src/terminal/interactive-profile.js';
import { reviewedDesktopCodexBinaries } from './terminal-creation.js';

export function inspectReviewedExecutables(
  provider: LocalCliProvider,
  searchPath: string,
  home: string | undefined,
  pins: readonly { sha256: string }[],
  verify = cachedTerminalExecutableSha256,
): {
  executables: string[];
  refusal: 'executable_not_found' | 'executable_unreviewed' | 'executable_inspection_failed';
} {
  let discovery;
  try {
    discovery = discoverLocalClis(searchPath, home).find((entry) => entry.provider === provider)!;
  } catch {
    return { executables: [], refusal: 'executable_inspection_failed' };
  }
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
    // OpenCode already selects the first reviewed PATH candidate, even with separate installs.
    if (provider === 'opencode') break;
  }
  const refusal = failed
    ? 'executable_inspection_failed'
    : discovery.candidates.length
      ? 'executable_unreviewed'
      : 'executable_not_found';
  return { executables, refusal };
}

export function inspectTerminalExecutables(
  provider: LocalCliProvider,
  searchPath: string,
  home: string,
) {
  const pins =
    provider === 'codex'
      ? reviewedDesktopCodexBinaries
      : provider === 'claude'
        ? [reviewedClaudeTuiBinary]
        : [reviewedProviderMcpBinaries.opencode];
  return inspectReviewedExecutables(provider, searchPath, home, pins);
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
