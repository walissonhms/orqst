import { terminalExecutableSha256 } from './codex-profile.js';
import { probeSignedCliVersion } from './cli-version-probe.js';
import {
  exactCliContracts,
  type CliContractMode,
  type CliContractProvider,
} from './cli-contract.js';
import {
  verifiedCliSignature,
  type CliSignatureVerifier,
  type CliSignatureEvidence,
} from './cli-signature.js';
import type { TerminalProfile } from './supervisor.js';
import {
  TerminalCliPolicyStore,
  type TerminalCliCandidateSnapshot,
  type TerminalCliEvidence,
} from './cli-authorization.js';

export interface CliCandidateInput {
  store: TerminalCliPolicyStore;
  provider: CliContractProvider;
  mode: CliContractMode;
  executable: string;
  verifier: CliSignatureVerifier;
  profile(version: string, sha256: string): TerminalProfile;
  expectedEpoch?: string;
  expectedVersion?: string;
  expectedSha256?: string;
  probe?: (
    verifier: CliSignatureVerifier,
    provider: CliContractProvider,
    mode: CliContractMode,
    executable: string,
  ) => Promise<TerminalCliEvidence>;
}

export interface CliCandidateDisclosure {
  readonly provider: CliContractProvider;
  readonly mode: CliContractMode;
  readonly executable: string;
  readonly sha256: string;
  readonly signature: CliSignatureEvidence;
  readonly snapshot: TerminalCliCandidateSnapshot;
  readonly environmentProfile: string;
  readonly cliAuthorizationScope: string | undefined;
  readonly expectedEpoch: string | undefined;
  readonly currentVersion: null;
  readonly contracts: ReturnType<typeof exactCliContracts>;
}

export interface CliExistingDisclosure {
  readonly alreadyAuthorized: true;
  readonly executable: string;
  readonly version: string;
  readonly binding: Allowed['binding'];
}

type Allowed = {
  status: 'allowed';
  profile: TerminalProfile;
  epoch: string;
  binding: NonNullable<Awaited<ReturnType<TerminalCliPolicyStore['verifiedBinding']>>>;
};
type Pending = {
  input: CliCandidateInput;
  profile(version: string): TerminalProfile;
  disclosure: CliCandidateDisclosure;
};
type Candidate = { input: CliCandidateInput; existing: Allowed } | { pending: Pending };

/** Capture all candidates before a single native conditional review. */
export async function prepareCliCandidate(input: CliCandidateInput): Promise<Candidate> {
  const sha256 = terminalExecutableSha256(input.executable);
  if (input.expectedSha256 && input.expectedSha256 !== sha256)
    throw new Error('CLI manifest executable changed');
  const profile = (version: string) => {
    const value = input.profile(version, sha256);
    if (
      value.executable !== input.executable ||
      value.executableSha256 !== sha256 ||
      value.executableVersion !== version
    )
      throw new Error('CLI profile mismatch');
    return Object.freeze({ ...value, argv: Object.freeze([...value.argv]) });
  };
  const candidate = profile('');
  const previousVersion = input.store.candidateVersion(candidate, input.provider, input.mode);
  if (previousVersion) {
    const existing = profile(previousVersion);
    const binding = await input.store.verifiedBinding(
      existing,
      input.provider,
      input.mode,
      input.verifier,
    );
    if (
      binding &&
      (!input.expectedEpoch || input.expectedEpoch === binding.authorizationEpoch) &&
      (!input.expectedVersion || input.expectedVersion === previousVersion)
    )
      return {
        input,
        existing: {
          status: 'allowed',
          profile: existing,
          epoch: binding.authorizationEpoch,
          binding,
        },
      };
  }
  const signature = await verifiedCliSignature(input.verifier, input.provider, input.executable);
  const snapshot = input.store.candidateSnapshot(candidate, input.provider);
  const contracts = exactCliContracts(input.provider, input.mode);
  if (!contracts.length) throw new Error('CLI contract unavailable');
  const disclosure = Object.freeze({
    provider: input.provider,
    mode: input.mode,
    executable: input.executable,
    sha256,
    signature,
    snapshot,
    environmentProfile: candidate.environmentProfile,
    cliAuthorizationScope: candidate.cliAuthorizationScope,
    expectedEpoch: input.expectedEpoch,
    currentVersion: null,
    contracts,
  });
  return { pending: { input, profile, disclosure } };
}

