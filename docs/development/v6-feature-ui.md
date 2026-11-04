# V6 Feature UI and retained native view

The native `DesktopFeatures` v1 facade connects the real shared React
`FeatureWorkspace` to the selected, reviewed terminal Core. Only that project's
Workspace is listed. Feature UUIDs, metadata, exclusive slot assignments and
preferred view remain in Core SQLite. No HTTP execution, generic RPC, renderer
path/PID/proof, provider selection, new queue or session manager is introduced.

## Workflow

After a native terminal selection is reviewed/opened (including the existing
explicit startup selection), Studio and native terminal chrome can list Features,
create one with name/description/status, edit/rename it, and select it. Assigning
an available reviewed slot adds metadata only. The terminal may already be running;
no Start is sent. A member absent from this reviewed selection is counted and
reported unavailable, without adoption/restart. An empty Feature remains selected
with a visible sidebar and truthful empty state. Unassigned legacy terminals stay
separate. No other observed project is made controllable.

Selection filters only the retained native view. The existing six/eight-terminal
Core pool, PTYs, instance IDs, xterm documents and scrollback continue independently.
Each Feature maps saved UUID layout metadata to the currently available reviewed
slots. Unavailable members' order/names are retained on a save. A partial unassigned
view has no Feature layout namespace and remains a temporary view; no legacy JSON
or global layout is silently imported into a Feature.

The compact approved frame reserves 155px sidebar (46px at 720px and below), 45px
topbar and 34px footer. Existing 31px terminal headers and actual PTY surfaces fill
the remaining geometry. Terminal menus still own rename/reorder/minimize/maximize,
columns, ratio and signed lifecycle actions. Feature CRUD uses an inline sidebar
editor to avoid putting a dialog behind native child webviews. Keyboard focus
moves into its name field, Escape cancels/returns focus, and strings use both
locales. There is no focus-triggered refresh that disables an in-progress click;
explicit Refresh and validated native snapshots update the view.
At compact width, the editor occupies the existing 45px topbar and scrolls
horizontally, preserving the 46px native sidebar inset. A completed save only
closes the editor version that initiated it; it cannot close a newer editor.

## Native contract and authority

See [API](../api/features.md). `features.rs` accepts only the actual main Webview
at its fixed native origin and canonical `/` or `/studio` document, or the exact
`feature-workspace` document under `terminal-workspace`. It derives source,
document generation and fresh wire UUID; renderer fields are optimistic
concurrency only. Main navigation/close invalidates pending metadata. The child
is installed once, local resources are allowlisted, navigation/new windows denied,
and no terminal document is recreated during selection. Mutating native focus checks
are currently macOS-only, matching the existing terminal preview; other platforms
remain fail-closed until their native integration is validated.

Mutating metadata and existing MCP/retirement/quit reviews exclude each other in
both directions. Select/organize revoke input before asynchronous work. A selected
Feature never enables keyboard input or supplies a native signature. The native
layout generation, document generation, Feature view revision and Core metadata
revision are distinct. Native layout generation fences dashboard/close/navigation/
quit; stale geometry is discarded before updating layout/show/focus. Bounds are
validated against the real logical viewport, exact insets and selected slots.
The internal `terminal::metadata_request(app, envelope, presentation)` receives
the native epoch captured before the asynchronous focus check; it is never a
renderer field. Its independent pending map is bounded to eight UUIDs/128 KiB and
15 seconds. Only `feature-reply` with the same UUID/document/current epoch can
resolve it. Quit admission and metadata admission share the native state lock;
a Quit attempt during a mutation revokes input/fences presentation but starts no
review or automatic retry. The existing preparation/selection latch remains.
A save ACK publishes current state only; it cannot reopen a suspended workspace.
The snapshot distinguishes the saved preferred `view` from `activeFeatureId`, the
context actually presented. If navigation invalidates a selection after SQLite
commits, its obsolete command changes no live view; a later snapshot reads metadata
without applying it. The user can select again with the current CAS revision.

SQLite saves use the existing private 0700 directory/0600 database and bounded
Store. Feature edits, slot assignment and view selection retain CAS. A stale view
shows an explicit error and requires refresh/review; uncertain transport does not
retry a mutation. Archive with members reports a useful lifecycle-review refusal
and preserves sessions. Clone/remove, Floating, unverified models and cross-Feature
communication remain unavailable. This increment is not complete V6 acceptance.

