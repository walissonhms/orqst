// Synthetic process metadata only. No Tauri, provider, credentials or user app is launched.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertNoResidentCoexistenceApp } from '../scripts/tauri/coexistence-preflight.js';

test(
  'native coexistence refuses resident identities even in a different app copy',
  {
    skip: process.platform !== 'darwin',
  },
  async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-synthetic-preflight-')));
    t.after(() => rm(root, { recursive: true, force: true }));
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
    // A relocated system binary can be killed after spawn. Compile an owned fixture
    // and wait for it to enter main before checking the kernel's process listing.
    execFileSync('/usr/bin/cc', ['-x', 'c', '-', '-o', executable], {
      input: `
        #include <unistd.h>
        int main(void) {
          alarm(30);
          if (write(STDOUT_FILENO, "R", 1) != 1) return 1;
          pause();
          return 0;
        }
      `,
    });
    const child = spawn(executable, [], { env: {}, stdio: ['ignore', 'pipe', 'ignore'] });
    const exited = once(child, 'exit');
    try {
      const [ready] = await Promise.race([
        once(child.stdout, 'data'),
        exited.then(([code, signal]) => {
          throw new Error(`Synthetic resident exited before readiness (${code}, ${signal})`);
        }),
      ]);
      assert.deepEqual(ready, Buffer.from('R'));
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
    }
    // A stale single-instance socket is irrelevant: only a live process blocks the fixture.
    assertNoResidentCoexistenceApp(copy, identity);
  },
);
