// Private disposable preferences only; no Electron, provider or session process.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { terminalLayoutStore } from '../apps/desktop/src/terminal-layout-store.js';
import type { TerminalLayoutPreferences } from '../apps/desktop/src/terminal-layout.js';

const state: TerminalLayoutPreferences = {
  axis: 'rows',
  columns: 3,
  percent: 63,
  order: [2, 0, 1],
  shown: [0, 2],
  active: 2,
  maximized: 2,
  names: ['Frontend', '', 'Reviewer'],
};
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-layout-test-')));
  const identities = [randomUUID(), randomUUID(), randomUUID()];
  const store = terminalLayoutStore(root, identities);
  const directory = join(root, 'terminal-layouts');
  return {
    root,
    identities,
    store,
    directory,
    file: () =>
      join(
        directory,
        readdirSync(directory).find((name) => name.endsWith('.json'))!,
      ),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('private atomic layout survives reopen and maps names/order/selection by stable UUID', () => {
  const f = fixture();
  try {
    assert.equal(f.store.load(), undefined);
    f.store.save(state);
    assert.deepEqual(f.store.load(), state);
    assert.equal(lstatSync(f.directory).mode & 0o777, 0o700);
    assert.equal(lstatSync(f.file()).mode & 0o777, 0o600);
    const reordered = terminalLayoutStore(f.root, [...f.identities].reverse()).load()!;
    assert.deepEqual(reordered.order, [0, 2, 1]);
    assert.equal(reordered.active, 0);
    assert.deepEqual(reordered.names, ['Reviewer', '', 'Frontend']);
    f.store.save({ ...state, maximized: null, percent: 37 });
    assert.equal(f.store.load()?.percent, 37);
    assert.equal(readdirSync(f.directory).length, 1);
    assert.equal(
      terminalLayoutStore(f.root, [randomUUID(), ...f.identities.slice(1)]).load(),
      undefined,
    );
    const serialized = readFileSync(f.file(), 'utf8');
    for (const secret of [
      'instanceId',
      'sessionId',
      'command',
      'project',
      'executable',
      'authentication',
    ])
      assert.ok(!serialized.includes(secret));
  } finally {
    f.close();
  }
});

test('corrupt, forged, oversized and non-private preferences fail without process side effects', () => {
  const f = fixture();
  try {
    f.store.save(state);
    const valid = readFileSync(f.file(), 'utf8');
    for (const value of [
      '{',
      'x'.repeat(17000),
      JSON.stringify({ ...JSON.parse(valid), command: 'start' }),
      JSON.stringify({ ...JSON.parse(valid), order: [f.identities[0], f.identities[0]] }),
      JSON.stringify({ ...JSON.parse(valid), active: randomUUID() }),
      JSON.stringify({ ...JSON.parse(valid), shown: [randomUUID()] }),
      JSON.stringify({ ...JSON.parse(valid), names: [{ id: f.identities[0], name: 'bad\u202e' }] }),
    ]) {
      writeFileSync(f.file(), value);
      assert.throws(() => f.store.load());
    }
    f.store.save(state); // A private corrupt preference can be replaced by a valid local layout.
    chmodSync(f.file(), 0o644);
    assert.throws(() => f.store.load());
    assert.throws(() => f.store.save(state));
  } finally {
    f.close();
  }
});

test('symlinked layout files and directories never redirect reads or writes', () => {
  const f = fixture();
  try {
    f.store.save(state);
    const file = f.file();
    const target = join(f.root, 'untouched');
    writeFileSync(target, 'SYNTHETIC-UNCHANGED', { mode: 0o600 });
    unlinkSync(file);
    symlinkSync(target, file);
    assert.throws(() => f.store.load());
    assert.throws(() => f.store.save(state));
    assert.equal(readFileSync(target, 'utf8'), 'SYNTHETIC-UNCHANGED');
    rmSync(f.directory, { recursive: true });
    symlinkSync(f.root, f.directory);
    assert.throws(() => terminalLayoutStore(f.root, f.identities));
    assert.equal(readFileSync(target, 'utf8'), 'SYNTHETIC-UNCHANGED');
  } finally {
    f.close();
  }
});
