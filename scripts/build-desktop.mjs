import { build } from 'esbuild';
import { chmod, cp, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
await build({
  entryPoints: ['apps/desktop/src/main.ts'],
  outfile: 'apps/desktop/dist/main.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
});
await build({
  entryPoints: ['apps/desktop/src/preload.ts'],
  outfile: 'apps/desktop/dist/preload.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['electron'],
});
await cp('apps/desktop/resources/icons', 'apps/desktop/dist/icons', { recursive: true });
for (const [entry, outfile, platform] of [
  ['apps/desktop/src/managed-agents-preload.ts', 'managed-agents-preload.cjs', 'node'],
  ['apps/desktop/src/managed-agents-host.ts', 'managed-agents-host.cjs', 'node'],
  ['packages/core/src/managed-codex/native-host.ts', 'codex-structured-host.cjs', 'node'],
  ['apps/desktop/src/managed-agents-client.ts', 'managed-agents-client.js', 'browser'],
  ['apps/desktop/src/terminal-preload.ts', 'terminal-preload.cjs', 'node'],
  ['packages/core/src/terminal/host.ts', 'managed-terminal-core.cjs', 'node'],
  ['packages/core/src/terminal/pty-host.ts', 'managed-terminal-host.cjs', 'node'],
  ['packages/core/src/terminal/mcp-relay.ts', 'orqst-mcp-relay.cjs', 'node'],
  ['apps/desktop/src/managed-terminal-client.ts', 'managed-terminal-client.js', 'browser'],
]) {
  await build({
    entryPoints: [entry],
    outfile: `apps/desktop/dist/${outfile}`,
    bundle: true,
    platform,
    target: platform === 'node' ? 'node24' : 'chrome156',
    format: platform === 'node' ? 'cjs' : 'iife',
    external: ['electron', 'node-pty'],
  });
}
await build({
  entryPoints: ['apps/desktop/src/managed-terminal.css'],
  outfile: 'apps/desktop/dist/managed-terminal.css',
  bundle: true,
});
await cp('apps/desktop/src/managed-agents.css', 'apps/desktop/dist/managed-agents.css');
const desktopRequire = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
await mkdir('apps/desktop/dist/licenses', { recursive: true });
for (const dependency of ['@xterm/xterm', '@xterm/addon-fit']) {
  const source = dirname(desktopRequire.resolve(`${dependency}/package.json`));
  await cp(
    join(source, 'LICENSE'),
    `apps/desktop/dist/licenses/${dependency.replace('/', '-')}-LICENSE`,
  );
}
// Stage only the supported native backend. Never chmod package-manager/shared-store files.
if (process.platform === 'darwin' && process.arch === 'arm64') {
  const require = createRequire(import.meta.url);
  const source = dirname(require.resolve('node-pty/package.json'));
  const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (metadata.version !== '1.1.0' || metadata.license !== 'MIT')
    throw new Error('Unexpected PTY dependency');
  const target = 'apps/desktop/dist/terminal-pty';
  await mkdir(join(target, 'prebuilds/darwin-arm64'), { recursive: true });
  await cp(join(source, 'lib'), join(target, 'lib'), { recursive: true });
  for (const file of ['package.json', 'LICENSE']) await cp(join(source, file), join(target, file));
  for (const file of ['pty.node', 'spawn-helper'])
    await cp(
      join(source, 'prebuilds/darwin-arm64', file),
      join(target, 'prebuilds/darwin-arm64', file),
    );
  await chmod(join(target, 'prebuilds/darwin-arm64/spawn-helper'), 0o700);
}
