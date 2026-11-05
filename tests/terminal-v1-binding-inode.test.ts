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

test('synthetic v2 binding omits CLI digest and inode while binding authorization evidence', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-v2-inode-')));
  chmodSync(root, 0o700);
  try {
    const state = join(root, 'state');
    const project = join(root, 'project');
    mkdirSync(state, { mode: 0o700 });
    mkdirSync(project, { mode: 0o700 });
    const executable = join(root, 'synthetic-cli');
    const node = join(root, 'synthetic-node');
    const manifest = join(state, 'terminal.json');
    for (const file of [executable, node]) writeFileSync(file, 'synthetic', { mode: 0o600 });
    const digest = createHash('sha256').update('synthetic').digest('hex');
    const config = {
      version: 1,
      state,
      project,
      executableVersion: '0.162.1',
      executable: { path: executable, sha256: digest },
      node: { path: node, sha256: digest },
    } as InteractiveTerminalConfig;
    const cliAuthorization = {
      version: 2,
      provider: 'codex',
      mode: 'tui',
      teamId: '2DC432GLL2',
      identifier: 'codex',
      contractRevision: 'codex-tui-0.162.1',
      authorizationEpoch: '1c24dd25-839b-401b-9726-cee7fa38f356',
    };
    writeFileSync(
      manifest,
      JSON.stringify({ ...config, executable: { path: executable }, cliAuthorization }),
      { mode: 0o600 },
    );
    const before = terminalEnrollmentFile(manifest, config);
    const replacement = join(root, 'replacement');
    writeFileSync(replacement, 'updated', { mode: 0o600 });
    renameSync(replacement, executable);
    const updated = {
      ...config,
      executable: {
        path: executable,
        sha256: createHash('sha256').update('updated').digest('hex'),
      },
    } as InteractiveTerminalConfig;
    assert.equal(terminalEnrollmentFile(manifest, updated).bindingDigest, before.bindingDigest);
    writeFileSync(
      manifest,
      JSON.stringify({
        ...config,
        executable: { path: executable },
        cliAuthorization: {
          ...cliAuthorization,
          authorizationEpoch: '292d475b-9491-4389-8a11-aa7c53b31068',
        },
      }),
    );
    assert.notEqual(terminalEnrollmentFile(manifest, updated).bindingDigest, before.bindingDigest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
