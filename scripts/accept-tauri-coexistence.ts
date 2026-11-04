// Explicit human native acceptance fixture. Fixed synthetic CLIs only; no provider or credentials.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';

const [authorization, appPath, mode] = process.argv.slice(2);
assert.equal(authorization, '--authorize-synthetic');
assert.ok(appPath && appPath.endsWith('.app'));
assert.ok(mode === 'combined' || mode === 'preparation');
assert.equal(process.argv.length, 5);
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
assert.notEqual(process.getuid?.(), 0);
process.umask(0o077);
const app = await realpath(appPath);
const identifier = execFileSync(
  '/usr/bin/plutil',
  ['-extract', 'CFBundleIdentifier', 'raw', join(app, 'Contents/Info.plist')],
  { encoding: 'utf8' },
).trim();
assert.match(identifier, /^dev\.orqst\.coexistence[a-z0-9]+$/);
const node = join(app, 'Contents/MacOS/orqst-node');
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'orqst-native-coexistence-')));
const home = join(fixture, 'home');
const project = join(fixture, 'project');
const sources = join(fixture, 'empty-sources');
for (const directory of [home, project, sources]) await mkdir(directory, { mode: 0o700 });
const files: string[][] = [[], []];
for (const [group, source] of [
  'managed-terminal-fixture.c',
  'managed-agents-fixture.c',
].entries()) {
  const executable = join(fixture, `SYNTHETIC-NOT-A-PROVIDER-${group}`);
  execFileSync('/usr/bin/cc', [
    '-DORQST_SYNTHETIC_TIMEOUT_SECONDS=600',
    resolve('tests/helpers', source),
    '-o',
    executable,
  ]);
  for (const slot of [0, 1]) {
    const state = join(fixture, `state-${group}-${slot}`);
    for (const directory of [state, ...['home', 'codex', 'tmp'].map((p) => join(state, p))])
      await mkdir(directory, { mode: 0o700 });
    const config: ManagedCodexConfig = {
      version: 1,
      trust: 'native-same-user',
      executable: { path: executable, sha256: terminalExecutableSha256(executable) },
      executableVersion: 'SYNTHETIC-NOT-A-PROVIDER',
      node: { path: node, sha256: terminalExecutableSha256(node) },
      project,
      state,
      ...(group === 1
        ? {
            authentication: {
              mode: 'reuse-existing' as const,
              home,
              codexHome: home,
              sharedNativeConfiguration: true as const,
            },
          }
        : {}),
    };
    const file = join(state, 'terminal.json');
    await writeFile(file, JSON.stringify(config), { mode: 0o600 });
    await writeFile(join(state, 'codex/config.toml'), managedCodexSettings(config), {
      mode: 0o600,
    });
    if (group === 0)
      await writeFile(join(state, 'codex/auth.json'), '{"synthetic":true}', { mode: 0o600 });
    files[group]!.push(file);
  }
}
const server = createServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert.ok(address && typeof address !== 'string');
const port = address.port;
await new Promise<void>((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
);
await writeFile(join(fixture, 'fixture.json'), JSON.stringify({ identifier, mode, files }), {
  mode: 0o600,
});
console.log(JSON.stringify({ fixture, mode, port, nativeAcceptance: 'manual-pending' }));
const child = spawn(join(app, 'Contents/MacOS/orqst-desktop'), [], {
  env: {
    HOME: home,
    PATH: '/usr/bin:/bin',
    TMPDIR: fixture,
    LANG: 'en_US.UTF-8',
    ORQST_TAURI_PORT: String(port),
    ORQST_CODEX_SESSIONS: sources,
    ORQST_TAURI_AGENTS: JSON.stringify(files[1]),
    ...(mode === 'combined' ? { ORQST_TAURI_TERMINALS: JSON.stringify(files[0]) } : {}),
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const deadline = setTimeout(() => child.kill('SIGTERM'), 600_000);
const stop = () => child.kill('SIGTERM');
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
const [code, signal] = await once(child, 'exit').finally(() => {
  clearTimeout(deadline);
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
});
// Keep private evidence/journals even on uncertain exit. Never release reservations.
console.log(
  JSON.stringify({ fixture, code, signal, nativeAcceptance: 'requires-recorded-human-results' }),
);
assert.equal(code, 0);
