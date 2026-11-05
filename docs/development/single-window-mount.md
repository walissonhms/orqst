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

### Reply router correction

`PendingReplies` now records ID, expected kind and host epoch and validates each
step before removing its waiter. Tests exercise all six crossed kind pairs with
the current ID (both the correct-stage status and the other kind's valid status),
duplicate/late replies, unknown fields/statuses, missing evidence, foreign epoch,
invalid uncertainty shape and retirement without a fence. Incorrect packets do
not consume the waiter or generate exit evidence. Existing circuit fakes now emit
the same required fields as the real service; invalid legacy busy/denied packets
remain pending until timeout and preserve the native fence.
