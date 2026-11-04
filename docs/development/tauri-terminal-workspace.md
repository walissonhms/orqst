# Retained Tauri terminal workspace

Prepared managed terminals now share one native Tauri window. Each pane retains
its own custom-protocol document, xterm, scrollback, input state and immutable Core
identity. This is an independent visual parity increment; Electron remains until
all migration gates are accepted.

Use the existing opt-in selection and native Managed Terminal menu described in
[the Tauri guide](tauri.md). Opening a selected pane shows the retained workspace;
it starts no CLI. Start, Attach, Enable input and Stop retain separate consent.

- The initial group uses two columns. Choose one, two, three or adaptive columns,
  horizontal/vertical splits and the existing 25–75% two-pane size control.
- Maximize/restore keeps the same documents. Heading drag onto a tab reorders;
  Move earlier/later provides a keyboard alternative. Names are bounded plain text.
- Hide removes a pane visually; selecting its menu entry restores it. Closing the
  workspace hides it and preserves its group. Neither action stops a process.
- Narrow windows page through the retained group. The selected pane remains
  reachable; increasing the window restores the underlying arrangement.
- Input is revoked when focus/layout changes. Explicitly enable it again when
  needed. Stop remains a separate, signed native operation.
- Order, shown panes, selected pane, maximize state, axis, columns, ratio and names
  use the existing private UUID-based layout preference store. Restoring metadata
  never restores or adopts a process. An unavailable preference write is visibly
  reported as memory-only by the existing translated layout feedback.

No new display strings or translation keys are introduced. ORQST identity and the
shared terminal styling are preserved. Existing provider output is never translated.

## Executable checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:tauri
pnpm build:tauri-resources
pnpm accept:tauri-terminals --authorize-synthetic
pnpm accept:tauri-terminals --authorize-synthetic --panes=8
pnpm accept:tauri-core
```

Resource/native builds require the existing Node distribution license and Rust
prerequisites. The extended packaged acceptance launches only disposable labeled
C fixtures through the staged real Node/PTy/Core resources, outside the checkout.
Chromium exercises each shipped Tauri renderer. Native IPC, focus, bounds application
and dialogs are simulated; this does not establish native WebKit/provider acceptance.

## Delivery checklist and limits

- [x] Existing shared terminal document, xterm, native broker and PTY reused.
- [x] One native workspace with 1–8 retained sibling webviews implemented.
- [x] Existing grid, splits, names, order, maximize, hide/show and compact navigation ported.
- [x] Private stable-UUID preference storage reused; no process restoration.
- [x] Exact native webview identity and macOS per-child first-responder validation implemented.
- [x] Native four-pane visual smoke: maximize/restore, rename, reorder, hide/menu restore.
- [x] Anywh source/license and Overclock UX review recorded with concrete reuse decisions.
- [ ] Full native keyboard, dialogs, IME, clipboard and accessibility acceptance.
- [ ] Real Codex/Claude/OpenCode tasks and independent native failure/recovery acceptance.
- [ ] Concurrent native creation menu integration and combined acceptance.
- [ ] SQLite layout/team persistence, arbitrary divider dragging, groups and detach-to-window.
- [ ] Native exports/notifications, structured managed-agent and mention/permission parity.
- [ ] Durable reconnect/profile migration, Linux/Windows/Intel, signed installers and native notices.
- [ ] Complete Electron retirement and owner acceptance of the full migration.

The operational ceiling remains the existing selected 1–8 interactive terminal
contract; there is no new A/B assumption or unlimited-team claim. This increment
adds no provider/model catalog, handles, orchestrator roles or message states.
Layout preferences now use [private SQLite with preserved JSON import](terminal-layout-sqlite.md).
Full team/handle/permission configuration persistence remains pending, so the complete
SQLite persistence criterion is still partial. Existing journal admission
may refuse old profiles before visual preferences can be loaded; preferences are
not a workaround for that boundary. The migration must not delete state to conceal
this limit. The Tauri multiwebview API is behind an unstable feature and needs
revalidation before changing the pinned native dependency.

## Verification on macOS Apple Silicon — 2026-11-04

The debug application bundled successfully with an isolated acceptance identifier.
Native inspection opened four child webviews in one window and verified
maximize/restore, rename, keyboard-accessible reorder and hide/menu restoration.
The renamed heading and order survived hide/show. Native Start reached the exact
owned synthetic-process permission dialog, but after approval the start was denied.
No completed native PTY/input/stop cycle or real-provider execution is accepted.
The focus/confirmation boundary was not relaxed to make that check pass.

The first eight-pane packaging run outlived the fixture's original 25-second alarm.
The acceptance now compiles a fixture with an explicit 90-second test-only bound;
production timeouts and the fixture's default remain unchanged. The second run
passed with eight distinct real synthetic PTYs and retained browser documents.

The first default-concurrency full Node run reported 598 passes and one cancellation
at the existing 55-second `codex-native-initialize` test timeout. No assertion or
production timeout was changed. The complete bounded-concurrency rerun passed all 599 tests, with no failures,
cancellations or skips. No source ingestion
changed; `validate:local`/`validate:live` are outside this increment's validation.

| Command                                                                                      | Result for this isolated increment                                                                               |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                                                  | Passed.                                                                                                          |
| `pnpm typecheck`                                                                             | Passed.                                                                                                          |
| `pnpm test`                                                                                  | 598 passed; one existing initialization test cancelled at its 55-second timeout.                                 |
| `pnpm build`                                                                                 | Passed, including Electron. Existing Vite chunk-size advisory remains.                                           |
| `cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml`                                 | Two passed.                                                                                                      |
| `cargo clippy --manifest-path apps/tauri/src-tauri/Cargo.toml -- -D warnings`                | Passed.                                                                                                          |
| `pnpm build:tauri --debug --bundles app` with an isolated acceptance identifier/product name | Passed on macOS arm64; unsigned local `.app`, no cross-platform release claim.                                   |
| `pnpm build:tauri-resources`                                                                 | Passed; staged Node/Core/dashboard/PTY and 18 JS dependency notices.                                             |
| `pnpm accept:tauri-terminals --authorize-synthetic`                                          | Passed with two independent synthetic PTYs.                                                                      |
| `pnpm accept:tauri-terminals --authorize-synthetic --panes=8`                                | Passed with eight independent synthetic PTYs; native focus/IPC/dialogs/bounds mocked.                            |
| `pnpm accept:tauri-core`                                                                     | Passed with packaged Node/Core, dashboard, cookie API, Analytics worker and graceful shutdown on synthetic data. |

No real provider, source-ingestion acceptance, full dashboard browser suite,
Windows/Linux/Intel or signed installer check ran. Native inspection did not complete
a start/input/stop cycle. The independently owned main checkout, running user sessions,
services, existing profiles and global toolchains were not changed by this branch.
