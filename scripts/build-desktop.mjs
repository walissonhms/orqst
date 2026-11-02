import { build } from 'esbuild';
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
