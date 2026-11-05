import type { CliContractProvider } from './cli-contract.js';

export interface CliSignatureEvidence {
  readonly valid: boolean;
  readonly teamId: string;
  readonly identifier: string;
}

/** The implementation is supplied by the trusted native host, never the renderer. */
export interface CliSignatureVerifier {
  verify(
    provider: CliContractProvider,
    executable: string,
  ): Promise<CliSignatureEvidence | undefined>;
}

const identities = Object.freeze({
  codex: Object.freeze({ teamId: '2DC432GLL2', identifier: 'codex' }),
  claude: Object.freeze({ teamId: 'Q6L2SF6YDW', identifier: 'com.anthropic.claude-code' }),
  opencode: Object.freeze({ teamId: '5NZ4Q7NXJ4', identifier: 'opencode' }),
});

export async function verifiedCliSignature(
  verifier: CliSignatureVerifier,
  provider: CliContractProvider,
  executable: string,
): Promise<CliSignatureEvidence> {
  const evidence = await verifier.verify(provider, executable);
  const expected = identities[provider];
  if (
    !evidence ||
    evidence.valid !== true ||
    evidence.teamId !== expected.teamId ||
    evidence.identifier !== expected.identifier
  ) {
    throw new Error('CLI provider signature unavailable or invalid');
  }
  return Object.freeze({ valid: true, teamId: evidence.teamId, identifier: evidence.identifier });
}
