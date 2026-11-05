import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { TerminalCliPolicyStore } from '../packages/core/src/terminal/cli-authorization.js';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';
import type { TerminalProfile } from '../packages/core/src/terminal/supervisor.js';

test(
  'two independent hosts cannot overwrite an already approved revision',
  { timeout: 15000 },
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-policy-race-')));
    const executable = join(root, 'synthetic');
    const bytes = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4]);
    writeFileSync(executable, bytes, { mode: 0o700 });
    const child = () =>
      fork(resolve('tests/helpers/cli-policy-race.ts'), [root, executable], {
        execPath: process.execPath,
        execArgv: ['--import', 'tsx'],
        cwd: process.cwd(),
        env: { HOME: root, PATH: '/usr/bin:/bin' },
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
    const one = child();
    const two = child();
    try {
      assert.deepEqual(
        (await Promise.all([once(one, 'message'), once(two, 'message')])).map(
          ([message]) => message,
        ),
        ['review', 'review'],
      );
      const results = Promise.all([once(one, 'message'), once(two, 'message')]);
      one.send('approve');
      two.send('approve');
      assert.deepEqual((await results).map(([status]) => status).sort(), ['allowed', 'stale']);
      const profile: TerminalProfile = {
        id: 'test',
        projectId: 'test',
        executable,
        executableSha256: terminalDigest(bytes),
        executableVersion: '0.162.1',
        argv: [],
        cwd: root,
        environmentProfile: 'synthetic',
        permissions: 'synthetic',
        cliAuthorizationScope: 'synthetic',
      };
      const signature = { valid: true, teamId: '2DC432GLL2', identifier: 'codex' };
      assert.ok(
        await new TerminalCliPolicyStore(root).verifiedEpoch(profile, 'codex', 'tui', {
          async verify() {
            return signature;
          },
        }),
      );
    } finally {
      if (one.connected) one.disconnect();
      if (two.connected) two.disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
