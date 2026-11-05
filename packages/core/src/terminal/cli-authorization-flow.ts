import { terminalExecutableSha256 } from './codex-profile.js';
import { probeSignedCliVersion } from './cli-version-probe.js';
import type { CliContractMode, CliContractProvider } from './cli-contract.js';
import { verifiedCliSignature, type CliSignatureVerifier } from './cli-signature.js';
import type { TerminalProfile } from './supervisor.js';
import {
  TerminalCliPolicyStore,
  type TerminalCliEvidence,
  type TerminalCliReview,
} from './cli-authorization.js';

/** Native authorization transaction; the version probe is never part of discovery. */
export async function authorizeCliCandidate(input: {
  store: TerminalCliPolicyStore;
  provider: CliContractProvider;
  mode: CliContractMode;
  executable: string;
  verifier: CliSignatureVerifier;
  profile(version: string, sha256: string): TerminalProfile;
  review(details: TerminalCliReview): Promise<boolean>;
  expectedEpoch?: string;
  probe?: (
    verifier: CliSignatureVerifier,
    provider: CliContractProvider,
    mode: CliContractMode,
    executable: string,
  ) => Promise<TerminalCliEvidence>;
}) {
  const sha256 = terminalExecutableSha256(input.executable);
  const checkedProfile = (version: string) => {
    const profile = input.profile(version, sha256);
    if (
      profile.executable !== input.executable ||
      profile.executableSha256 !== sha256 ||
      profile.executableVersion !== version
    )
      throw new Error('CLI profile mismatch');
    return profile;
  };
  const candidate = checkedProfile('');
  const previousVersion = input.store.candidateVersion(candidate, input.provider, input.mode);
  if (previousVersion) {
    const profile = checkedProfile(previousVersion);
    const binding = await input.store.verifiedBinding(
      profile,
      input.provider,
      input.mode,
      input.verifier,
    );
    if (binding && (!input.expectedEpoch || input.expectedEpoch === binding.authorizationEpoch))
      return { status: 'allowed' as const, profile, epoch: binding.authorizationEpoch, binding };
  }
  await verifiedCliSignature(input.verifier, input.provider, input.executable);
  if (terminalExecutableSha256(input.executable) !== sha256)
    throw new Error('CLI changed before version probe');
  const evidence: TerminalCliEvidence = input.probe
    ? await input.probe(input.verifier, input.provider, input.mode, input.executable)
    : await probeSignedCliVersion(
        input.verifier,
        input.provider,
        input.mode,
        input.executable,
      ).then((result) => ({
        provider: input.provider,
        mode: input.mode,
        version: result.version,
        contractRevision: result.contract.revision,
        sha256: result.sha256,
        signature: result.signature,
      }));
  if (evidence.sha256 !== sha256) throw new Error('CLI changed during authorization');
  const profile = checkedProfile(evidence.version);
  const status = await input.store.authorizeVerifiedCli(
    profile,
    input.provider,
    input.mode,
    input.verifier,
    async () => evidence,
    input.review,
    input.expectedEpoch,
  );
  if (status !== 'allowed') return { status };
  const binding = await input.store.verifiedBinding(
    profile,
    input.provider,
    input.mode,
    input.verifier,
  );
  return binding
    ? { status: 'allowed' as const, profile, epoch: binding.authorizationEpoch, binding }
    : { status: 'revoked' as const };
}
