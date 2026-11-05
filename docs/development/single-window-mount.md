# Single-window native mount — source increment

Status: source only. No bundle, provider, real state or native acceptance is claimed.
Baseline `f246610`; this increment is additive to the approved V6 reference.

## What changed

The normal desktop surface previously created a second top-level window
(`terminal-workspace`) for the owned terminals and another top-level window
(`managed-agents`) for the managed agent document. Both are now child webviews of
the existing `main` window, so the product has one normal ORQST window. The
dedicated pre-Core offline-recovery mode is intentionally unchanged and remains
its own single-window mode.

- `terminal.rs`: terminal child webviews are parented to `main`; the layout applies
  bounds, show and hide to those children instead of a second window. Hiding a
  pane or leaving the terminal surface hides the view only; it never stops the
  owned process, releases its identity or discards scrollback.
- `features.rs`: the Feature chrome child webview is parented to `main` and its
  document binding follows the same parent.
- `terminal_focus.rs`: native focus sampling targets `main`.
- `desktop.rs`: the quit-parent list no longer includes a second terminal window.
- `agents.rs`: the managed agent document is a child webview of `main`, sized to
  the window and following resize; its capability moved from `windows` to
  `webviews` in `tauri.conf.json`.
- `managed-terminal-client.ts`: focus loss suspends local writes instead of
  revoking the owned input grant; legitimate focus clears the suspension and the
  native policy decides lease renewal on the next write.

## Preserved consent semantics

Origin, document, focus, epoch and the existing native confirm packets are
unchanged. Managed-agent focus revocation now runs from the `main` window handler
with the same immediate, no-extra-window semantics as before. `terminal.rs`
`async fn confirm` and the capability/authorizeCli routes remain owned by the
backend increment and are not edited here. No `confirm` shortcut, no hardcoded
allow/deny and no removed fence.

## Focus and surface exclusion (security review)

1. **One visible surface.** Showing the managed agent document first hides the
   Feature chrome and every `terminal-N` view, revokes terminal input and sends a
   layout suspension; only then is the agent child shown and focused. The child is
   sized to the whole main window, so no terminal or dashboard area remains
   clickable underneath. Showing a terminal surface does the reverse: it hides the
   agent child and revokes its pending work.
2. **Command binding.** The capability grants `allow-agents-request` only to the
   `managed-agents` webview, and `agents_request` independently requires that
   exact label and document URL before any state change. Dashboard and terminal
   webviews cannot invoke it. Covered by
   `commands_bind_only_the_structured_native_document` and
   `managed_agent_capability_is_bound_to_its_webview_only`.
3. **Residual gap, documented.** Tauri exposes no child-webview focus event, and
   the window-level `Focused(false)` does not fire when another child takes focus
   inside the same window. The guarantee therefore rests on surface exclusivity
   plus full-surface coverage: while the agent document is shown, no other child
   is visible or clickable. If a future increment shows another child above it,
   exclusivity and this review must be revisited. The confirm focus test remains
   window-level by design; no fence was relaxed.

## Acceptance blocker — quit with owned processes

`desktop::main_window_event` still owns `CloseRequested` on `main`
(`prevent_close`, then keep-running hide or `app.exit(0)`). With owned terminals
now living in the main window, `keep_running = false` must not reach `app.exit(0)`
while an owned process runs. The reviewed backend retirement contract
(`TauriTerminalRetirement.run` with `authorizeOwnedRetirement`, Core exit receipts
and ownership proof) must be integrated there first: deterministic owned
shutdown, proven exit receipts, then retirement. Uncertain outcomes must be
preserved with an honest inline error; no PID-absence inference, no fake cleanup
and no signal to observed processes. This is a blocker for acceptance, not a
completed item.

## Executable evidence and limits

`cargo check` and `cargo test` (99 passed, 1 ignored) run in the authorized shared
target; `pnpm typecheck` and `pnpm lint` pass; 42 renderer/terminal tests pass.
Real WebKit/AppKit acceptance requires a new package and remains pending, so this
document does not claim visual or native interaction acceptance. The managed
agent child reuses the previous 1200×900 document layout and now covers the main
surface; its inner layout still needs native visual review.

## Native Quit admission contract — 2026-11-05

Start admission and a direct Quit now reserve the same phase mutex. Only
`NotStarted -> Starting` admits a host. Direct Quit reserves `NotStarted -> Exiting`
before requesting OS exit. If start wins, Quit blocks in `Starting`; if Quit wins,
start fails before spawn. `Starting` and `LostUnknown` block before opening the
agents gate and are revalidated after it.

