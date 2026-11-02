import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ['scripts/service.mjs', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 10000,
  });

test('service plan pins the private runtime and production loopback configuration without exporting unrelated secrets', () => {
  const result = run(['plan'], { ORQST_UNRELATED_SECRET: 'synthetic-must-not-be-exported' });
  assert.equal(result.status, 0);
  const plan = JSON.parse(result.stdout) as {
    node: string;
    environment: Record<string, string>;
    plist: string;
    label: string;
  };
  assert.ok(plan.node.endsWith('/toolchain/bin/node'));
  assert.equal(plan.environment.ORQST_DEV, '0');
  assert.equal(plan.environment.ORQST_PORT, '4317');
  assert.ok(plan.plist.includes('<key>RunAtLoad</key><true/>'));
  assert.ok(plan.plist.includes('<key>SuccessfulExit</key><false/>'));
  assert.ok(!result.stdout.includes('synthetic-must-not-be-exported'));
  assert.equal(plan.label, 'dev.orqst.bridge');
});
test('service plan escapes XML special characters in paths rather than interpreting them', () => {
  const result = run(['plan', '--runtime-dir', '/synthetic/tool<&"\'chain'], {
    ORQST_DATA_DIR: '/synthetic/data<&"\'dir',
  });
  assert.equal(result.status, 0);
  const { plist } = JSON.parse(result.stdout) as { plist: string };
  assert.ok(plist.includes('tool&lt;&amp;&quot;&apos;chain'));
  assert.ok(plist.includes('data&lt;&amp;&quot;&apos;dir'));
  assert.ok(!plist.includes('/synthetic/data<&'));
});
test('invalid service configuration is rejected before writing or starting a service', () => {
  for (const ORQST_PORT of ['0', '65536', 'not-a-number']) {
    const result = run(['plan'], { ORQST_PORT });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Invalid ORQST_PORT/);
  }
});
test('runtime installation does not overwrite an unmanaged destination', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-runtime-test-'));
  try {
    const sentinel = join(dir, 'owned-by-user');
    writeFileSync(sentinel, 'preserve');
    const args = ['scripts/install-runtime.mjs', '--node', process.execPath, '--destination', dir];
    if (process.env.npm_execpath) args.push('--pnpm', process.env.npm_execpath);
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 1);
    assert.equal(readFileSync(sentinel, 'utf8'), 'preserve');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
