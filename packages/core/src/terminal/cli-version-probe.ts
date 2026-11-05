import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { findCliContract, type CliContractMode, type CliContractProvider } from './cli-contract.js';
import { terminalExecutableSha256 } from './codex-profile.js';
import { verifiedCliSignature, type CliSignatureVerifier } from './cli-signature.js';

const execFileAsync = promisify(execFile);

function parseVersion(provider: CliContractProvider, output: string): string | undefined {
  const pattern =
    provider === 'codex'
      ? /^codex-cli (\d+\.\d+\.\d+)\n?$/
      : provider === 'claude'
        ? /^(\d+\.\d+\.\d+) \(Claude Code\)\n?$/
        : /^(\d+\.\d+\.\d+)\n?$/;
  return pattern.exec(output)?.[1];
}

/** Call only within native CLI authorization. This executes vendor code; it is not a network sandbox. */
export async function probeSignedCliVersion(
  verifier: CliSignatureVerifier,
  provider: CliContractProvider,
  mode: CliContractMode,
  executable: string,
) {
  const hash = terminalExecutableSha256(executable);
  const signature = await verifiedCliSignature(verifier, provider, executable);
  if (terminalExecutableSha256(executable) !== hash)
    throw new Error('CLI changed before version probe');
  const home = await mkdtemp(join(tmpdir(), 'orqst-cli-probe-'));
  try {
    const result = await execFileAsync(executable, ['--version'], {
      cwd: home,
      env: { HOME: home, TMPDIR: home, PATH: '/usr/bin:/bin', LANG: 'C' },
      timeout: 3000,
      maxBuffer: 4096,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
      shell: false,
    });
    const version = parseVersion(provider, result.stdout);
    if (!version || result.stderr || !findCliContract(provider, mode, version))
      throw new Error('Unknown or unsupported CLI version');
    if (terminalExecutableSha256(executable) !== hash)
      throw new Error('CLI changed during version probe');
    await verifiedCliSignature(verifier, provider, executable);
    return {
      version,
      signature,
      sha256: hash,
      contract: findCliContract(provider, mode, version)!,
    };
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
