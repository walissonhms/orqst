import { build } from 'esbuild';
import { cp } from 'node:fs/promises';
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