/** The callback is a trusted native authority check, never renderer-provided state. */
async function authorizePreparedCli(pending: Pending, current: () => Promise<boolean>) {
  const { input, profile, disclosure } = pending;
  const candidate = profile('');
  const stable = async () => {
    if (!input.store.candidateSnapshotCurrent(candidate, input.provider, disclosure.snapshot))
      return false;
    const signature = await verifiedCliSignature(input.verifier, input.provider, input.executable);
    return (
      JSON.stringify(signature) === JSON.stringify(disclosure.signature) &&
      input.store.candidateSnapshotCurrent(candidate, input.provider, disclosure.snapshot) &&
      (await current())
    );
  };
  if (!(await stable())) return { status: 'revoked' as const };
  const evidence: TerminalCliEvidence = input.probe
    ? await input.probe(input.verifier, input.provider, input.mode, input.executable)
    : await probeSignedCliVersion(
        input.verifier,
        input.provider,
        input.mode,
        input.executable,
        stable,
      ).then((result) => ({
        provider: input.provider,
        mode: input.mode,
        version: result.version,
        contractRevision: result.contract.revision,
        sha256: result.sha256,
        signature: result.signature,
      }));
  if (
    !(await stable()) ||
    evidence.provider !== input.provider ||
    evidence.mode !== input.mode ||
    evidence.sha256 !== disclosure.sha256 ||
    (input.expectedVersion !== undefined && evidence.version !== input.expectedVersion) ||
    JSON.stringify(evidence.signature) !== JSON.stringify(disclosure.signature) ||
    !disclosure.contracts.some(
      (entry) =>
        entry.version === evidence.version && entry.contractRevision === evidence.contractRevision,
    )
  )
    return { status: 'revoked' as const };
  const selected = profile(evidence.version);
  const status = await input.store.authorizeVerifiedCli(
    selected,
    input.provider,
    input.mode,
    input.verifier,
    async () => evidence,
    async () => true,
    input.expectedEpoch,
    { snapshot: disclosure.snapshot, current },
  );
  if (status !== 'allowed') return { status };
  const binding = await input.store.verifiedBinding(
    selected,
    input.provider,
    input.mode,
    input.verifier,
  );
  return binding
    ? { status: 'allowed' as const, profile: selected, epoch: binding.authorizationEpoch, binding }
    : { status: 'revoked' as const };
}

export async function authorizeCliCandidates(
  inputs: readonly CliCandidateInput[],
  review: (
    details: readonly CliCandidateDisclosure[],
    existing: readonly CliExistingDisclosure[],
  ) => Promise<boolean>,
  current: () => Promise<boolean>,
  now: () => number = () => performance.now(),
) {
  const candidates: Candidate[] = [];
  for (const input of inputs) candidates.push(await prepareCliCandidate(input));
  return authorizePreparedGroup(candidates, review, current, now);
}

/** The reviewed set and its ephemeral authority stay inside this transaction. */
export async function authorizePreparedGroup(
  candidates: readonly Candidate[],
  review: (
    details: readonly CliCandidateDisclosure[],
    existing: readonly CliExistingDisclosure[],
  ) => Promise<boolean>,
  current: () => Promise<boolean>,
  now: () => number = () => performance.now(),
) {
  if (!(await current())) return candidates.map(() => ({ status: 'blocked' as const }));
  const pending = candidates.flatMap((candidate) =>
    'pending' in candidate ? [candidate.pending] : [],
  );
  const expires = now() + 30_000;
  const leaseCurrent = async () => now() < expires && (await current()) && now() < expires;
  if (
    pending.length &&
    (!(await leaseCurrent()) ||
      !(await review(
        Object.freeze(pending.map((entry) => entry.disclosure)),
        Object.freeze(
          candidates.flatMap((entry) =>
            'existing' in entry
              ? [
                  Object.freeze({
                    alreadyAuthorized: true as const,
                    executable: entry.existing.profile.executable,
                    version: entry.existing.profile.executableVersion,
                    binding: Object.freeze({ ...entry.existing.binding }),
                  }),
                ]
              : [],
          ),
        ),
      )) ||
      !(await leaseCurrent()))
  )
    return candidates.map(() => ({ status: 'blocked' as const }));
  const results = [];
  for (const candidate of candidates) {
    let result: Allowed | { status: 'blocked' | 'revoked' | 'stale' };
    if ('existing' in candidate) {
      const { input, existing } = candidate;
      const binding = await input.store.verifiedBinding(
        existing.profile,
        input.provider,
        input.mode,
        input.verifier,
      );
      if (!(await leaseCurrent()) || JSON.stringify(binding) !== JSON.stringify(existing.binding))
        return candidates.map(() => ({ status: 'stale' as const }));
      result = existing;
    } else {
      result = await authorizePreparedCli(candidate.pending, leaseCurrent);
    }
    if (result.status !== 'allowed') return candidates.map(() => ({ status: result.status }));
    results.push(result);
  }
  return results;
}

export async function authorizeCliCandidate(
  input: CliCandidateInput & {
    review(details: readonly CliCandidateDisclosure[]): Promise<boolean>;
    current(): Promise<boolean>;
  },
) {
  return (await authorizeCliCandidates([input], input.review, input.current))[0]!;
}