The existing Core RPC remains unchanged. After an explicit negative Core reply,
the typed metadata client may read the current revision to diagnose a CAS conflict;
it does not retry the write. A timeout/disconnect never uses that diagnosis and
remains an unavailable/uncertain transport result.

## Verification and remaining limits

The explicit runner is:

```sh
pnpm build:tauri-resources
pnpm exec tsx scripts/accept-v6-features.ts --authorize-synthetic-features
```

It uses isolated synthetic C PTYs, packaged Node/Core, actual xterm documents and
a Chromium facade for native IPC/focus/consent. Native geometry is emulated with
retained iframes only in that runner. Its assertions cover UI CRUD/assignment,
Feature 3/2/1 switching, per-Feature layout, instance/document/scrollback identity,
input revocation, one process attempt per terminal and screenshot geometry. This
runner cannot establish Tauri WebKit first-responder/sheet behavior, real provider
acceptance, machine-restart continuity or platform packaging. Exact executed
results/failures and native base dependencies accompany the delivery; do not infer
that this command passed merely because its executable exists.

### Executed evidence and pause — 2026-11-04

The EN Chromium/packaged-Core run reached 15 repeated Feature switches with six
synthetic PTYs assigned 3/2/1. Instance IDs, document IDs, xterm/scrollback and exactly
six Starts remained unchanged. The run then failed while reopening the editor
after rename (`Status` locator timeout); this is a failed acceptance, not a pass.
The editor-version correction is implemented but has **not** been rerun. PT and
the final screenshot comparison at 1440×900 have not completed.

After the runner lost its host, a later process snapshot found no matching Core,
PTY host or synthetic PTY processes. All six lifecycle receipts nevertheless end
at `started`, without an exit receipt, and the fixture's `active-pair.json` remains.
Cleanup is therefore **uncertain**. The original fixture, receipts, SQLite and
log are preserved for owner review; no adoption, signal, reconciliation, deletion
or restart was attempted after transport loss. EN/PT, new fixtures/Starts and the
broad suite are paused by owner instruction, pending specific review/authorization.

The runner cleanup correction is separate code: while the original host is still
valid it attempts signed stops for known instance IDs, observes exits, requests
signed retirement, and checks host exit. After loss it preserves evidence and
never reconnects/adopts/signals. Failure artifacts remain even after a confirmed
cleanup. Node/Core fixture copies use copy-on-write and verify their hashes before
startup. This correction has not been executed during the pause.

Integration review also corrected the acceptance deadline: it interrupts the
Chromium/ready wait instead of closing the original host before signed cleanup.
If the deadline expires during browser launch, the run fails before any UI Start.
The existing host transport is retained for the bounded signed cleanup attempt;
failure still records uncertainty. This path has not been executed during the pause.

Checks that start no sessions passed on the integrated branch: 53 focused
SQLite/mock/layout/broker tests; lint, TypeScript and the regular dashboard/bridge/
desktop build; Tauri resources with 17 dependency notices; 28 Rust unit tests,
Clippy with warnings denied, and `cargo build --features custom-protocol`.
Rust used the existing target691 serially with debug/incremental disabled. No
application/bundle was launched, and no full native bundle or provider acceptance
is claimed. An initial Rust type error and runner lint errors were corrected;
the subsequent listed checks passed without weakening rules.

Integration review found that the final focus await could cross native
invalidation after the earlier epoch/document check. A separate fix now awaits
focus first and then jointly rechecks source/document, native epoch and both Quit
fences before cache mutation, publication or returning metadata. Its pure Rust
regression suspends the focus future, changes URL, document, epoch or Quit state,
then resumes it; every changed context is denied. No session/window is started.
The same fix keeps the metadata latch through the entire command, including the
final focus wait after timeout/error/denial. Its drop guard cleans up only the
owning UUID, including cancellation during either metadata or focus awaits.
Cancellation invalidates the owner's native presentation epoch without renewing
document generations, input leases or authority. Pure regressions cover both drop
points, all reply outcomes, late/duplicate guards, snapshots and the review fence
while the latch is held. No mutex spans an await and no operation is retried.

The earlier broad Node run was interrupted (exit 130): 703 passed, four failed,
two cancelled. ENOSPC is established only for the logs that report it; the 55s
startup-counter timeout has no established cause. That interrupted run is not a
successful suite. Native WebKit, provider, NSApp deactivation and final Quit
acceptance remain untested in this increment.

### Main integration checks

