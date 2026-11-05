import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { terminalEnrollmentFile } from '../packages/core/src/terminal/enrollment-files.js';
import type { InteractiveTerminalConfig } from '../packages/core/src/terminal/interactive-profile.js';

test('synthetic legacy binding retains an unavailable inode after executable replacement', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-v1-inode-')));
  chmodSync(root, 0o700);
  try {
    const state = join(root, 'state');
    const project = join(root, 'project');
    mkdirSync(state, { mode: 0o700 });
    mkdirSync(project, { mode: 0o700 });
    const executable = join(root, 'synthetic-cli');
    const node = join(root, 'synthetic-node');
    const manifest = join(state, 'terminal.json');
    for (const file of [executable, node, manifest])
      writeFileSync(file, 'synthetic', { mode: 0o600 });
    const digest = createHash('sha256').update('synthetic').digest('hex');
    const config = {
      state,
      project,
      executable: { path: executable, sha256: digest },
      node: { path: node, sha256: digest },
    } as InteractiveTerminalConfig;
    const before = terminalEnrollmentFile(manifest, config);
    writeFileSync(executable, 'updated in place');
    const inPlace = terminalEnrollmentFile(manifest, config);
    assert.equal(inPlace.bindingDigest, before.bindingDigest);
    const replacement = join(root, 'replacement');
    writeFileSync(replacement, 'updated by replacement', { mode: 0o600 });
    renameSync(replacement, executable);
    const replaced = terminalEnrollmentFile(manifest, config);
    assert.notEqual(replaced.identities[3], before.identities[3]);
    assert.notEqual(replaced.bindingDigest, before.bindingDigest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
