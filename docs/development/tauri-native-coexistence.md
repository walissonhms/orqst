# Native Tauri coexistence

This increment starts from `332aca9` and preserves Electron. It reuses the existing
preparation helper, retained PTY grid, structured communication document and signed
Node services. No provider protocol, renderer capability or observer endpoint is added.

## Preparation focus correction

The native preparation transaction now captures the dashboard URL and generation
at menu dispatch, before queueing its blocking worker. It rechecks focus before
starting the passive helper. Another ORQST window gaining focus, or closing/destroying
the dashboard, invalidates the transaction. Returning to the dashboard cannot restore
the old generation. The existing page-load invalidation, deadlines, write/open
latches and separate exact CLI-start authorization remain authoritative.
An invalidated/background transaction also suppresses its error modal, so a late
helper refusal cannot pull focus away from the communication or terminal window.

Native picker/sheet focus is distinct from another Tauri window gaining focus.
This change does not relax the signed-start, input or communication focus checks.
Preparation is still unavailable while a PTY runtime is selected. All three menus
can coexist, but this does not authorize a second preparation or profile replacement.

## Reproduce the isolated native fixture

Use the existing Node 24/pnpm 10 and Rust toolchains, and the matching Node LICENSE
described in [the Tauri guide](tauri.md). Build a separate application identity so
single-instance handling cannot focus a resident preview or Electron installation:

```sh
pnpm build:tauri --debug --bundles app --config '{"identifier":"dev.orqst.coexistencelocal","productName":"ORQST Coexistence"}'
pnpm accept:tauri-coexistence --authorize-synthetic \
  'apps/tauri/src-tauri/target/debug/bundle/macos/ORQST Coexistence.app' combined
```

The runner rejects the normal preview identity and a resident ORQST process with
the same executable path or bundle identifier. It checks before fixture allocation
and again immediately before launch; it never focuses, terminates or adopts an
existing application. Quit a resident acceptance identity explicitly or build a
separate identity. An external launch after the final check can still race, so a
zero process exit must never be treated as native acceptance.

The runner prints the canonical artifact path and native/Node executable hashes,
and retains them with manifests and the reserved port in private `fixture.json`.
The launch line reports the owned PID; private `exit.json` records PID, port,
process exit code/signal and spawn failure. These are process evidence, not proof
that a window rendered or a consent was accepted. A prebuilt app can predate the
current checkout: verify its build provenance separately before accepting main.
No Rust build is needed merely to run the preflight or record an existing bundle.

It requires an explicit synthetic
authorization, macOS ARM64 and a non-root user. It compiles the existing fixed C
fixtures, pins them in fresh manifests and launches one native shell with both
private hosts. HOME, temporary state, observer sources, admission and port are
isolated; no installed provider, credentials, user session or quarantined journal
is selected. The printed fixture path retains private evidence, even on failure.
The fixture is bounded to ten minutes. Ctrl-C/timeout terminates only its native
shell; this is an aborted run, not graceful quit acceptance or descendant proof.

To exercise preparation cancellation alongside communication, run the same command
with `preparation` instead of `combined`. This omits PTY selection and leaves native
preparation available. Cancel the native picker or select only the printed fixture's
`SYNTHETIC-NOT-A-PROVIDER-0` executable; the production hash check must refuse it.
Do not select an installed provider in this synthetic workflow. Successful native
manifest creation remains a separate acceptance obligation.

The runner intentionally never reports a native test as passed. Record observed
results for each checklist item; a zero exit code proves only native process exit.

## Inspecting a native window safely

Launch only through the isolated runner before selecting the exact running bundle
identity in Computer Use. App selection can launch a missing application with the
ordinary user environment; never use it as the initial fixture launcher. If the
fixture exits, do not select it again until a fresh isolated run is established.
Avoid a name shared with the resident preview or Electron app.

`cgWindowNotFound` is an inspection failure, not evidence of successful rendering,
missing native permissions or an application defect by itself. Inventory liveness,
a process sample showing the AppKit event loop, and an owned Core serving the empty
dashboard do not prove a capturable native window. Record the exact selection route
(path or bundle ID), tool error and artifact hashes. Do not click guessed coordinates,
change OS security settings or substitute Chromium for the native checklist.

If inspection remains unavailable, interrupt only the owned runner. It forwards the
signal only to its spawned native child. Retain the nonzero result and confirm the
recorded PIDs/port are gone; this is an aborted attempt, not graceful quit or combined
consent acceptance. Keep private evidence outside Git. See the
[preflight source review](../research/tauri-native-acceptance.md).

