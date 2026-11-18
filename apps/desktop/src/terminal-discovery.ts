// Discovery inspects local evidence. Only the native acceptance path can probe a CLI version.
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
import {
  cliPublisherIdentities,
  hasCliExecutableReview,
  inspectCliSignature,
  publishCliExecutableReview,
  readCliExecutableReview,
  signatureContinuity,
  type CliExecutableReview,
} from '../../../packages/core/src/terminal/cli-executable-review.js';
import { probeCliVersion } from '../../../packages/core/src/terminal/cli-version-probe.js';
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

export interface TerminalCliCandidate {
  provider: LocalCliProvider;
  path: string;
  sha256: string;
  decision: 'exact' | 'automatic' | 'review';
  version?: string;
  previous?: CliExecutableReview;
  baseline?: CliExecutableReview;
}

function reviewedBaseline(provider: LocalCliProvider, candidate: { path: string }) {
  // The legacy agy audit links the exact path, pin and Google identifier. It
  // did not capture a ticket verdict, so this migration requires notarization.
  if (provider === 'antigravity' && candidate.path === '/Users/walissonhmsouza/.local/bin/agy')
    return {
      ...reviewedAntigravityBinary,
      path: candidate.path,
      source: 'packaged_pin',
      signature: { ...cliPublisherIdentities.antigravity, notarized: true },
    } satisfies CliExecutableReview;
}

export function inspectCliCandidate(
  provider: LocalCliProvider,
  path: string,
  preferences: string,
): TerminalCliCandidate {
  const sha256 = cachedTerminalExecutableSha256(path);
  const candidate = { provider, path, sha256 };
  const previous = readCliExecutableReview(preferences, provider);
  const baseline = previous ?? reviewedBaseline(provider, candidate);
  const pin = reviewedPins(provider).find((pin) => pin.sha256 === sha256);
  if (previous?.path === path && previous.sha256 === sha256) {
    if (
      previous.source !== 'signature_continuity' ||
      hasCliExecutableReview(provider, {
        executable: candidate,
        executableVersion: previous.version,
        preparation: { preferencesDirectory: preferences },
      })
    )
      return { ...candidate, decision: 'exact', version: previous.version, previous };
  } else if (!previous && pin) {
    return { ...candidate, decision: 'exact', version: pin.version };
  }
  if (
    baseline?.signature &&
    baseline.path === path &&
    signatureContinuity(
      baseline,
      candidate,
      inspectCliSignature(provider, candidate, baseline.signature.notarized),
    )
  )
    return { ...candidate, decision: 'automatic', previous, baseline };
  return { ...candidate, decision: 'review', previous };
}

export async function acceptCliCandidate(
  candidate: TerminalCliCandidate,
  preferences: string,
  current: () => boolean,
  check: () => Promise<boolean>,
): Promise<CliExecutableReview | undefined> {
  const { provider, path, sha256, previous, baseline, decision } = candidate;
  if (
    !current() ||
    JSON.stringify(inspectCliCandidate(provider, path, preferences)) !== JSON.stringify(candidate)
  )
    throw new Error('CLI selection changed');
  if (decision === 'exact' && previous) return previous;
  const signature = inspectCliSignature(provider, candidate, true);
  if (
    decision === 'automatic' &&
    (!baseline || !signatureContinuity(baseline, candidate, signature))
  )
    throw new Error('CLI publisher continuity changed');
  // An exact packaged pin seeds the baseline only when the actual binary is signed.
  if (decision === 'exact' && !signature) return;
  const version =
    candidate.version ?? (await probeCliVersion(provider, path, sha256, current, check));
  if (
    !(await check()) ||
    !current() ||
    JSON.stringify(inspectCliCandidate(provider, path, preferences)) !== JSON.stringify(candidate)
  )
    throw new Error('CLI selection changed during review');
  const accepted: CliExecutableReview = {
    path,
    sha256,
    version,
    // An exact review can allow this digest without lowering a previous notarization floor.
    signature: previous?.signature?.notarized && !signature?.notarized ? undefined : signature,
    source:
      decision === 'automatic'
        ? 'signature_continuity'
        : decision === 'review'
          ? 'native_review'
          : 'packaged_pin',
    ...(baseline ? { previousSha256: baseline.sha256 } : {}),
  };
  publishCliExecutableReview(preferences, provider, previous, accepted);
  return accepted;
}

export function inspectCatalogExecutables(
  providers: readonly LocalCliProvider[],
  searchPath: string,
  home: string,
  preferences: string,
) {
  return discoverLocalClis(searchPath, home, [], [...new Set(providers)]).map((entry) => {
    const choices: TerminalCliCandidate[] = [];
    let failed = entry.lookup === 'incomplete';
    for (const { canonical } of entry.candidates) {
      try {
        choices.push(inspectCliCandidate(entry.provider, canonical, preferences));
      } catch {
        failed = true;
      }
    }
    const available = choices.filter((candidate) => candidate.decision !== 'review');
    const reviewed =
      entry.provider === 'opencode' || entry.provider === 'antigravity'
        ? available.slice(0, 1)
        : available;
    const candidate =
      reviewed.length === 1
        ? reviewed[0]
        : !reviewed.length && choices.length === 1
          ? choices[0]
          : undefined;
    return {
      provider: entry.provider,
      executables: reviewed.map(({ path }) => path),
      candidate,
      refusal: failed
        ? ('executable_inspection_failed' as const)
        : choices.length > 1
          ? ('ambiguous_executable' as const)
          : choices.length
            ? ('executable_unreviewed' as const)
            : ('executable_not_found' as const),
    };
  });
}
