import { terminalDigest } from '../../packages/core/src/terminal/authority.js';
import { cliAuthorizationScope } from '../../packages/core/src/terminal/cli-authorization-scope.js';
import { TerminalCliPolicyStore } from '../../packages/core/src/terminal/cli-authorization.js';
import type {
  CliContractMode,
  CliContractProvider,
} from '../../packages/core/src/terminal/cli-contract.js';
import type { CliSignatureVerifier } from '../../packages/core/src/terminal/cli-signature.js';
import { systemCliSignatureVerifier } from '../../packages/core/src/terminal/cli-system-signature.js';

/** Provisioning cannot create a grant or run a provider; native authorization must already exist. */
export async function requireCliGrant(input: {
  directory: string;
  provider: CliContractProvider;
  mode: CliContractMode;
  executable: string;
  version: string;
  sha256: string;
  project: string;
  verifier?: CliSignatureVerifier;
}) {
  const profile = {
    id: `${input.provider}-terminal-v1`,
    projectId: terminalDigest(input.project),
    executable: input.executable,
    executableVersion: input.version,
    executableSha256: input.sha256,
    argv: [],
    cwd: input.project,
    permissions: 'Native owned terminal CLI authorization',
    ...cliAuthorizationScope(input.provider, input.mode),
  };
  const binding = await new TerminalCliPolicyStore(input.directory).verifiedBinding(
    profile,
    input.provider,
    input.mode,
    input.verifier ?? systemCliSignatureVerifier,
  );
  if (!binding)
    throw new Error('No current CLI authorization; authorize this executable in Desktop first');
  return binding;
}
