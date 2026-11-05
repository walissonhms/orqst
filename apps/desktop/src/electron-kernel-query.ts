import { spawn } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, parse } from 'node:path';
import { z } from 'zod';
import {
  kernelProcessIdentitySchema,
  type KernelProcessIdentity,
} from '../../../packages/core/src/managed-codex/kernel-lifecycle-receipt.js';

/** Metadata-only, bounded native child. It cannot signal or mutate other processes. */
export function electronKernelQuery(executable: string) {
  if (realpathSync(executable) !== executable) throw new Error('Kernel query path unavailable');
  const file = lstatSync(executable);
  if (!file.isFile() || file.mode & 0o022 || (file.uid !== 0 && file.uid !== process.getuid?.()))
    throw new Error('Kernel query executable untrusted');
  let ancestor = dirname(executable);
  while (ancestor !== parse(ancestor).root) {
    const info = lstatSync(ancestor);
    if (info.mode & 0o022 && !(info.mode & 0o1000))
      throw new Error('Kernel query ancestor untrusted');
    ancestor = dirname(ancestor);
  }
  function request(value: object) {
    return new Promise<unknown>((resolve, reject) => {
      const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'ignore'] });
      let output = '';
      let settled = false;
      const fail = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Kernel query unavailable'));
        }
      };
      const timer = setTimeout(fail, 5000);
      timer.unref();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        output += chunk;
        if (output.length > 8192) fail();
      });
      child.on('error', fail);
      child.stdin.on('error', fail);
      child.on('exit', (code) => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        try {
          if (code !== 0) throw new Error();
          resolve(JSON.parse(output));
        } catch {
          reject(new Error('Kernel query unavailable'));
        }
      });
      child.stdin.end(JSON.stringify(value));
    });
  }
  return {
    identity: async (pid: number) =>
      kernelProcessIdentitySchema.parse(await request({ operation: 'identity', pid })),
    exists: async (identity: KernelProcessIdentity) =>
      z.boolean().parse(await request({ operation: 'exists', identity })),
  };
}
