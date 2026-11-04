// Synthetic file growth and owner metadata; no provider inputs or runtime are accessed.
import assert from 'node:assert/strict';
import fs, { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import { terminalFile } from '../packages/core/src/terminal/codex-profile.js';

test('terminal files enforce the byte budget after fstat and reject foreign ownership', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-read-budget-')));
  const file = join(root, 'model.json');
  const original = fs.fstatSync;
  try {
    writeFileSync(file, 'x'.repeat(1025), { mode: 0o600 });
    // The opened file has grown beyond the earlier size observation.
    const growth = mock.method(fs, 'fstatSync', (fd: number) => {
      const stat = original(fd);
      stat.size = 0;
      return stat;
    });
    syncBuiltinESMExports();
    assert.throws(() => terminalFile(file, false, 1024), /read budget exceeded/);
    growth.mock.restore();
    syncBuiltinESMExports();
    const owner = mock.method(fs, 'fstatSync', (fd: number) => {
      const stat = original(fd);
      stat.uid = (process.getuid?.() ?? 1000) + 1;
      return stat;
    });
    syncBuiltinESMExports();
    assert.throws(() => terminalFile(file, false, 2048), /Untrusted file owner/);
    owner.mock.restore();
    syncBuiltinESMExports();
    assert.equal(terminalFile(file, false, 1025).length, 1025);
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});
