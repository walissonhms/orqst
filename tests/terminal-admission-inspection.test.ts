// Synthetic private reservation fixtures only. No process, Core, provider or PTY is started.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  lstatSync,
  renameSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  inspectDesktopAdmission,
  DesktopAdmissionRefused,
} from '../packages/core/src/managed-codex/desktop-admission-inspection.js';
import { terminalFile } from '../packages/core/src/terminal/codex-profile.js';
import { desktopAgentsAdmission } from '../packages/core/src/managed-codex/desktop-admission.js';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-admission-')));
  const directory = join(root, 'managed-agents');
  mkdirSync(directory, { mode: 0o700 });
  const file = join(directory, 'active-pair.json');
  const context = {
    owner: randomUUID(),
    epoch: randomUUID(),
    initialFiles: ['/synthetic/initial.json'],
  };
  const bytes = JSON.stringify({
    version: 1,
    owner: context.owner,
    epoch: context.epoch,
    manifests: context.initialFiles,
  });
  return {
    root,
    directory,
    file,
    context,
    bytes,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}
function refused(code: DesktopAdmissionRefused['code']) {
  return (error: unknown) => error instanceof DesktopAdmissionRefused && error.code === code;
}

test('passive inspection never creates a directory/marker; authoritative admission still catches a race', () => {
  const f = fixture();
  try {
    const absent = join(f.root, 'not-created');
    assert.ok(inspectDesktopAdmission(absent).includes('absent-directory'));
    assert.deepEqual(readdirSync(f.root), ['managed-agents']);
    inspectDesktopAdmission(f.directory);
    const authoritative = desktopAgentsAdmission(
      f.directory,
      f.context.initialFiles,
      f.context.epoch,
    );
    writeFileSync(f.file, f.bytes, { mode: 0o600 });
    assert.throws(() => authoritative.preflight());
    assert.throws(() => authoritative.claim()); // Exclusive claim cannot overwrite another owner.
    assert.throws(() => desktopAgentsAdmission(f.directory), refused('capacity_reserved'));
    assert.equal(readFileSync(f.file, 'utf8'), f.bytes);
  } finally {
    f.close();
  }
});

test('a prior valid marker blocks a new Core and only exact private current-Core evidence permits append', () => {
  const f = fixture();
  try {
    writeFileSync(f.file, f.bytes, { mode: 0o600 });
    assert.throws(() => inspectDesktopAdmission(f.directory), refused('capacity_reserved'));
    assert.doesNotThrow(() => inspectDesktopAdmission(f.directory, f.context));
    for (const changed of [
      { ...f.context, owner: randomUUID() },
      { ...f.context, epoch: randomUUID() },
      { ...f.context, initialFiles: ['/synthetic/other.json'] },
    ])
      assert.throws(
        () => inspectDesktopAdmission(f.directory, changed),
        refused('capacity_reserved'),
      );
    assert.equal(readFileSync(f.file, 'utf8'), f.bytes);
  } finally {
    f.close();
  }
});

for (const fault of [
  'invalid',
  'oversized',
  'mode',
  'symlink',
  'dangling',
  'hardlink',
  'directory',
] as const) {
  test(`reservation ${fault} fails closed and is preserved`, () => {
    const f = fixture();
    try {
      if (fault === 'directory') mkdirSync(f.file, { mode: 0o700 });
      else if (fault === 'symlink' || fault === 'dangling') {
        const target = join(f.root, 'synthetic-target');
        if (fault === 'symlink') writeFileSync(target, f.bytes, { mode: 0o600 });
        symlinkSync(target, f.file);
      } else {
        writeFileSync(
          f.file,
          fault === 'invalid' ? '{' : fault === 'oversized' ? 'x'.repeat(16385) : f.bytes,
          { mode: 0o600 },
        );
        if (fault === 'mode') chmodSync(f.file, 0o644);
        if (fault === 'hardlink') linkSync(f.file, join(f.root, 'synthetic-link'));
      }
      assert.throws(
        () => inspectDesktopAdmission(f.directory, f.context),
        refused('admission_invalid'),
      );
      assert.deepEqual(readdirSync(f.directory), ['active-pair.json']);
    } finally {
      f.close();
    }
  });
}

// The marker reader binds its opened descriptor to the identity captured before opening.
test('a replaced marker cannot be read under a previous inode snapshot', () => {
  const f = fixture();
  try {
    writeFileSync(f.file, f.bytes, { mode: 0o600 });
    const expected = lstatSync(f.file, { bigint: true });
    const replacement = join(f.directory, 'synthetic-replacement');
    writeFileSync(replacement, f.bytes, { mode: 0o600 });
    renameSync(replacement, f.file);
    assert.throws(() => terminalFile(f.file, true, 16 * 1024, expected), /identity changed/);
    assert.equal(readFileSync(f.file, 'utf8'), f.bytes);
  } finally {
    f.close();
  }
});
