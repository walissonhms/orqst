import {
  cliProviderIdentities,
  type CliSignatureVerifier,
} from '../../../packages/core/src/terminal/cli-signature.js';

/** Native-parent-only transport. An unavailable or non-boolean reply never establishes trust. */
export function tauriCliSignatureVerifier(
  ask: (request: object) => Promise<string | boolean | null>,
): CliSignatureVerifier {
  return {
    async verify(provider, path) {
      const accepted = await ask({ kind: 'cli-signature', provider, path });
      if (accepted !== true) return;
      return { valid: true, ...cliProviderIdentities[provider] };
    },
  };
}
