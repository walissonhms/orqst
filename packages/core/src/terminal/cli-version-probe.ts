import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findCliContract, type CliContractMode, type CliContractProvider } from './cli-contract.js';
import { terminalExecutableSha256 } from './codex-profile.js';
import { verifiedCliSignature, type CliSignatureVerifier } from './cli-signature.js';

function runVersion(executable: string, home: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--version'], {
      cwd: home,
      env: { HOME: home, TMPDIR: home, PATH: '/usr/bin:/bin', LANG: 'C' },
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let settled = false;
    const stop = () => {
      if (child.pid && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Already exited. */
        }
      }
      try {
        child.kill('SIGKILL');
      } catch {
        /* Already exited. */
      }
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('CLI version probe timed out')), 3000);
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4096) return fail(new Error('CLI version output exceeds limit'));
      target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.stdout.once('error', fail);
    child.stderr.once('error', fail);
    child.once('error', fail);
    child.once('close', (code) => {
      if (settled) return;
      if (code !== 0) return fail(new Error('CLI version probe failed'));
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

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
  beforeSpawn: () => Promise<boolean> = async () => false,
) {
  const hash = terminalExecutableSha256(executable);
  const signature = await verifiedCliSignature(verifier, provider, executable);
  if (terminalExecutableSha256(executable) !== hash)
    throw new Error('CLI changed before version probe');
  const home = await mkdtemp(join(tmpdir(), 'orqst-cli-probe-'));
  try {
    if (!(await beforeSpawn())) throw new Error('CLI probe authorization expired');
    const result = await runVersion(executable, home);
    const version = parseVersion(provider, result.stdout);
    if (!version || result.stderr || !findCliContract(provider, mode, version))
      throw new Error('Unknown or unsupported CLI version');
    if (terminalExecutableSha256(executable) !== hash)
      throw new Error('CLI changed during version probe');
    await verifiedCliSignature(verifier, provider, executable);
    if (terminalExecutableSha256(executable) !== hash)
      throw new Error('CLI changed after signature verification');
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
