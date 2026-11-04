// Synthetic process metadata only. No Tauri, provider, credentials or user app is launched.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertNoResidentCoexistenceApp } from '../scripts/tauri/coexistence-preflight.js';

test(
  'native coexistence refuses resident identities even in a different app copy',
  {
    skip: process.platform !== 'darwin',
  },
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-synthetic-preflight-')));
    const identity = `dev.orqst.coexistencetest${process.pid}`;
    const makeApp = async (name: string, identifier: string) => {
      const app = join(root, `${name}.app`);
      await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
      await writeFile(
        join(app, 'Contents/Info.plist'),
        JSON.stringify({ CFBundleIdentifier: identifier }),
      );
      return app;
    };
    const resident = await makeApp('Synthetic resident with spaces', identity);
    const copy = await makeApp('Synthetic second copy', identity);
    const separate = await makeApp('Synthetic unrelated identity', `${identity}other`);
    const executable = join(resident, 'Contents/MacOS/orqst-desktop');
    await copyFile('/bin/sleep', executable);
    const child = spawn(executable, ['30'], { stdio: 'ignore' });
    const exited = once(child, 'exit');
    try {
      await once(child, 'spawn');
      for (const app of [resident, copy]) {
        assert.throws(() => assertNoResidentCoexistenceApp(app, identity), /already running/);
      }
      assertNoResidentCoexistenceApp(separate, `${identity}other`);
      assert.equal(child.exitCode, null);
      assert.equal(child.signalCode, null);
      assert.equal(child.killed, false);
    } finally {
      child.kill('SIGTERM');
      await exited;
      await rm(root, { recursive: true, force: true });
    }
    // A stale single-instance socket is irrelevant: only a live process blocks the fixture.
    assertNoResidentCoexistenceApp(copy, identity);
  },
);
