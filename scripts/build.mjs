import { build } from 'esbuild';
await build({
  entryPoints: {
    bridge: 'apps/bridge/src/main.ts',
    'analytics-worker': 'apps/bridge/src/analytics-worker.ts',
  },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['chokidar', 'ws', 'zod'],
  sourcemap: true,
});

// Standalone opt-in library host; neither observer entry imports or launches it.
await build({
  entryPoints: ['packages/core/src/managed-codex/native-host.ts'],
  outfile: 'dist/codex-structured-host.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
});
