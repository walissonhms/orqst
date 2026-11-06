import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { storeMigrations } from '../packages/database/src/index.js';

test('the Rust terminal Core embeds the exact Store migrations', () => {
  const committed = JSON.parse(
    readFileSync(
      new URL('../apps/tauri/terminal-core/src/store-migrations.json', import.meta.url),
      'utf8',
    ),
  ) as string[];
  assert.deepEqual(
    committed,
    [...storeMigrations],
    'run: pnpm exec tsx scripts/export-store-migrations.ts',
  );
});
