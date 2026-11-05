// Disposable plan bundle only: Node substitutes the reviewed binary hash, never a provider run.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

test('passive OpenCode command emits an exact-binary candidate without state, native reads or relay execution', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-opencode-plan-fixture-')));
  try {
    const home = join(root, 'native-home'),
      project = join(root, 'project');
    for (const directory of [home, project]) mkdirSync(directory, { mode: 0o700 });
    const sentinel = join(home, 'SYNTHETIC-NATIVE-CREDENTIALS-DO-NOT-READ');
    writeFileSync(sentinel, 'SYNTHETIC', { mode: 0o000 });
    const relay = join(root, 'relay.cjs');
    writeFileSync(relay, "throw new Error('SYNTHETIC relay must not execute');\n", { mode: 0o600 });
    const file = join(root, 'plan.cjs');
    const node = realpathSync(process.execPath);
    await build({
      entryPoints: ['scripts/plan-opencode-terminal.ts'],
      outfile: file,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      logLevel: 'silent',
    });
    const args = [
      file,
      '--executable',
      node,
      '--executable-version',
      '2.2.5',
      '--project',
      project,
      '--user-home',
      home,
      '--relay',
      relay,
      '--socket',
      join(root, 'absent.sock'),
      '--capability-file',
      sentinel,
    ];
    const before = readdirSync(root, { recursive: true });
    const output = execFileSync(node, args, {
      env: { HOME: home },
      encoding: 'utf8',
      timeout: 10000,
    });
    const plan = JSON.parse(output);
    assert.equal(plan.execution, 'blocked');
    assert.equal(plan.launchGrantAvailable, false);
    assert.deepEqual(plan.argv, ['--standalone']);
    assert.equal(plan.nativeDatabase.inspected, false);
    assert.equal(plan.environment.HOME, home);
    assert.equal(plan.environment.OPENCODE_PASSWORD, undefined);
    assert.equal(plan.environment.OPENCODE_CONFIG_CONTENT.includes(sentinel), true);
    assert.deepEqual(readdirSync(root, { recursive: true }), before);
    for (const rejected of [
      { OPENCODE_CONFIG_CONTENT: 'SYNTHETIC-NOT-TO-BE-PARSED' },
      { OPENCODE_CONFIG: sentinel },
      { OPENCODE_TEST_HOME: home },
      { XDG_DATA_HOME: 'relative' },
      { OPENCODE_DB: ':memory:' },
    ]) {
      assert.throws(() =>
        execFileSync(node, args, {
          env: { HOME: home, ...rejected },
          stdio: 'pipe',
          timeout: 10000,
        }),
      );
    }
    assert.deepEqual(readdirSync(root, { recursive: true }), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
