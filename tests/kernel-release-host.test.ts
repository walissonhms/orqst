import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

test('private recovery helper reports missing admission without running a provider', async () => {
  if (process.platform !== 'darwin') return;
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-kernel-host-')));
  const script = join(parent, 'synthetic-host.cjs');
  try {
    await build({
      entryPoints: ['apps/desktop/src/tauri-kernel-release-host.ts'],
      outfile: script,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      bundle: true,
    });
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [script, parent], { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (text: string) => (output += text));
      child.once('error', reject);
      child.once('exit', (code) => resolve({ code, output }));
    });
    assert.equal(result.code, 1);
    assert.deepEqual(JSON.parse(result.output), {
      kind: 'complete',
      ok: false,
      reason: 'unavailable',
      processes: [],
    });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
