# Local macOS Desktop client

## Scope and trust

The Desktop client is an Electron window loading the existing React dashboard
from `http://127.0.0.1:4317/`. The Bridge remains the independent Node 24 composition
root and sole SQLite writer. Desktop imports no Core, adapter, database or service
helper and never starts/stops a Bridge or agent. Browser clients continue working.
Closing a macOS window leaves the Desktop application available in the Dock; activating
it reopens the window. The menu-bar tray also opens/restores it. Quitting Desktop also preserves the independently running Bridge
and observer. If the Bridge exits, Desktop cannot keep observation running.

The renderer has sandbox and context isolation enabled, no Node integration, no
preload, no IPC and no webview. Its browser session is in memory with cache disabled.
Requests are restricted to the configured IPv4 loopback origin and its `/ws` socket;
root/hash dashboard navigation is permitted. New windows, subframes, external navigation,
downloads and permission requests are denied. Renderer notifications, media capture, external links and file export are denied.
Native alerts originate only in the main-process monitor described below. No shell opening or
arbitrary URL configuration is exposed. Dashboard content stays untrusted plain text.

The existing bootstrap cookie, Host/Origin/fetch-metadata checks and CSP are unchanged;
Electron does not inject headers, bypass authentication or proxy the API. This is the
same trusted-OS-user loopback model, not remote authentication or proof of the identity
of a local listener. The main process projects bounded snapshot responses into notification evidence;
captured bodies are never rendered in the native UI or logged. Initial load
failure or an HTTP error displays a script-free local page with a restrictive CSP,
localized from the shared en-US/pt-BR resources using the OS locale, and retries every
five seconds. Once loaded, the dashboard retains its existing offline/reconnect state
and refreshes its cookie after Bridge restart. Closing a window cancels its retry timer.

## Verified versions and dependencies

Checked on 2026-11-02:

- Workspace development/build/Bridge: Node `>=24 <25`, private toolchain Node 24.22.2,
  pnpm 10.34.9. Existing esbuild 0.28.2 compiles a separate CommonJS main bundle.
- Electron **45.2.1**, pinned exactly in `@orqst/desktop`: latest stable at verification,
  Chromium **156.0.8078.75**, bundled Node **24.22.1**. The npm install engine is
  `>=22.12.0`, compatible with the workspace toolchain. The bundled runtime is separate
  from system/Bridge Node. No SQLite or native addon is loaded into Electron; no Node
  ABI compatibility is assumed.
- Electron is MIT; its binary includes additional third-party licenses/notices, which
  must accompany future distribution. `i18next` reuses the existing MIT localization
  library/version range; it renders fixed localized fallback, tray and native category text. No packager,
  updater, PTY or native addon dependency is introduced.
- Electron 45 requires macOS **13+** upstream. This increment targets macOS only;
  the smoke records the actual OS/architecture. Intel, other macOS versions,
  Windows and Linux have no ORQST acceptance evidence.

