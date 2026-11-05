import { execFileSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { CliContractProvider } from './cli-contract.js';
import { cliProviderIdentities, type CliSignatureVerifier } from './cli-signature.js';

/** The system verifier is invoked directly; it never runs the provider executable. */
export function verifySystemCliSignature(
  provider: CliContractProvider,
  executable: string,
): boolean {
  if (
    process.platform !== 'darwin' ||
    !isAbsolute(executable) ||
    executable.length > 2048 ||
    executable.includes('\0')
  )
    return false;
  const { teamId, identifier } = cliProviderIdentities[provider];
  const requirement = `anchor apple generic and identifier "${identifier}" and certificate leaf[subject.OU] = "${teamId}"`;
  try {
    execFileSync(
      '/usr/bin/codesign',
      ['--verify', '--strict', '--all-architectures', `-R=${requirement}`, executable],
      {
        env: { PATH: '/usr/bin:/bin', LANG: 'C' },
        stdio: 'ignore',
        timeout: 3000,
        killSignal: 'SIGKILL',
        shell: false,
      },
    );
    return true;
  } catch {
    return false;
  }
}

export const systemCliSignatureVerifier: CliSignatureVerifier = Object.freeze({
  async verify(provider: CliContractProvider, executable: string) {
    if (!verifySystemCliSignature(provider, executable)) return;
    return { valid: true, ...cliProviderIdentities[provider] };
  },
});
