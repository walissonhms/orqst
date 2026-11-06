// Synthetic golden fixture: drive the TypeScript terminal journal and dump its rows.
// Usage: tsx journal.ts <dir> -> prints JSON {schema, rows, owner}.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { Store } from '../../../../../packages/database/src/index.js';
import { openTerminalJournal } from '../../../../../packages/database/src/terminal-journal.js';

const dir = process.argv[2]!;
const file = join(dir, 'terminal.sqlite');
const epoch = '00000000-0000-4000-8000-0000000000e1';
const a = '00000000-0000-4000-8000-0000000000a1';
const b = '00000000-0000-4000-8000-0000000000b1';
let clock = 1_000;
const now = () => (clock += 7);
const store = new Store(file);
const db = Reflect.get(store, 'db') as DatabaseSync;
const journal = openTerminalJournal(db, (f) => store.transaction(f), epoch, false, now);
journal.prepare({
  instanceId: a,
  clientId: 'desktop-managed',
  projectId: 'p1',
  manifestDigest: 'a'.repeat(64),
});
journal.prepare({
  instanceId: b,
  clientId: 'desktop-managed',
  projectId: 'p2',
  manifestDigest: 'b'.repeat(64),
});
journal.transition(a, 'starting');
journal.transition(a, 'running');
journal.transition(a, 'exited', { exitCode: 3, signal: 0 });
journal.transition(b, 'starting');
journal.release();
const rows = db.prepare('SELECT * FROM terminal_attempts ORDER BY instance_id').all();
const schema = db
  .prepare("SELECT name, sql FROM sqlite_master WHERE name LIKE 'terminal_%' ORDER BY name")
  .all();
const owner = db.prepare('SELECT * FROM terminal_owner').all();
const version = db.prepare('PRAGMA user_version').get();
console.log(JSON.stringify({ schema, rows, owner, version }));
