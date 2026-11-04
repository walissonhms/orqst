// Pure standard-library filesystem/correlation tests plus the production open-outcome projection.
// This never loads Cargo, Tauri, an app, a host/Core, a provider or a PTY.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const native = 'apps/tauri/src-tauri/src/';
const terminal = readFileSync(native + 'terminal.rs', 'utf8');
const from = terminal.indexOf('fn opening_outcome(');
const to = terminal.indexOf('async fn dispatch_terminal_request(', from);
assert(from >= 0 && to > from, 'Production opening outcome projection missing');
const source = `
#![allow(dead_code)]
#[path = ${JSON.stringify(join(process.cwd(), native, 'local_diagnostics.rs'))}]
mod local_diagnostics;
use local_diagnostics::Outcome;
${terminal.slice(from, to)}
include!(${JSON.stringify(join(process.cwd(), 'tests/native/local-diagnostics.rs'))});
`;
const directory = mkdtempSync(join(tmpdir(), 'orqst-diagnostics-tests-'));
try {
  const file = join(directory, 'tests.rs');
  const binary = join(directory, 'tests');
  writeFileSync(file, source);
  execFileSync(
    process.env.RUSTC || 'rustc',
    ['--edition=2021', '-D', 'warnings', '--test', file, '-o', binary],
    { stdio: 'inherit', timeout: 30_000 },
  );
  execFileSync(binary, [], { stdio: 'inherit', timeout: 30_000 });
} finally {
  rmSync(directory, { recursive: true });
}