## Native checklist and current evidence

- [x] Build a macOS ARM64 debug app without changing the preview identity.
- [x] Launch one native shell with disposable PTY and structured hosts together.
- [x] Automated regression: switching surfaces during picking, creation consent,
      acknowledgment or opening cannot revive the old generation; completed manifests
      stay preserved and no Core journal is opened by an invalidated review.
- [x] Automated regression: passive resize/name/layout updates request no native
      focus; an explicit open may request focus.
- [ ] Observe preparation, Terminal and Managed agents menus together.
- [ ] Cancel preparation; switch to communication during a pending review; return
      and verify that a fresh explicit preparation is required.
- [ ] Start/attach/input/stop the synthetic PTY through native signed dialogs;
      verify hide/show, resize, retained scrollback and no input after window switching.
- [ ] Edit directed routes/roles through native review; cancellation and returning
      from the PTY window must not approve an old communication challenge.
- [ ] Cancel either stage of combined quit, then verify both surfaces ask again;
      finally approve both and observe owned host shutdown.

The first native attempt launched the shell plus both hosts, but computer-use
inspection returned `cgWindowNotFound` twice. App inventory confirmed the isolated
application was running, without providing a capturable window. No native menu,
dialog, focus, keyboard or lifecycle success is inferred. The fixture shell was
terminated explicitly; the runner correctly reported nonzero failure for its
signal exit. No matching fixture hosts remained afterward. This is retained as an
unsuccessful native attempt, not an accepted cycle.

The first typecheck found that an optional CLI argument was insufficiently narrowed
before `realpath`; the runner now asserts a nonempty app path explicitly. The first
resource staging attempt used an absent Node LICENSE path; staging succeeded with
the installed matching distribution LICENSE. No guard, test assertion or provider
pin was weakened.

The first complete Node run passed 627 of 628 tests; the source-budget fixture
failed with `ENOSPC` while creating a hard link. The first Clippy attempt and one
later resource staging attempt also failed with `ENOSPC`. Only this worktree's
generated native objects/check metadata/intermediates and redundant loose executable/
Node staging copies were removed; the complete final `.app`, including both native
and Node executables, is preserved. Restage resources before repeating the separate
packaged acceptance scripts. Nothing in another checkout, private runtime,
fixture journal or quarantine was deleted. No timeout or assertion was relaxed.

## Executed checks

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: passed. The existing Vite chunk-size
  advisory remains.
- `pnpm exec tsx --test tests/tauri*.test.ts`: 38 passed, including five added Node
  regressions. Final `pnpm exec tsx --test --test-concurrency=2 tests/*.test.ts`:
  **628 passed**, zero failures, cancellations or skips after freeing this worktree's
  native intermediates; no assertions/timeouts changed.
- `cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml --locked --features custom-protocol`:
  six passed, including the new native window-event policy test.
- `cargo clippy --manifest-path apps/tauri/src-tauri/Cargo.toml --locked --features custom-protocol -- -D warnings`:
  passed after the storage failure above.
- Final `pnpm build:tauri --debug --bundles app --config ...`: passed with identifier
  `dev.orqst.coexistence687`, producing the 170.46 MiB macOS ARM64 debug application.
  This built artifact includes the final dispatch/focus/modal corrections; it was
  not accepted through native UI interaction.
- `pnpm accept:tauri-core`, `pnpm accept:tauri-terminals --authorize-synthetic --panes=8`
  and `pnpm accept:tauri-agents --authorize-synthetic`: passed against the staged
  resource bundle. These run actual packaged Node/C processes and Chromium; native
  IPC/focus/dialogs remain simulated and these are not combined native acceptance.
- Native fixture guard: passing the normal `dev.orqst.desktop.preview` app to
  `accept:tauri-coexistence` returned exit 1 at the identifier assertion before
  fixture allocation or launch, as required.

Not run: full browser suite, `validate:local`/`validate:live` (ingestion unchanged),
successful native WebKit/AppKit consent, installed-provider tests, other-platform
builds or signed/notarized packaging. The failed native attempt remains unchecked
in the checklist above.

Real Codex/Claude/OpenCode login/tasks, native creation/start/input/stop, installed
provider mention/return, durable recovery, SQLite layout persistence, other platforms
and signed distribution remain unaccepted. The quarantined reservation is untouched.
See [the pinned reuse review](../research/tauri-native-coexistence.md).
