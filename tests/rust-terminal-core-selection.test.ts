import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { rustCoreBinary, rustTerminalCore } from '../apps/desktop/src/managed-terminal-core.js';

test('only ORQST_RUST_TERMINALS=1 selects the Rust terminal Core', () => {
  assert.equal(rustTerminalCore({}), false);
  assert.equal(rustTerminalCore({ ORQST_RUST_TERMINALS: '0' }), false);
  assert.equal(rustTerminalCore({ ORQST_RUST_TERMINALS: 'true' }), false);
  assert.equal(rustTerminalCore({ ORQST_RUST_TERMINALS: '1' }), true);
});

test('the Rust Core binary must be a regular owner file next to the host', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-synthetic-rust-core-'));
  try {
    const host = join(directory, 'managed-terminal-core.cjs');
    assert.throws(() => rustCoreBinary(host));
    const binary = join(directory, 'orqst-terminal-core');
    writeFileSync(binary, 'synthetic');
    chmodSync(binary, 0o722);
    assert.throws(() => rustCoreBinary(host), /unavailable/);
    chmodSync(binary, 0o700);
    assert.equal(rustCoreBinary(host), binary);
    rmSync(binary);
    symlinkSync('/bin/sh', binary);
    assert.throws(() => rustCoreBinary(host), /unavailable/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
