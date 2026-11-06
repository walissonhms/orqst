// Writes the Store migration SQL for the Rust terminal Core (apps/tauri/terminal-core).
// `tests/rust-terminal-core-contract.test.ts` fails when the committed copy is stale.
import { writeFileSync } from 'node:fs';
import { storeMigrations } from '../packages/database/src/index.js';

writeFileSync(
  new URL('../apps/tauri/terminal-core/src/store-migrations.json', import.meta.url),
  JSON.stringify(storeMigrations, null, 1) + '\n',
);
