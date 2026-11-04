# Tauri native alerts, tray and lifetime

This increment adds an ORQST tray to the Tauri preview. It reuses the Electron
source-gated monitor and the existing owned Node Core; Electron remains available
until full desktop parity is accepted. See the [pinned source and dependency review](../research/tauri-native-desktop.md).

## Behavior

- The native tray shows Core connection state and unread count from the latest
  200 persisted notification rows. Unknown/stale connection never shows a false zero.
  A ten-second metadata gap clears connection/count availability.
- **Native alerts for this Desktop run** defaults off. Enable it in the native tray.
  Existing dashboard categories and sound preferences still apply. Alerts contain only
  ORQST and a fixed translated category; captured content never enters OS payloads.
- Only existing explicit Codex completion, failure and `request_user_input` source
  evidence qualifies. Startup/import/replay, rollback and reconnect do not alert;
  inactivity never means completion. There are at most three attempts per poll and
  20 attempts per application run. Excess is consumed without a replay queue, while
  dashboard history remains available. Toggling does not reset the run limit.
- Clicking an OS alert restores the current main window when the OS/plugin reports
  the action. It does not select a particular session. Cold-start/session click routing
  and withdrawal of delivered macOS/Windows alerts are not implemented.
- **Open ORQST**, macOS Dock reopen and a second launch restore/unminimize/focus the
  retained main window without reloading its dashboard or starting another Core.
- Main-window close defaults to quitting the preview and its owned Core, even if
  managed windows are open. The document is retained while existing managed-host
  quit/disconnect consent runs; Cancel preserves the application. This differs from
  Electron's external-Bridge lifetime.
- **Keep running when the main window closes (this run)** explicitly changes main-close
  to hide. It keeps the document, Core and prepared hosts alive. Native restore shows
  the same window. This checkbox is memory-only and defaults off on the next run.
- **Quit ORQST and its owned Core** always uses the existing managed-host consent
  gates, stops alert admission/watchdog/tray, drains hosts and gracefully shuts down
  the owned Core through stdin with its existing bounded fallback. No external
  Bridge/service/session is stopped. Terminal-window hide remains independent.

Native labels use the same checked-in en-US/pt-BR dictionaries as the existing
preparation menu, selected from process `LANG` at launch. They do not yet follow a
live change to the dashboard's independently selected language.

## Security and failure reporting

The Rust-only notification plugin has no observer renderer capability. No new
invoke handler, generic shell grant, endpoint, cookie or WebSocket shape is added.
The native user-agent marker suppresses duplicate browser alerts using the existing
React behavior; that marker grants no privilege. The private Core pipe sends fixed,
validated frames capped at 1024 bytes, 200 unread and three category/sound entries.
Backpressure discards alert opportunities and rebaselines; it never grows an alert
queue. Shutdown/EOF clears the monitor timer before Store cleanup. The native side
also rebaselines stale/invalid/disconnected metadata, retains at most one pending UI
frame and uses a generation fence so discarded or pre-crash frames cannot revive
connection state or produce alerts.

The plugin's desktop permission check is not proof of OS authorization. `show()`
success confirms preparation only: OS settings, Focus, identity, signing and notification
server policy can suppress delivery. A reported preparation failure stops further
attempts until off/on; background delivery failures are not observable through this
plugin and must not be labeled successful. Delivered notifications can outlive the
application on macOS/Windows; their callbacks cannot mutate a stopped application.

## Validation

