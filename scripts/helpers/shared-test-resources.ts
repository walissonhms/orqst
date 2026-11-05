// Disposable Node/Chromium fixtures only. No Electron or native app build/staging.
import { build, type Plugin } from 'esbuild';
import { chmod, cp, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const rejectElectron: Plugin = {
  name: 'reject-electron',
  setup(builder) {
    builder.onResolve({ filter: /^(?:node:)?electron(?:\/|$)/ }, () => ({
      errors: [{ text: 'Electron is not allowed in shared test resources' }],
    }));
  },
};

export async function buildSharedTestRenderer(kind: 'terminal' | 'agents') {
  const name = kind === 'terminal' ? 'managed-terminal' : 'managed-agents';
  const result = await build({
    absWorkingDir: root,
    entryPoints: {
      client: `apps/desktop/src/${name}-client.ts`,
      style: `apps/desktop/src/${name}.css`,
    },
    outdir: 'unused-in-memory-output',
    bundle: true,
    write: false,
    platform: 'browser',
    target: 'chrome156',
    format: 'iife',
    plugins: [rejectElectron],
  });
  const script = result.outputFiles.find((file) => file.path.endsWith('/client.js'));
  const style = result.outputFiles.find((file) => file.path.endsWith('/style.css'));
  if (!script || !style) throw new Error('Missing shared test renderer output');
  return { script: script.text, style: style.text };
}

export async function buildSharedTestHosts(output: string, kind: 'terminal' | 'agents') {
  if (!/^v24\./.test(process.version)) throw new Error('Shared test hosts require Node 24');
  const entryPoints: Record<string, string> =
    kind === 'terminal'
      ? {
          'managed-terminal-core': 'packages/core/src/terminal/host.ts',
          'managed-terminal-host': 'packages/core/src/terminal/pty-host.ts',
          'orqst-mcp-relay': 'packages/core/src/terminal/mcp-relay.ts',
        }
      : { 'codex-structured-host': 'packages/core/src/managed-codex/native-host.ts' };
  await build({
    absWorkingDir: root,
    entryPoints,
    outdir: output,
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    external: ['node-pty'],
    plugins: [rejectElectron],
  });
  if (kind !== 'terminal') return;
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('Shared PTY fixtures require darwin-arm64');
  const require = createRequire(new URL('../../package.json', import.meta.url));
  const source = dirname(require.resolve('node-pty/package.json'));
  const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as {
    version?: string;
    license?: string;
  };
  if (metadata.version !== '1.1.0' || metadata.license !== 'MIT')
    throw new Error('Unexpected PTY dependency');
  const target = join(output, 'terminal-pty');
  await mkdir(join(target, 'prebuilds/darwin-arm64'), { recursive: true });
  await cp(join(source, 'lib'), join(target, 'lib'), { recursive: true });
  for (const file of ['package.json', 'LICENSE']) await cp(join(source, file), join(target, file));
  for (const file of ['pty.node', 'spawn-helper'])
    await cp(
      join(source, 'prebuilds/darwin-arm64', file),
      join(target, 'prebuilds/darwin-arm64', file),
    );
  // Only the disposable copy may be changed, never the pnpm store.
  await chmod(join(target, 'prebuilds/darwin-arm64/spawn-helper'), 0o700);
}
