# Tauri notification session selection — 2026-11-04

## Source behavior and authority

Electron's `main.ts::notify` already captures the source-gated `NativeAlert.sessionId`
and rechecks an authenticated snapshot on click. Tauri previously discarded that
identity in `desktop-sidecar.ts` and its `on_action` handler only focused main.
This increment keeps the existing Core `DesktopMonitor` source/sequence/status/
preference joins; no session is inferred from prose, inactivity or a filesystem path.

The private frame now permits an optional `sessionId` of 1–200 ASCII letters,
digits, colon, underscore or hyphen. Other historical identities retain their
category alert without a selectable target. The strict protocol and Rust receiver
allow only category/silent/optional identity, three alerts, pending count <=200
and the existing 1024-byte pipe budget. The normal maximum frame fits that budget.

The OS notification keeps fixed ORQST/category text and sound policy. Each attempt
gets a monotonic numeric plugin ID. Its session mapping lives only in native RAM,
is bounded by the existing 20-attempt run limit, and is consumed once. No session,
transcript, path, credential or agent-generated title/body is put in OS extras.
Only a real plugin `tap` with an exact returned ID may request selection. Missing
payloads, unknown IDs and other actions do nothing. Native disconnect, staleness,
queue loss, opt-out, notification preparation failure, origin change and stop invalidate targets
and pending navigation. The main-thread callback rechecks generation and freshness.

The setup hook `desktop::configure(app.handle(), origin.as_deref())` binds only
the owned Core's ready origin. `None` keeps routing denied and preserves the fixed
unavailable document. No builder/navigation/permission policy is replaced.
A callback targets only the existing main webview at that exact origin, without
userinfo/query. It emits `orqst-native-session` with an allowlisted identity; a null
detail invalidates an in-flight request. It does not load a new document.

The Tauri-only dashboard listener reuses `refresh()`, `openSession()` and its
`requestNavigation()` draft guard. Membership must be exactly one current Codex
session in the fresh authenticated snapshot, including a session absent from the
old React snapshot. It passes that snapshot directly to the existing selection
function: no timeout waits for React and no reload bypasses a draft review.
Changes to workspace/view/selection/connection, newer clicks, native revocation
and disposal fence asynchronous results and delayed draft affirmatives. Later
snapshots removing or changing the target also revoke a pending draft transition. A failed
refresh never selects from cached membership. A forged DOM event can request only
this same read-only, membership-checked view action; it grants no execution,
terminal control, Feature membership, permissions or process ownership. Observed
session navigation does not claim managed Feature/pane routing.

## Exact source review and reuse decision

- **Keep ORQST:** `packages/core/src/desktop-monitor.ts::DesktopMonitor.accept`,
  Electron `apps/desktop/src/main.ts::notify`, dashboard `App.tsx::openSession`,
  `requestNavigation`, and `use-observatory.ts::refresh`. These already implement
  the source evidence, authenticated state and draft/lifecycle boundaries needed.
- **Use installed plugin API, no new dependency:** Cargo.lock resolves
  `tauri-plugin-notification 2.8.0`. Registry `.cargo_vcs_info.json` pins
  [`plugins-workspace@128190689dbe59b59d344e01bf07b00862aa3791`](https://github.com/tauri-apps/plugins-workspace/tree/128190689dbe59b59d344e01bf07b00862aa3791/plugins/notification).
  Its [`src/desktop.rs`](https://github.com/tauri-apps/plugins-workspace/blob/128190689dbe59b59d344e01bf07b00862aa3791/plugins/notification/src/desktop.rs)
  was compared byte-for-byte with the installed registry source: `on_action`,
  `NotificationBuilder::show`, `imp::show_tracked`, `wait` and `performed` retain
  the builder data privately and report the numeric ID on macOS. `models.rs`
  provides `ActionPerformed::notification` and `ActiveNotification::id`.
  The SPDX header and packaged license declare Apache-2.0 OR MIT. Its existing
  notify-rust/thread/platform dependencies are retained; no code is copied.
- **Do not copy Anywh notification transport:** exact
  [`Anywh@546f189c04415c3c5af5f40e3931a0a90b9aba31/notifications.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/notifications.rs),
  `notify_turn_complete`, sends caller title/body and session/profile extras;
  its comments describe an older desktop plugin without click hooks and a
  separate Windows toast dependency. ORQST's resolved plugin already has the
  real callback. Caller-supplied text/extras and remote-profile routing are
  incompatible with this private source-gated category-only OS payload.
  `lib.rs::run_with`, architecture, agent-host and runtime docs were consulted;
  their host/profile lifecycle is unnecessary for observer selection.
- **Do not use Tucano model routing:** exact
  [`Tucano@0501956d127699300209902e889f3e69a0948766/router.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts),
  `route`/`parseRoute`, imports engine/shared Agent/Connector/language contracts
  and chooses speakers from model-generated handles. It cannot establish an
  exact observed session identity or native click provenance. No inference,
  queue or communication layer is introduced for a view selection.

Both exact upstream LICENSE blobs were fetched and verified as Apache-2.0 with
SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.
Complete pinned Git trees were checked (not truncated): each contains only root
LICENSE, no tracked NOTICE/COPYING. No upstream code/assets/dependencies enter this
change, so no new incorporation attribution or dependency license closure is needed.
The prior NOTICE and historical audit remain unchanged. Overclock is only the
previously documented visual reference, with no assumed source/asset reuse grant.

## Verification and remaining native gates

Pure Node tests cover the projection budget/allowlist, existing monitor provenance/
replay/preferences, new-session selection, invalid/missing/duplicate/provider-mismatched
IDs, failed refresh, draft cancellation, delayed affirmative revocation, changed
context and newer-click races. Rust unit cases cover frame parsing, exact callback
ID/tap matching, once-only mappings, revocation and origin rejection. Rust cases
are added but not executed in this work slice, which prohibits Cargo/build/runtime.

The desktop-sidecar synthetic integration expectation is updated for the private
identity field, but that process-starting test is deliberately not run here.
Executed with existing Node 24.22.2/pnpm 10.34.9 and linked installed dependencies:

- `pnpm lint`: passed (ESLint and full Prettier check).
- `pnpm typecheck`: passed.
- `pnpm exec tsx --test tests/desktop-notification-route.test.ts tests/desktop-monitor.test.ts tests/desktop-monitor-qa.test.ts`:
  14 pure tests passed, zero failures/skips.
- Direct existing-toolchain `rustfmt --edition 2021 --check apps/tauri/src-tauri/src/desktop.rs`
  and `git diff --check`: passed.

The ordinary full test suite, process-starting sidecar integration, Cargo/Rust
unit tests and build were not run under this work slice's restrictions.
No build/resources/install/new target/Node copies, apps, Core/PTY/provider/probes,
auth database, quarantines or uncertain runtime state were operated.

Native WebKit/event/draft behavior, OS banner/sound/permissions/identity, actual
click delivery and packaging remain unaccepted. The plugin dispatches on a
background task: `show()` returning Ok means preparation, not OS delivery or user
receipt; later dispatch failures may be unobservable. Windows reports clicks only
while the toast is visible; macOS/Windows cannot withdraw delivered alerts through
this plugin. Cold-start routing and other platforms are not claimed. Keep Electron
until the remaining retirement gates pass. This worktree stays available until
integration/commit/push preservation is confirmed by the orchestrator.