The eight non-merge source commits through `7a939df` were integrated over published
`241cb03` through `d7816c2`. Test conflicts retained both the own-sheet cases and
metadata exclusion cases; the resulting source tree matched the delivered branch
before the additional deadline correction described above.

On the integrated tree, all 53 session-free Node tests and 28 Rust unit tests
passed. Lint, TypeScript, the regular build, resource staging with 17 notices and
Clippy with all targets/warnings denied and native executable compilation passed.
The first Rust attempt failed
because the new `dist/features` resources had not been staged in the main workspace;
after staging them the same test command passed. Stage Tauri resources before
standalone Rust checks: `build.rs` requires the declared native resource paths.
The broad suite, EN/PT, runner deadline/cleanup execution and native/provider UI
acceptance were not run during this integration pause. Earlier broad-suite counts
belong only to their documented source revisions.

### Authorized EN follow-up and accessible editor labels

The owner authorized one fresh isolated EN run on published `dbdf60e`, with PT
conditional on EN passing and confirmed cleanup. EN again reached 15 switches
3/2/1 with the same six starts/documents/history, then failed on the exact `Status`
field lookup. PT was not started and EN was not retried.

This attempt's cleanup was confirmed: all six lifecycle journals end with an exit
receipt, signed retirement completed, the active reservation is absent and the
original host exited. The earlier fixture's six missing receipts remain uncertain
and its data was neither adopted, reconciled nor deleted. One fixture's cleanup
does not retrospectively accept another's.

A separate renderer-only reproduction found an open editor with no exact `Status`
label: its wrapping label included every option's text. The description label
similarly included existing textarea content, and the edit button's ellipsis was
its accessible name. Explicit localized ARIA labels fix those names without changing
the command/lifecycle contracts or weakening the acceptance locator.

The explicit no-session regression is:

```sh
pnpm exec tsx scripts/accept-feature-editor.ts --authorize-synthetic-feature-ui
```

It bundles the actual React component, serves only intercepted browser resources
and uses schema-validated synthetic metadata in memory. Both EN and PT passed exact
description/status lookup and three save/rename/reopen cycles, with no page errors.
The first regression attempt also exposed the missing edit-button name; after the
explicit label fix it passed. No Core, host, PTY, SQLite or provider is started.
This is renderer evidence only: the six-PTY EN correction still needs a new
authorized run, and full PT/native/provider acceptance remains incomplete.

For this label-only correction, the renderer regression, lint, typecheck, regular
build and resource staging with 17 notices passed. The broad Node suite and native
checks were not rerun; no Rust/lifecycle contract changed.

### Visible-page restoration assertion

The next EN run passed the corrected editor flow and reached resize restoration,
then failed an assertion expecting three visible panes. The existing shared
`terminalGridPage` uses a 400px minimum pane height. The test had deliberately saved
one column for the three-member Feature; at 1440×900 its 821px content height shows
two members per page, while all three remain in `order`/`shown`. Runtime geometry
is unchanged. Eight pure layout tests pass, including this exact resize scenario.

The runner now waits for the selected Feature and `aria-busy=false` before capturing
the wide view, then requires that exact visible page after shrinking/restoring and
separately checks all three retained members. This replaces the incorrect fixed
visible-count assumption without reducing identity, membership or persistence checks.
The failed run again confirmed signed retirement and host exit; its six journals
retain exit receipts. A capture made during an unfinished selection is excluded
from final visual acceptance.

### Complete packaged EN/PT follow-up

The owner authorized continued synthetic acceptance, stopping on uncertain cleanup.
On source `592ce02` (runtime UI from `d1fda50`), the complete EN and PT commands both
passed serially. Each used six actual synthetic PTYs, exactly six Starts and 15
Feature switches 3/2/1. They preserved instance IDs, documents and scrollback,
exercised name/status edits and archive refusal, per-Feature SQLite layouts, input
revocation and fresh explicit input/PONG from each original process, 1440×900 and
720×700 geometry, signed stops and retirement. Core retirement validates every
dispatched owned exit; the runner also checked the reservation was absent and the
original host exited with code zero/no signal before removing each successful
fixture. Failed fixtures and the original uncertain one remain preserved.

This closes that packaged Chromium/facade acceptance only. Native focus, capabilities,
WebKit geometry and real-provider behavior are not inferred from it. Earlier failures
remain valid evidence for their exact source/test revisions.

Final source verification also passed all 54 session-free Node tests (including
the added page-restoration regression), TypeScript, focused ESLint and formatting.
The broad Node suite was not rerun in this acceptance increment. No Rust source
changed; native terminal/provider acceptance remains separate.

