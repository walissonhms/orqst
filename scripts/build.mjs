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
