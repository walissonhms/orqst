# Tauri native notifications, tray and lifetime — 2026-11-04

Baseline: clean `main` at `332aca9`; development uses an isolated worktree.
Node 24.22.2, pnpm 10.34.9, Tauri 2.12.5 and the existing strict TypeScript,
React dashboard, SQLite Core and owned terminal/agent hosts remain authoritative.
The baseline Node suite passed 623 tests. Research used a separate bare Anywh
repository; no upstream executable, installer or test script was run.

## Component decisions

Anywh remains pinned to
[`546f189c04415c3c5af5f40e3931a0a90b9aba31`](https://github.com/anywh-sh/anywh/tree/546f189c04415c3c5af5f40e3931a0a90b9aba31).
Its `docs/architecture.md`, `docs/agent-host.md`, `relay/src/runtimes/README.md`
and actual native notification/lifecycle sources were re-inspected.

| Candidate                             | Exact source and dependencies                                                                                                                                                                                                                                                                                                                  | Decision and contract differences                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native notification delivery          | [`client/src-tauri/src/notifications.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/notifications.rs), `notify_turn_complete`; Tauri notification plugin, custom Windows toast                                                                                                      | **Adapt the native plugin boundary**, retaining ORQST's monitor. Do not copy the renderer-controlled title/body/session command, Windows identity fallback or captured-response text. ORQST exposes no notification command or permission to the observer.                                                                                                                 |
| Notification selection and permission | [`client/src/lib/platform/notifications.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/lib/platform/notifications.ts), `ensureNotificationPermission`, `notifyTurnComplete`, `cleanBody`                                                                                                      | **Keep existing ORQST.** Its persisted notification/source joins, startup/reconnect baseline, monotonic cursor, preferences and three-alert poll cap already solve evidence selection without leaking agent content. Extract the unchanged pure `DesktopMonitor` to Core; Electron keeps its validated HTTP adapter and re-exports the same monitor.                       |
| Click routing                         | [`client/src/hooks/platform/useNotificationClick.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/hooks/platform/useNotificationClick.ts), `useNotificationClick`                                                                                                                               | **Do not copy.** This pin describes plugin 2.3.3 with no macOS/Linux click hook. The actual ORQST resolution is 2.8.0 and supports native action callbacks. Revalidate against its source below. Restore the current owned window; session-specific routing remains pending.                                                                                               |
| Native sidecar and shutdown           | [`client/src-tauri/src/tailnet_sidecar.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs), `tailnet_sidecar_start`, `kill_all`; [`lib.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/lib.rs), `run_with` | **Keep and extend the existing attributed adaptation.** Drain fixed metadata from the same owned child. No second session manager, remote relay, child adoption or automatic restart. Native close keeps the document until existing managed-host exit consent resolves.                                                                                                   |
| Tray and close policy                 | Anywh's pinned `client/src-tauri/src/lib.rs` has no tray implementation; ORQST `apps/desktop/src/main.ts`, tray/poll/quit blocks                                                                                                                                                                                                               | **Keep ORQST behavior where compatible.** Native per-run opt-in, bounded qualified unread count, restore and single instance remain. Tauri owns its Core, unlike Electron's external Bridge: explicitly label Quit and default main-close as owned-Core shutdown; offer a per-run native keep-running checkbox. Do not copy Electron's “Quit Desktop only” lifetime claim. |
| Agent host and communication          | Anywh architecture/runtime files above; the preserved [Tucano audit](../architecture/tucano-audit.md) and existing mention/permission implementation                                                                                                                                                                                           | **Keep existing ORQST.** This increment neither changes a CLI driver nor routes agent tasks. Replacing hosts or copying a chat router would expand authority and not implement observer notifications.                                                                                                                                                                     |

## Native dependency revalidation

`Cargo.lock` pins `tauri-plugin-notification 2.8.0`. Its published `.cargo_vcs_info.json`
identifies upstream commit `128190689dbe59b59d344e01bf07b00862aa3791`, path
[`plugins/notification/src/desktop.rs`](https://github.com/tauri-apps/plugins-workspace/blob/128190689dbe59b59d344e01bf07b00862aa3791/plugins/notification/src/desktop.rs).
Inspected `NotificationBuilder::show`, `Notification::on_action`, `permission_state`,
`request_permission`, `imp::show_tracked`, `wait` and `close`:

- Desktop permission methods always return Granted; they do not prove OS authorization.
- Delivery is dispatched asynchronously. Success means payload preparation, not banner delivery.
  Background OS delivery errors are not surfaced to the application.
- Action callbacks now exist. On macOS/Windows the plugin retains a waiting thread for
  a tracked notification, and cannot withdraw shown notifications. ORQST therefore
  permits at most 20 attempts for the entire native run, without reset on toggling.
- `silent()` is iOS-only. Desktop sound is controlled by omitting `sound` when disabled;
  macOS enabled sound uses its actual `NSUserNotificationDefaultSoundName` constant.
- A callback only restores the retained main window; no external URL, supplied path,
  notification content, task dispatch or session adoption is accepted.

The exact Anywh root [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
is Apache-2.0; the pinned tracked tree has no NOTICE or nested grant. Existing
attribution and modification notices for the adapted sidecar/single-instance code
remain in `NOTICE`. No new Anywh text parser, response-content code, asset or
Windows toast implementation is incorporated.

The notification plugin and Tauri tray feature declare Apache-2.0 OR MIT;
`notify-rust 4.18.2` declares MIT OR Apache-2.0, and `mac-notification-sys 0.6.15`
declares MIT. Image decoding dependencies include Apache/MIT and BSD-3-Clause OR
Apache-2.0 choices. Cargo generated the lock changes; existing dependencies were
not upgraded independently. These compatible grants do not complete the previously
pending transitive native redistribution/NOTICE audit. No signed distribution is
approved by this local development increment.

## Concrete authority boundary

The fixed Node entry reads its own validated Store projection every two seconds,
only with `ORQST_NATIVE_MONITOR=1` supplied by Rust. It sends bounded category/sound
and unread metadata over the existing private stdout pipe. It sends no session ID,
source body/path, result, credential or cookie. The observer renderer receives no new
Tauri capability, event listener or generic native notification method. HTTP/WS,
authentication, static serving and captured-source access are unchanged.

The [delivery guide](../development/tauri-native-desktop.md) records tests, commands,
actual acceptance and the remaining integration checklist.
