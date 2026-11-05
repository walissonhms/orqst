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