Use the Node 24 / pnpm 10 and Rust toolchains documented in [Tauri](tauri.md).
The existing build requires `ORQST_NODE_LICENSE` for the exact bundled Node executable.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm build:tauri-resources
pnpm test:tauri
pnpm build:tauri --debug --bundles app
pnpm accept:tauri-core
```

`tests/desktop-monitor*.test.ts` continue exercising the same monitor consumed by
Electron and Tauri. `tests/desktop-sidecar.test.ts` adds a disposable Node/SQLite
native-pipe check: real append ingestion, source-backed alert, deduplication, bounded
content-free payload and graceful EOF. Rust tests exercise malformed/private/oversized
frames, stale/reconnect baselines, opt-in, preparation-failure fencing and total attempt
limits. These are synthetic source tests, not real provider/OS delivery acceptance.

### Execution record — 2026-11-04

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (624 passed, no failures/skips),
  `pnpm build` and `git diff --check`: passed. The existing Vite chunk-size advisory remains.
- The focused monitor/actual Node/SQLite checks passed 17 tests. An initial new pipe
  assertion used a historical fixture timestamp, correctly producing no live alert;
  the fixture now uses a current timestamp. No live-source age check was weakened.
- `cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml -j 1`: nine tests passed,
  including metadata bounds, opt-in/reconnect, UI-queue generation/backpressure,
  preparation failure and pre-existing terminal/agent native identity guards.
  Rustfmt checks passed for the three changed Rust files. Native test/build used
  `CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0` with Rust 1.99.1.
- `pnpm build:tauri-resources` and `pnpm build:tauri --debug --bundles app` passed on
  macOS Apple Silicon, producing the local default `ORQST Preview.app` (167.71 MiB).
  An additional acceptance-only bundle used identifier `dev.orqst.native686.acceptance`
  and product name `ORQST Native 686`, without changing the checked-in configuration.
- `pnpm accept:tauri-core`: passed copied packaged Node/Core, dashboard, authenticated
  API, production Analytics worker and graceful shutdown outside the checkout with
  synthetic data. This is Chromium/packaging evidence, not native WebKit acceptance.
- Native UI inspection was **unsuccessful**: Computer Use reported `timeoutReached`,
  then `cgWindowNotFound`. Its app-selection API launched the distinct acceptance
  identity with the default read-only source root, not the intended empty fixture
  environment. No provider was launched and no input was sent to an observed session.
  The temporary native process and its owned Core were stopped and their PIDs/port
  were verified absent. Native menus, close/hide/restore, sound and banners remain
  unaccepted; the failed attempt is not counted as native visual delivery.
- Initial Rust builds failed with `ENOSPC`, including a compact-profile attempt.
  Only this worktree's generated target was cleaned with Cargo; resuming a one-job
  compact build succeeded after space became available. A subsequent compiler error
  converting the plugin error to `tauri::Error` was corrected using the setup's
  existing boxed-error boundary; final tests/build passed.

`cargo clippy`, full browser/Electron/PTY/native-provider acceptances,
`validate:local`/`validate:live`, signed installers and other platforms were not run
for this increment. The observer reader/normalization/ingestion behavior is unchanged.
The final native queue refinement was followed by its nine Rust tests and
`pnpm build:tauri --debug --bundles app --config '{"build":{"beforeBuildCommand":""}}'`.
That successful final bundle reused this worktree's native target and already validated
staged resources; the override skips resource restaging only. No checked-in app
identity, capability or build configuration was changed by the acceptance commands.

## Integration and platform checklist

- [ ] Human native tray interaction, alert delivery and sound on signed macOS.
- [ ] Native click restore and OS suppression/denial/failure behavior.
- [ ] Native close default, explicit background hide/restore and second launch with one Core.
- [ ] Managed terminal + structured-agent coexistence; cancel each exit review without loss.
- [ ] Crash/stall Core while hidden: unknown count, no automatic respawn or old alert replay.
- [ ] Session-specific click-through with fresh source identity revalidation.
- [ ] Windows/Linux/Intel packaging, tray availability and platform-specific sound/actions.
- [ ] Complete native transitive notices, signing/notarization and distribution acceptance.
- [ ] Remaining Electron migration: exports, PTY MCP consent, retirement/reselection,
      durable reconnect/profile migration and real CLI/native acceptance.

This increment does not run Codex, Claude or OpenCode, change observed-source access,
or accept any real multiagent workflow. The master specification remains partially
implemented. Rollback uses the unchanged Electron commands; no user database migration
or installed runtime replacement is involved.
