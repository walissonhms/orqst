// Compile only the lock/ownership functions from production; no Cargo, Tauri or app runtime.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const native = 'apps/tauri/src-tauri/src/';
function between(file, start, end) {
  const source = readFileSync(native + file, 'utf8');
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Production fragment missing: ${file}:${start}`);
  return source.slice(from, to);
}
const source = `
#![allow(dead_code)]
mod preparation {
  use std::sync::Mutex;
  type CommandChild = ();
  #[derive(Default)]
  ${between('terminal_creation.rs', 'struct State {', 'impl State {')}
  ${between('terminal_creation.rs', 'fn identity_from(', 'fn identity(view:')}
  fn initialize(state: &mut State) { state.generation = 3; }
  fn invalidate(state: &mut State) { state.generation += 1; }
  fn read(state: &Mutex<State>, source: impl FnOnce() -> Option<String>) -> Option<(String,u64)> {
    identity_from(state, source, |source, origin| source == format!("{origin}/studio"))
  }
  include!(${JSON.stringify(join(process.cwd(), 'tests/native/tauri-ui-locks.rs'))});
}
mod features {
  use std::sync::Mutex;
  use std::collections::HashMap;
  #[derive(Default)]
  ${between('features.rs', 'struct State {', 'fn exact(')}
  ${between('features.rs', 'fn document_version(', 'fn identity(view:')}
  fn initialize(state: &mut State) { state.main_document = 3; state.chrome_document = 3; }
  fn invalidate(state: &mut State) { state.main_document += 1; }
  fn read(state: &Mutex<State>, source: impl FnOnce() -> Option<String>) -> Option<(String,u64)> {
    identity_from(state, true, source, |source, origin| source == format!("{origin}/studio"))
  }
  #[test]
  fn chrome_document_is_revalidated_independently() {
    let state = Mutex::new(State::default());
    state.lock().unwrap().chrome_document = 1;
    assert!(identity_from(&state, false, || Some("chrome".into()), |_, _| true).is_some());
    assert!(identity_from(&state, false, || {
      state.try_lock().unwrap().chrome_document += 1;
      Some("chrome".into())
    }, |_, _| true).is_none());
    assert!(identity_from(&state, false, || None, |_, _| true).is_none());
  }
  include!(${JSON.stringify(join(process.cwd(), 'tests/native/tauri-ui-locks.rs'))});
}
mod metadata {
  use std::sync::{Arc, Mutex};
  use std::collections::HashMap;
  type Value = ();
  mod oneshot { pub type Sender<T> = std::sync::mpsc::Sender<T>; }
  ${between('terminal.rs', 'struct MetadataPending {', 'fn metadata_reply_matches(')}
  ${between('terminal.rs', 'fn take_metadata_reply(', 'fn publish_layout_generation(')}
  include!(${JSON.stringify(join(process.cwd(), 'tests/native/tauri-metadata-locks.rs'))});
}
`;
const directory = mkdtempSync(join(tmpdir(), 'orqst-ui-lock-tests-'));
try {
  const file = join(directory, 'tests.rs');
  const binary = join(directory, 'tests');
  writeFileSync(file, source);
  execFileSync(
    process.env.RUSTC || 'rustc',
    ['--edition=2021', '-D', 'warnings', '--test', file, '-o', binary],
    {
      stdio: 'inherit',
    },
  );
  execFileSync(binary, [], { stdio: 'inherit', timeout: 30_000 });
} finally {
  rmSync(directory, { recursive: true });
}