Consuming reviewed exit evidence moves to terminal `ExitConsumed`, never back to
`NotStarted`. No host can be admitted again during this app lifetime. A repeated
`ExitRequested` is permitted because owned exit/preservation was already proved;
it does not consume evidence again or reopen admission. EOF after consumption
leaves `ExitConsumed` unchanged. These are source contracts, not AppKit/WebKit
acceptance.

## Deterministic native Quit circuit — 2026-11-05

`quit_orchestration.rs::Coordinator` now owns the production `request_quit`,
agents-approval reentry, `ExitRequested` decision, shutdown/retirement sequence,
rollback and pipe deadline. `quit_native.rs::NativePorts` implements `AgentsGate`,
`TerminalPipe`, `ExitPort` and `Timer` with the existing Tauri dialogs, private
child pipe, runtime and OS exit request. `main.rs`, `desktop.rs` and the approved
agents callback use that same coordinator. `host_phase.rs::HostPhase` retains the
shared phase/admission lock; even a direct OS `ExitRequested` without an earlier
`request_quit` reserves `Exiting` before being allowed.

The private terminal reader and the test transport share
`quit_orchestration.rs::PendingReplies`: only the existing private reply kinds
with a currently registered request ID resolve a waiter. Timeout cancels that
registration. The eight-second native timeout remains longer than Core's
five-second deadline. A timeout, EOF or loss is never evidence; only an
authenticated pre-fence `busy`/`denied` can roll back to `Active`.

`quit_orchestration_tests.rs` integrates the real coordinator, phase transitions,
reply router and oneshot channels through scripted effect ports. Its explicit
callback queue and manually advanced timer cover:

- Agents approval -> prevented `ExitRequested` -> `shutdownOwned` -> `retireOwned`
  or `closePreservedOwned` -> one normal allowed exit, with asserted effect order.
- Uncertain inventory, authenticated busy/denied rollback, write failure, invalid
  final replies, and the exact 7,999/8,000 ms timeout boundary, including final-step
  timeouts and late/old/swapped IDs.
- Duplicate Quit before the async flow starts, gate cancellation and a fresh
  attempt, loss before shutdown/final replies, EOF on both sides of the final
  evidence transition, and `ExitRequested` without evidence.
- `Starting`/`LostUnknown` before the agents gate, phase changes during the gate,
  both start/Quit lock orderings, raw OS exit racing start, and permanently closed
  admission in `Exiting`/`ExitConsumed`. Repeated exit after consumed evidence is
  allowed, but cannot consume evidence twice, reopen admission or be changed by EOF.

This replaces the two tests that only counted exit calls in source text. These
are deterministic Rust circuit tests, not an AppKit/WebKit event-loop test. The
ports do not launch an application, sheet, Core, PTY or provider; native dialog
presentation/focus, actual pipe scheduling, OS process exit and descendant receipts
still require the separate authorized native acceptance. No package or running
Preview resources are rebuilt by these tests.

### Reuse review for this extraction

