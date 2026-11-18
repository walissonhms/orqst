import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LocalCliProvider } from './local-cli.js';
import { terminalExecutableSha256 } from './codex-profile.js';
import { cliExecutableVersion } from './cli-executable-review.js';

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

function parseVersion(provider: LocalCliProvider, output: string): string | undefined {
  const pattern =
    provider === 'codex'
      ? /^codex-cli (\d+\.\d+\.\d+)\n?$/
      : provider === 'claude'
        ? /^(\d+\.\d+\.\d+) \(Claude Code\)\n?$/
        : provider === 'antigravity'
          ? /^(?:(?:agy|antigravity|Antigravity CLI)(?: version)? )?(\d+\.\d+\.\d+)\n?$/
          : /^(\d+\.\d+\.\d+)\n?$/;
  return pattern.exec(output)?.[1];
}

// Adapted from ORQST 4ad5e36. Call only after native consent or signature continuity.
export async function probeCliVersion(
  provider: LocalCliProvider,
  executable: string,
  sha256: string,
  current: () => boolean,
  check: () => Promise<boolean>,
): Promise<string> {
  if (!current() || terminalExecutableSha256(executable) !== sha256)
    throw new Error('CLI probe authorization expired or executable changed');
  const home = await mkdtemp(join(tmpdir(), 'orqst-cli-probe-'));
  try {
    if (!(await check()) || !current() || terminalExecutableSha256(executable) !== sha256)
      throw new Error('CLI probe authorization expired or executable changed');
    const { stdout, stderr } = await runVersion(executable, home);
    const version = parseVersion(provider, stdout);
    if (!version || stderr || !current() || terminalExecutableSha256(executable) !== sha256)
      throw new Error('CLI version evidence unavailable');
    return cliExecutableVersion.parse(version);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