### Local native preview

The current local app is `dist/native-preview/ORQST Preview.app`. It was packaged
with `tauri bundle --debug --bundles app --features custom-protocol --ci`, reusing
the previously compiled native executable instead of rebuilding deleted Cargo
caches. The initial linker signature did not seal the app resources; a local ad hoc
bundle signature was applied and `codesign --verify --deep --strict` then passed.
This is a local development preview, not notarized distribution.

The app was opened and its native WebKit dashboard/Studio observed on its own
loopback Core. Opening it starts no CLI automatically. Preparation currently uses
the native **Prepare Tauri terminals** menu. The older Studio preparation buttons
depend on the Electron `orqstStudio` bridge and remain unavailable in Tauri; its
"older Desktop/relaunch" warning is misleading in this current native build and is
a remaining UI-port gap. Do not claim this app-opening check accepts native terminal
Start, Feature switching, final Quit or provider communication. Those flows still
need their native review. Preserve the open app while the owner tests it.

## Full-window Studio correction — 2026-11-04

Manual inspection of the running Preview exposed a real composition defect:
`App` rendered the dashboard sidebar/header/page margins around `Studio`, which
rendered a second Feature sidebar/header and preparation documentation beneath it.
The Feature surface's viewport-derived height then overflowed the outer page.

`StudioWorkspace` now composes one Feature workspace and a native HTML modal
preparation drawer. `App` applies the dedicated `studio-shell` only on Studio with
the version-1 native Feature bridge. Its content fills the viewport; the original
dashboard navigation is restored on Overview. **+ Terminal** and the empty-state
action open preparation; Escape/Close return focus without remounting the workspace.
`Studio`'s `preparationOnly` prop prevents a second Feature workspace in the drawer.
Browser-only and earlier Electron Studio behavior remain covered separately.

The drawer reuses existing preparation; opening it grants no authority and starts
no CLI. The Tauri preparation bridge remains a separate functional delivery. Native
terminal documents, exact layout insets and Core/PTY lifecycle are unchanged.

Verification: the dashboard build, TypeScript and full repository lint passed. All three
targeted Playwright tests passed, including renderer-only native facades: exact
workspace bounds and no outer document overflow at 1440×900, 720×700, 390×600 and
320×600, a single Feature workspace, EN/PT navigation, drawer open/Escape/Close and
focus restoration. No Core-owned PTY/provider or native WebKit acceptance was run
for this shell change. The broad suite and Rust checks were not rerun. The open
Preview's executable/resources are preserved while its owner tests.

See the [pinned reference decision](../research/studio-full-window.md).

## Fragments for central integration

- **Checklist:** Feature metadata CRUD/selection, reviewed-slot assignment and
  per-Feature retained docked layout are connected through a narrow native facade.
  Keep acceptance **unchecked**: 15 synthetic six-PTY switches 3/2/1 preserved IDs,
  documents, scrollback and Start count, but EN failed on the rename/editor race.
  The correction has no rerun; PT/final screenshots are pending. Six exit receipts
  are absent and cleanup is uncertain; preserve the fixture/journals/reservation.
  New runs require specific owner review/authorization. Feature duplication,
  removal/move, safe archive with members, Floating, mixed-provider/N-member
  communication and platform/restart acceptance remain unchecked.
- **README / CHANGELOG:** the selected native Workspace now exposes persisted
  Features in Studio/native compact chrome; selecting a Feature filters retained
  terminals and restores its SQLite layout without issuing Start or restoring
  input. Members outside the reviewed selection are unavailable, not adopted.
- **ROADMAP / design:** retain the approved V6 frame and real terminal surface.
  Broader workspace creation/control, runtime enrollment/communication, model
  choice and native/provider acceptance still need their own functional increments.

## Tauri Studio preparation source follow-up — 2026-11-04

The source gap described under Local native preview now has a narrow Tauri bridge
and independent localized preparation component. It reuses the existing native
1–8 Codex/Claude menu wizard, with separate opening and signed Start. Electron's
mixed preset is not offered in Tauri. The component is suitable for the separately
coordinated full-window Studio preparation drawer; it adds no workspace/layout.
See [workflow, checks and source/native limits](tauri-studio-preparation.md).
The owner's already open native app, data and processes are unchanged; its earlier
observation does not accept this new source or native/provider/final-Quit behavior.
