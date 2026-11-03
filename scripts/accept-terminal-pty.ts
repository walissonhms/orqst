// Explicit developer acceptance only; never invoked by runtime, build or automatic tests.
import assert from 'node:assert/strict';
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { spawn } from 'node-pty';
import { probeSyntheticPty, requireSyntheticAuthorization } from './terminal/probe.js';
import { probeOwnedSyntheticPty } from './terminal/owned-probe.js';

requireSyntheticAuthorization(process.argv.slice(2));
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin', 'This acceptance currently supports macOS only');
assert.equal(process.arch, 'arm64', 'This acceptance currently supports arm64 only');
assert.notEqual(process.getuid?.(), 0, 'Never run the PTY probe as root');
process.umask(0o077);
const require = createRequire(import.meta.url);
const dependency = dirname(require.resolve('node-pty/package.json'));
const manifest = JSON.parse(await readFile(join(dependency, 'package.json'), 'utf8')) as {
  version: string;
  license: string;
};
assert.equal(manifest.version, '1.1.0');
assert.equal(manifest.license, 'MIT');
const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-synthetic-pty-')));
const checks: string[] = [];
try {
  // Stage upstream JS/native files without modifying shared node_modules or its store.
  // The 1.1.0 macOS tarball helper lacks its execute bit; set it only in this private copy.
  const staged = join(root, 'node-pty');
  const nativeDir = join(staged, 'prebuilds', 'darwin-arm64');
  await mkdir(nativeDir, { recursive: true, mode: 0o700 });
  await cp(join(dependency, 'lib'), join(staged, 'lib'), { recursive: true });
  for (const file of ['package.json', 'LICENSE']) {
    await copyFile(join(dependency, file), join(staged, file));
  }
  for (const file of ['pty.node', 'spawn-helper']) {
    await copyFile(join(dependency, 'prebuilds', 'darwin-arm64', file), join(nativeDir, file));
  }
  await chmod(join(nativeDir, 'spawn-helper'), 0o700);
  const backend = require(join(staged, 'lib', 'index.js')) as { spawn: typeof spawn };
  const fixture = join(root, 'synthetic-fixture.mjs');
  await copyFile(fileURLToPath(new URL('./terminal/fixture.mjs', import.meta.url)), fixture);
  const node = await realpath(process.execPath);
  // At most one active owned fixture; two mechanics starts and two sequential supervisor starts.
  for (const mode of ['exit', 'signal'] as const) {
    const home = join(root, mode);
    await mkdir(home, { mode: 0o700 });
    const pty = backend.spawn(node, [fixture], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: home,
      env: { HOME: home, CODEX_HOME: home, TMPDIR: home, LANG: 'C', LC_ALL: 'C' },
    });
    checks.push(...(await probeSyntheticPty(pty, mode)));
  }
  const ownedHome = join(root, 'owned-supervisor');
  await mkdir(ownedHome, { mode: 0o700 });
  checks.push(...(await probeOwnedSyntheticPty(backend.spawn, node, fixture, ownedHome)));
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    result: 'passed',
    scope: 'synthetic-pty-mechanics-owned-supervisor-and-native-broker',
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    nodePty: manifest.version,
    checks,
    provider: 'unvalidated',
    electronAbi: 'unvalidated',
    emulator: 'unvalidated',
  }),
);
