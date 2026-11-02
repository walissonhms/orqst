import { build } from 'esbuild';
await build({
  entryPoints: ['apps/bridge/src/main.ts'],
  outfile: 'dist/bridge.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['chokidar', 'ws', 'zod'],
  sourcemap: true,
});