The existing [pinned lifecycle review](../research/owned-terminal-shutdown.md) was
revalidated against Anywh `546f189c04415c3c5af5f40e3931a0a90b9aba31`:
[`AgentHost.endProcess/onExit`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/agentHost.ts#L1024-L1075),
[`waitForTurns/close`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/agentHost.ts#L1255-L1334),
its architecture/Agent Host/runtime documents and
[`LICENSE`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
(Apache-2.0; no root NOTICE at that commit). Decision: **keep and extract the
existing ORQST circuit**. Anywh serializes owned shutdown and awaits process exit,
but its TypeScript/Node runtime, hibernation, restoration and process-tree sweep
are not the Rust native evidence/admission contract. Its relevant imports include
Node filesystem/crypto, provider process drivers and the socket server; none are
introduced here. The existing Tucano permission/routing review remains applicable
without a new communication layer. No external source/assets or dependencies are
incorporated, and no attribution or license metadata changes are needed.

## 2026-11-05 — Quit review corrections: refusal boundary

`TauriTerminalService` emits `refused_prefence` only before its lifetime shutdown
fence and before retirement is busy/fenced. The production Coordinator rolls back
only for this explicit correlated status. The real Node service tests hold both
retirement preparation and a possibly consumed proof, retry shutdown, then deny
the held operation. They assert that the Node fence and one-signal latch survive.
With `ORQST_QUIT_NODE_TRANSCRIPT` set to a disposable absolute file, the focused
Node test records these real-service replies; the Rust circuit test replays them
through the production Coordinator, advances its manual 8s deadline during retire
and asserts `ShutdownInFlight` throughout. This is cross-language transcript
integration with synthetic Core handles, not a live pipe/AppKit/provider test.
The transcript test is explicitly ignored by default, never silently passed when
its artifact is absent. Generate the artifact with `pnpm exec tsx --test
tests/owned-terminal-shutdown.test.ts`, then run `cargo test
real_node_service_transcripts -- --ignored` with the same transcript environment
and the documented manifest/offline/locked/toolchain settings.

The previous pinned Anywh review was revalidated against the same checkout SHA
`546f189c04415c3c5af5f40e3931a0a90b9aba31`: architecture, Agent Host/runtime docs,
`AgentHost.endProcess/onExit` and `waitForTurns/close`, Apache-2.0 LICENSE (no root
NOTICE). Decision remains **keep the existing ORQST implementation**: Anywh's
Node process/hibernation/tree-sweep lifecycle cannot supply native Rust proof or
focus fences. No external code, assets or dependencies were incorporated.

### Dock restore generation fence — 2026-11-05

The exact chrome document is captured before taking the terminal pipe mutex.
The final critical section checks current generation, hidden slot, suspension,
presentation fences and the captured document; the getter-free chrome document
mutex remains held through the pipe write. The private `layout-action/reopen`
packet carries `generation`. The Node host rejects a different generation before
`layout.act`; the layout adapter independently rejects a missing/different
generation or suspended presentation before mutation, publication or persistence.
Barrier tests cover invalidation before the Rust write and Node rejection before
save. These synthetic tests do not prove the native Dock click or WebKit delivery.

Reuse research rechecked Anywh's architecture, Agent Host/runtime documents and
[`HostClient` event subscription fence](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/hostClient.ts#L372-L379).
It rejects replaced subscription IDs before callbacks, using its Node socket,
protocol and event cursor. Its Apache-2.0 LICENSE has no root NOTICE. Decision:
**keep the existing ORQST implementation**; a relay subscription fence does not
validate a Tauri document or serialize the native pipe. No upstream source or
dependencies were copied. Tucano communication and Overclock visual assets are
outside this presentation-only fix; their previously recorded decisions stand.

Security review: no public API, WebSocket, cookie or static-file behavior changes;
only the existing private native layout envelope gains a generation fence. No
execution authority, ownership, process, Core or Quit behavior changes.

### Durable renderer unavailable presentation — 2026-11-05

The first renderer termination latches presentation unavailable for the app
lifetime and calls the existing metadata invalidation before hiding any child.
That advances native layout generation, suspends presentation and revokes input;
it neither stops processes nor changes ownership or Core state. Queued layout
callbacks check the latch on the main thread; the shared presentation gate also
blocks later layout application and surface raises. No recovery/reset path or
reload is added. A synthetic queued-callback test proves the admission latch
rejects both the old layout and later raises. It does not prove AppKit stacking
or WebKit callback delivery; terminate main/child with multiple visible siblings
and attempt raises during separate native acceptance.

Reuse decision: retain ORQST's existing metadata invalidation and native UI-thread
dispatch. The pinned Anywh Agent Host process-exit/hibernation lifecycle cited
above changes owned process state and does not implement child-webview visibility;
copying it would exceed this presentation-only boundary. No external code added.

### Resolved ACL test and local-origin limit — 2026-11-05

The Tauri 2.12.5 resolver test uses the same generated context as production
(the real build.rs app manifest and static capabilities) and adds the production
`workspace_capability` builder. Before that dynamic capability, restore is denied;
after it, the chrome is allowed and main, terminal-0, terminal-7 and managed-agents
are denied. No app/runtime/webview is created or run.

The pinned Tauri source `webview/mod.rs::is_local_url` classifies registered
custom protocols as `Origin::Local`. `ipc/authority.rs::resolve_access` then
receives labels and Local, with no URL. Therefore ACL alone cannot prove exact
CHROME_URL denial for a wrong document in the same local chrome webview. The test
asserts the composed real ACL plus `restore_source_allowed` denies query,
fragment, path, host and scheme variants. Remote-origin resolution separately
allows CHROME_URL and denies different paths/hosts/schemes; omitted query/hash
are wildcarded by tauri-utils 2.10.2 `acl/mod.rs::RemoteUrlPattern::from_str`.
The existing source test remains as a limited source assertion. Exact document
admission comes from the production handler's source and document fences, not
from the Local ACL's URL awareness.

Native acceptance remains: invoke restore from the real feature-workspace at
CHROME_URL, main and terminal children; verify wrong-document navigation/invoke
is denied and no reopen/save occurs. These resolver/handler tests do not prove
WebKit's runtime origin classification, IPC delivery or the native click.

Resolver research uses the installed crates' `.cargo_vcs_info.json` pins:
[`tauri::RuntimeAuthority::resolve_access`](https://github.com/tauri-apps/tauri/blob/993038c49185307dfc895ab7657d77ca0d5ed7c7/crates/tauri/src/ipc/authority.rs#L462-L498),
[`Webview::is_local_url`](https://github.com/tauri-apps/tauri/blob/993038c49185307dfc895ab7657d77ca0d5ed7c7/crates/tauri/src/webview/mod.rs#L1961-L2001),
and [`RemoteUrlPattern::from_str`](https://github.com/tauri-apps/tauri/blob/59b63ab500da9859f12d8888c3298bc29bba0b92/crates/tauri-utils/src/acl/mod.rs#L284-L305).
These existing dependencies carry MIT/Apache-2.0 licenses and dual-license source
headers; no root NOTICE is present in the installed crate. Decision: call the
existing resolver in tests, retain the native handler's stricter document gate.
No dependency, upstream source copy or production ACL scope change is introduced.

### Reply router correction

`PendingReplies` now records ID, expected kind and host epoch and validates each
step before removing its waiter. Tests exercise all six crossed kind pairs with
the current ID (both the correct-stage status and the other kind's valid status),
duplicate/late replies, unknown fields/statuses, missing evidence, foreign epoch,
invalid uncertainty shape and retirement without a fence. Incorrect packets do
not consume the waiter or generate exit evidence. Existing circuit fakes now emit
the same required fields as the real service; invalid legacy busy/denied packets
remain pending until timeout and preserve the native fence.

### Agents-only observer correction

Managed-agent startup and every consent request await main-thread observer
installation before proceeding. Raising the agents surface rechecks installation
on the UI thread; failure denies by default. The installer itself verifies
`NSThread.isMainThread`, and its key-window callback now invalidates agents reviews
as well as terminal reviews. App deactivation continues to advance the agents
surface epoch even when the parent was already unfocused for its sheet.
Deterministic tests use the production scheduling/admission helper with no terminal
host or previous Quit, require installation before review, and reject a delayed
Yes after deactivation/reactivation. Dispatch failure, installation failure and a
dropped callback deny admission. Real NotificationCenter delivery and AppKit sheet
focus remain separate native acceptance; no application was run here.

### Pre-spawn reservation correction

`host_start::prepare` reserves `Starting` before serialization, resource lookup,
app-data lookup or sidecar construction. Its RAII guard releases on each proven
pre-spawn failure, cancellation/drop or unwind. `Prepared::spawn` disables release
**before** calling the shell plugin. Any returned spawn error, possible spawn,
ready timeout or later loss remains conservatively blocked; only existing host
ready/loss transitions can change it. No inferred process cleanup is added.

The resolved `tauri-plugin-shell` 2.6.0 source was inspected at
[`process::Command::spawn`](https://github.com/tauri-apps/plugins-workspace/blob/128190689dbe59b59d344e01bf07b00862aa3791/plugins/shell/src/process/mod.rs#L387-L470)
(crate VCS SHA `128190689dbe59b59d344e01bf07b00862aa3791`; existing dependency,
Apache-2.0 OR MIT, bundled LICENSE_APACHE-2.0/LICENSE_MIT and SPDX metadata;
no source incorporation or dependency changes): `SharedChild::new(child)?` can fail after OS
spawn. Therefore its generic error is not proof of non-dispatch and cannot safely
release the reservation. Tests inject each of the four actual production preflight
ports plus spawn success/error, pre/post-spawn unwind and dropped preparation.
No host, provider or process is started by these fixtures.

Exact cross-language check (disposable artifact, never committed):

```bash
export ORQST_QUIT_NODE_TRANSCRIPT=/tmp/orqst-quit-transcript.json
pnpm exec tsx --test tests/owned-terminal-shutdown.test.ts
ORQST_QUIT_NODE_TRANSCRIPT=$ORQST_QUIT_NODE_TRANSCRIPT \
  cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml \
  real_node_service_transcripts_keep_the_coordinator_fenced -- --ignored
```

The 2026-11-05 run produced the two-transcript artifact and the ignored Rust
test passed (`1 passed; 0 failed`). It remains ignored by default so an absent
artifact can never be mistaken for a pass.