Official references: [pinned release](https://releases.electronjs.org/release/v45.2.1),
[support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines),
[macOS baseline](https://www.electronjs.org/docs/latest/breaking-changes),
[runtime distinction](https://www.electronjs.org/docs/latest/tutorial/tutorial-prerequisites),
[MIT license](https://github.com/electron/electron/blob/v45.2.1/LICENSE),
[security recommendations](https://www.electronjs.org/docs/latest/tutorial/security).
Use `pnpm view electron@45.2.1 version engines license --json` to inspect registry metadata.
Recheck support/security patches before distribution; the pin is not an automatic updater.

## Commands

From the checkout root, using the private toolchain:

```bash
export PATH="$HOME/.local/share/orqst/toolchain/bin:$PATH"
pnpm install --frozen-lockfile
# Explicit local binary download, no global installation or broad lifecycle-script grant:
pnpm --filter @orqst/desktop exec install-electron --no
pnpm build
# Start the Bridge separately only when appropriate; an installed running service suffices.
pnpm desktop
```

Electron 45's npm package has no postinstall script. The binary downloads on first CLI
use, or explicitly with `install-electron --no`, through Electron's official downloader
and checksum verification. `onlyBuiltDependencies` remains limited to `esbuild`;
no unrestricted dependency scripts are enabled. The binary/cache stays outside git.
See [official installation](https://www.electronjs.org/docs/latest/tutorial/installation).
The first download requires network access; subsequent local operation needs no network
service, account, provider key or paid API. Standard lint/types/build need no Electron
binary download. The native smoke requires that binary and a graphical macOS session.

`pnpm dev:desktop` builds the shell and opens it; it intentionally does not start a
Bridge/Vite watcher. `pnpm build:desktop` builds only the shell; `pnpm build` builds
the dashboard, Bridge and shell. `pnpm desktop` launches the last built shell. For a
separately configured Bridge, set `ORQST_DESKTOP_PORT=4320`; only integer ports
1024–65535 are accepted, and the host always remains `127.0.0.1`.
The dashboard must already be built/served by that Bridge. No development-only Origin
exception is added for Electron.

## Verification and distribution limits

`pnpm test` includes pure URL/port security policy tests. `pnpm test:desktop` is an
explicit Playwright `_electron` smoke with a real native Electron window and a real
Bridge using only temporary synthetic sessions, storage and a temporary Chromium
profile. It selects an ephemeral loopback port, preserves unrelated listeners and
cleans up the disposable Bridge/profile. It checks render/Node isolation, denied
permissions/new windows, HttpOnly/Strict cookie issuance, loaded-dashboard reconnect,
window close/reopen, initial offline fallback/retry, and that quitting the client
leaves its independent Bridge available. Window captures are saved under ignored
`test-results/desktop-smoke/`; no captured source data or generated output is committed.
These checks do not validate the installed service, real provider data or the complete
Desktop MVP. Ingestion is unchanged, so no new `validate:local` run is required.

This is a runnable development checkout client, not a distributable signed application.
There is no `.app` packaging pipeline, installer, signing, notarization, auto-update,
bundled Bridge/toolchain or OS service installation.
Packager and distribution identity/entitlements need a separate concrete decision and
acceptance before release. Window/tray mechanism checks need no paid Apple account or changed system settings;
real native delivery requires valid app identity and macOS notification authorization.

## Tray and native alert mechanism — 2026-11-02

A single-instance lock per user-data profile prevents duplicate trays/pollers; a second
launch focuses the first window without accepting external arguments as navigation.
Disposable tests use their own temporary profile and never target the owner instance.
The tray opens/restores the window, quits only this Desktop process and reports
availability of the last successful authenticated Bridge snapshot. Polling is sequential
at two-second intervals, with a five-second request/body timeout, redirects rejected,
JSON validation and an 8 MiB response budget. An unavailable/oversize/invalid response
shows an unavailable unread count, rather than a stale zero. The displayed count is
unread notification history in the latest 200 rows for supported Codex identities;
it is not the number of running agents, pending approvals or all-time unread entries.
Marking history read in the dashboard updates the tray on the next poll.

Native alerts are **off by default** and enabled only through the tray for the current
Desktop run. Closing the window preserves this monitor; quitting Desktop stops it.
There is no persisted native-permission flag or new Bridge setting. Existing completed,
failed and intervention flags gate delivery; `sound: false` maps to native `silent`.
Disabling the tray switch silences all native alerts, without changing history or
Bridge preferences. No per-session/scheduled quiet-hours feature is claimed. The shared
dashboard identifies the shell by a fixed User-Agent marker only to explain the UI and
suppress duplicate browser sound/alerts; this marker grants no native permission.
Browser Notification permission remains denied even for arbitrary renderer content.

Only a new notification history row joined to a runtime-validated event with a sequence
above the previous successful snapshot cursor can alert. The row and event must agree
on ID/session/type/timestamp, and the session must exist as Codex. Source file/hash/line
must be present. Supported mappings are exactly `event_msg:task_complete` + `completed`,
`event_msg:error`/`event_msg:task_failed` + `failed`, and `request_user_input` or
`functions.request_user_input` calls + `waiting_for_user`. This reuses the existing
store's live-only notification decision. No parsing of message prose, inferred completion,
approval/quota/interruption alert, Claude or OpenCode support is added.

Startup, failed requests, cookie expiry/Bridge restart, backward cursor and a gap longer
than ten seconds establish a new baseline without alerts. A monotonic sequence high-water mark is kept
for the Desktop run even across resets, so a rolled-back snapshot cannot replay old
sequences. A replacement database below that mark may suppress alerts until it catches up. Repeated snapshots and
read/disabled rows cannot replay. Events without a matching retained source record are
skipped permanently. The snapshot retains only 150 events and 200 notification rows;
large bursts may lose native alerts. At most three newest matching notifications per
poll are attempted, and at most 20 native objects are retained. Dashboard history is
unchanged. This conservative bounded monitor favors missed alerts over historical or
unproven alerts; it is not a durable OS delivery queue.

Native title/body are only `ORQST` and a fixed localized category: no agent name, source
path, session ID, prompt, conversation, result, secret or error details are copied.
Clicking an in-memory notification fetches a fresh authenticated snapshot and checks
that the Codex session still exists before opening/restoring the window. A percent-encoded
`#session=` fragment is consumed only if it matches an identity in the dashboard's current
snapshot; unknown/malformed/oversize identities cannot open a detail view. The fragment
selects a view, never executes a command or dereferences a source. The normal lifecycle
query, API/WS shapes, cookies, CSP and allowlists are unchanged.

`Notification.isSupported()` indicates API availability, **not authorization or delivery**.
The tray reports `failed`/synchronous API errors using fixed text and never logs OS error
content. An enabled switch does not claim an alert was shown. Electron45 uses macOS
UNNotification and requires code signing for notifications to appear; the development
Electron bundle may have Electron's own identity rather than a distributed ORQST identity.
OS notification settings and Focus can suppress delivery even without a useful API failure.
No app identity, entitlement, signature or system setting is changed by this slice.
Packaging/signing/permission acceptance and real banner/Notification Center click tests
remain a separate distribution/device gate. Do not treat checkout launch or a `show`
callback as visual native delivery acceptance.

Official API references checked for this implementation:
[Tray](https://www.electronjs.org/docs/latest/api/tray),
[single-instance lock](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata),
[Notification, macOS signing, silent, click and failed events](https://www.electronjs.org/docs/latest/api/notification),
[session.fetch](https://www.electronjs.org/docs/latest/api/session#sesfetchinput-init).

The disposable Electron smoke instruments only its own main process: it captures actual
Tray menus and Notification objects and intercepts `show`, testing source ingestion,
content minimization, silent preference, menu count, click-to-session, failure reporting,
window reopening, real second-process restore/reopen with the same disposable profile,
reconnect deduplication and quit lifetime. It does **not** assert OS
visual delivery. No test/privileged channel is shipped to the renderer. The owner window,
installed database and service are never addressed by that smoke.
