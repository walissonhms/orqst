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

## WindowServer evidence probe (2026-11-04)

`cgWindowNotFound` cannot distinguish three different situations: the application
created no window, it created a window that is not on screen, or the inspection tool
could not capture an existing window. The previous attempt produced no evidence for
any of them, so every hypothesis stayed open. The acceptance runner now records
WindowServer metadata for the process it owns.

- `scripts/tauri/native-window-probe.swift` is original ORQST code (Apache-2.0, no
  third-party fragment) using Apple's `CGWindowListCopyWindowInfo`. It filters by
  owner PID and prints one bounded JSON object per run with window number, layer,
  alpha, the on-screen flag, integer bounds and an owner name truncated to 64
  characters. It does not capture pixels, window titles, paths, argv, environment or
  credentials; it never activates, focuses, hides or stops the target; it needs no
  TCC grant and works without Screen Recording permission.
- `scripts/tauri/native-window.ts` compiles that source into the private fixture with
  its own module cache, strictly validates the sample (zod, at most 32 windows) and
  polls at most 90 seconds while the owned PID is alive. It reports exactly one of
  `window-observed`, `window-exists-offscreen`, `no-window`, `process-exited`,
  `probe-invalid` or `probe-unavailable`.
- In the runner, a missing capture ends only its own child, records the reason in
  `exit.json` and exits nonzero; `window.json` and a bounded 32 KiB
  `native-stderr.log` remain in the private fixture. A capturable window is still not
  acceptance: menus, consent, focus, input and quit remain manual checklist items.

Hypotheses for the earlier failure and the evidence that now separates them:

| Hypothesis                                            | Evidence produced by the next run                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| The application never created its window              | `window.json` = `no-window`; app stderr and exit code retained                    |
| A window exists but is off screen or minimized        | `window.json` = `window-exists-offscreen` with bounds and the on-screen flag      |
| The fixture process exited during startup             | `window.json` = `process-exited` plus the recorded code/signal                    |
| The window exists and only the inspection tool failed | `window.json` = `window-observed`, while the separate tool still reports an error |
| The probe cannot run on this host                     | `window.json` = `probe-unavailable`; never counted as a pass                      |

The probe was validated on 2026-11-04 on this machine without Rust: `swiftc`
compiled it, a disposable AppKit fixture launched directly from a shell with an
isolated `HOME`/`TMPDIR` was reported with `onscreen: true` and bounds `420×292`, and
the same fixture after `orderOut` was reported with `onscreen: false`. Through
`captureNativeWindow`, the same fixture reached `window-observed` on the first sample
after 207 ms and a headless Node process reached `no-window` after five samples and
1.46 s. The probe therefore detects a real window from a non-LaunchServices launch,
distinguishes on-screen from off-screen and stops waiting as soon as evidence exists.
`tests/tauri-native-window.test.ts` covers parsing, retry, deadline, process exit,
invalid probe output and refusal paths with injected samples only; it launches no
application.

Not done here: the probe was not compiled into a Tauri build nor run against one.
This checkout has no Rust toolchain (`cargo`/`rustc` absent) and the volume has about
5.9 GiB free, so a debug Tauri build and its dependency target were not attempted.
`cgWindowNotFound` therefore remains **unexplained**; the next run must produce
`window.json` before any native claim is made.

## Focus after a native dialog (leading hypothesis, unproven)

The retained-workspace run reported that the native _Start_ was denied **after** the
permission dialog was accepted. Source inspection narrows the plausible causes; it does
not prove one.

- `terminal.rs:394` checks focus before the dialog, and `terminal.rs:426-434` checks it
  once more inside the dialog completion callback, together with the generation,
  MCP-request and document identity checks. `focused()` (`terminal.rs:63-120`) requires
  the owned window to be visible and focused **and** the WKWebView to be the key
  window's first responder.
- The completion callback samples that predicate exactly once, immediately after a
  sheet is dismissed. AppKit may return control before key-window and first-responder
  restoration settles, and `focused()` has no bounded re-check, so one early sample can
  deny a gesture the user did perform. The denial is fail-closed (the renderer receives
  `accepted: false`), which is why it looks like "denied after consent" rather than a
  crash.
- Alternative causes that the same run cannot exclude: the webview was not the first
  responder because the dialog returned focus to the window instead of the webview; the
  window lost focus to another ORQST window; the generation or MCP request had already
  been fenced; or the gesture used the wrong button (macOS maps the first/Escape button
  to cancel and only the middle button to approve, `terminal.rs:420-423`).

Decisive evidence, not implemented here: record a focus timeline in the private
diagnostics, e.g. `focused()` observed at 0/100/250/500/1000 ms after the dialog
completion plus the window's `is_focused`, `is_visible` and first-responder identity.
A late `true` confirms the race; an always-`false` result points at the first-responder
or fence checks instead. That instrumentation is Rust and cannot be compiled in this
checkout.

Proposed correction for a machine with the Rust toolchain (not applied, not compiled
here): keep every existing predicate and add a bounded re-check used only by the
post-dialog path, for example a helper that samples `focused(&window)` every 100 ms up
to 2 s and returns `true` only on an actual `true` sample. The identity, generation,
revocation, MCP-request and button checks stay unchanged, so this tolerates activation
settling without approving an unfocused or superseded window. It must be accompanied by
a Rust test for the bounded loop (timeout still denies) and the focus-timeline evidence
above before any claim is made.

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
- [ ] Record `window-observed` (bounds, layer, on-screen) for the owned fixture PID
      before attempting any native interaction; a missing/off-screen window is
      diagnosed from `window.json`, not guessed.
- [ ] Record a post-dialog focus timeline (0/100/250/500/1000 ms) when a native Start
      is denied after its confirmation, so the focus race is confirmed or excluded.
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

### WindowServer probe increment — 2026-11-04

- `tsx --test tests/tauri-native-window.test.ts tests/tauri-coexistence-preflight.test.ts`:
  9 passed (5 new probe regressions plus the existing preflight test).
- `tsc --noEmit`, ESLint and Prettier over the changed TypeScript files: passed.
- Probe compiled with `/usr/bin/swiftc` and validated against a disposable AppKit
  fixture in an isolated `HOME`/`TMPDIR` as described above.
- Not run here: `pnpm accept:tauri-coexistence` (no Tauri build on this machine), any
  Rust build/test, native menus/dialogs/input, installed providers. Native acceptance
  is unchanged and still unclaimed.

Real Codex/Claude/OpenCode login/tasks, native creation/start/input/stop, installed
provider mention/return, durable recovery, SQLite layout persistence, other platforms
and signed distribution remain unaccepted. The quarantined reservation is untouched.
See [the pinned reuse review](../research/tauri-native-coexistence.md).
