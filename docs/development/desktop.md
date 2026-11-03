# Local macOS Desktop client

## Scope and trust

The Desktop client is an Electron window loading the existing React dashboard
from `http://127.0.0.1:4317/`. The Bridge remains the independent Node 24 composition
root and sole SQLite writer. The default observer path never starts/stops a Bridge
or agent. The separately opted-in legacy Managed Terminal imports Core authorization
helpers and connects to its own Node host. The explicit
[Managed agents surface](managed-agents-client.md) now composes the structured
existing-login runtime in a separate native document and Node host. Neither path
grants the observer dashboard control over external sessions. Browser clients continue working.
Closing a macOS window leaves the Desktop application available in the Dock; activating
it reopens the window. The menu-bar tray also opens/restores it. Quitting Desktop also preserves the independently running Bridge
and observer. If the Bridge exits, Desktop cannot keep observation running.

The renderer has sandbox and context isolation enabled, no Node integration and no webview. The later Artifacts slice adds only the narrow
isolated preload/IPC described below. Its browser session is in memory with cache disabled.
Requests are restricted to the configured IPv4 loopback origin and its `/ws` socket;
only root and exact `/overview`, `/workspaces`, `/agents`, `/models`, `/settings`
dashboard navigation plus validated `/overview/sessions/<encoded-id>` is permitted,
with legacy fragments and no query or credentials. New windows, subframes, external navigation,
downloads and permission requests are denied. Renderer notifications, media capture, external links and downloads are denied.
Markdown export is available only through the native Artifacts action described below.
Native alerts originate only in the main-process monitor described below. No generic shell, filesystem, URL or path method is exposed. Dashboard content stays untrusted plain text.

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

**Managed Terminal → Select and review existing terminal manifests…** now selects
one or two existing manifests through a native file chooser and complete native
review, without restarting this build. Review is memory-only; a separate Open
initializes the fixed pair and its existing admission/journal path. Blocked OpenCode
manifests create only blocked views. Native CLI start remains separately signed.
No renderer path method or second-instance import exists. Selection becomes fixed
once initialization is attempted, including failures; no live pair is replaced.
See [the flow, same-provider limit and focus gates](opencode-desktop-terminal.md#select-an-existing-manifest-in-a-running-desktop).

The owner-supplied application icons are stored in `apps/desktop/resources/icons/`
and copied beside the built main process. The running macOS Dock uses the supplied
PNG, the menu-bar tray uses a cropped high-resolution source at 24 x 20 points
with 1x/2x representations and original colors (non-template), and the shared dashboard
has an ICO favicon. Windows window/tray ICO and Linux PNG selection are implemented but have not been accepted
on those operating systems. The supplied ICNS is retained for future
packaging; this does not create an installer or change Electron's installed app bundle.
See [asset provenance and usage](../../apps/desktop/resources/README.md).

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

### Checking which build is active without losing work

The checkout has three independently loaded layers:

- The Bridge serves `apps/dashboard/dist` from disk on each static request. Compare
  a new loopback GET of `/` and its exact JS/CSS asset URLs with those files to
  establish the bytes served now. Do not request session APIs or publish cookies
  or captured content for this check.
- An already loaded dashboard keeps its JavaScript and in-memory drafts. Disabled
  cache does not hot-replace its document after a build. Fresh HTTP bytes do not
  establish which bytes that existing renderer loaded.
- Electron loads `apps/desktop/dist/main.cjs` at process startup and each isolated
  preload/document when its window is created. Rebuilding the shell does not
  replace the running main process. Starting another instance only activates the
  existing single instance; it is not an update. Main-process startup predating a
  changed bundle rules out loading that new main bundle at startup. A later
  timestamp alone is not an attestation of exact loaded bytes.

Keep the existing window and managed hosts alive during inspection. A dashboard
reload must go through the existing draft guard after the owner saves, discards or
cancels the draft; do not force navigation, clear storage, recreate the window or
restart the Bridge to check freshness. Reloading an owned terminal can revoke its
channel and is not a refresh strategy. Shell changes require a separately planned
quit/relaunch once managed lifetime/ownership and drafts are reconciled; do not
infer safe shutdown from a hidden window or an idle-looking pane.

Validate new builds independently with `pnpm test:desktop`: its disposable profile,
synthetic Bridge/database and separate port exercise the built Electron main,
preloads and renderer without replacing the owner's instance. Synthetic native
agent checks are separately explicit (`pnpm accept:managed-agents
--authorize-synthetic-agents`). Neither check starts a real Codex provider or
establishes real-account, active-window modal/focus or two-real-agent acceptance.
No automatic update, hot reload, loaded-build attestation or owner-state migration
is implemented by this workflow.

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
profile. On macOS it also checks the tray image's 24 x 20 point size, 1x/2x
representations, non-template mode, retained color and effective visible bounds. This does
not assert visual menu-bar contrast. It selects an ephemeral loopback port, preserves
unrelated listeners and cleans up the disposable Bridge/profile. It checks render/Node isolation, denied
permissions/new windows, HttpOnly/Strict cookie issuance, loaded-dashboard reconnect,
window close/reopen, initial offline fallback/retry, and that quitting the client
leaves its independent Bridge available. Window captures are saved under ignored
`test-results/desktop-smoke/`; no captured source data or generated output is committed.
These checks do not validate the installed service, real provider data or the complete
Desktop MVP. Ingestion is unchanged, so no new `validate:local` run is required.

## Synthetic client testing and structured runtime boundary

The normal Electron window and the browser at `http://127.0.0.1:4317/` display
the same Bridge-served observer dashboard: sessions, timeline, attention, token
observations, model analytics, artifacts and settings. Observed session statuses
describe captured evidence; they are not owned-process lifecycle confirmations.
The observer preload exposes only artifact/analytics operations, not terminal
authority. Without `--terminal-config`, the current checkout's native terminal
menu is disabled. An already-running older shell is not updated by rebuilding files.

For a visual check without provider execution or owner data, build and run:

```bash
export PATH="$HOME/.local/share/orqst/toolchain/bin:$PATH"
pnpm build
ORQST_DESKTOP_SMOKE_OUTPUT="$PWD/test-results/desktop-smoke" pnpm test:desktop
```

This opens a separate real Electron client and real Bridge on an ephemeral loopback
port with a temporary profile/database and explicitly labeled synthetic sessions.
It asserts visible fixture content, absence of the terminal renderer API and the
disabled native terminal menu, and saves `synthetic-observer.png`, `online.png`
and `offline.png`. Output is ignored by Git. Dialogs, editor launch and native alert
delivery are intercepted; this does not establish human confirmation or OS banner
acceptance. It neither restarts the installed Bridge/Desktop nor inserts fixtures
into owner storage. No provider, login or inference is needed.

The existing `accept:terminal-native --authorize-synthetic-pty` command is a
separate synthetic Electron/Node/PTY lab with real fixture I/O. It does not compose
the structured Codex A-to-B-to-A runtime into this dashboard. `--terminal-config`
opens the legacy separate-login Managed Terminal and rejects existing-login reuse;
it is not a shortcut to the structured path. The separate **Managed agents** button
now exposes signed starts and structured delegation/results for two fresh private
slots. No source-preservation report is inferred from those client facts. Acceptance
stdout cannot be presented as a visible client result.

Real two-agent client acceptance remains blocked by unresolved native startup,
lifecycle/source-preservation acceptance. The structured Desktop contract and
fixture-backed client tests are described in [the client guide](managed-agents-client.md).
Existing quarantines remain intact;
synthetic UI evidence cannot reconcile them or authorize a retry.

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
`#session=` fragment is accepted only if it matches an identity in the dashboard's current
snapshot; unknown/malformed/oversize identities cannot open a detail view. Valid
links canonicalize to `/overview/sessions/<encoded-id>` for reload/history; IDs
unsafe for a canonical path segment retain their legacy hash form. The live
main-frame IPC sender check uses this same fixed path allowlist while retaining webContents, session, frame and document equality checks. The fragment
selects a view, never executes a command or dereferences a source. The normal lifecycle
query, API/WS shapes, cookies and CSP are unchanged. The observer navigation
allowlist is the shared dashboard route schema.

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

## Native Markdown Artifacts

The shared Artifacts panel detects the version-1 `window.orqstArtifacts` capability.
Its isolated CommonJS preload exposes only `saveMarkdown`; Electron, IPC events,
filesystem handles, paths and reusable grants never cross into the page. The preload
requires transient activation and admits one call at a time. This is defense in depth:
main validates the DTO and live window/webContents/session/main-frame/document origin,
then obtains authority exclusively from the native save dialog and overwrite prompt.
Every navigation (including leaving and returning to the same URL), crash, destruction,
window close and quit invalidates pending authority. Main admits one save at a time,
without queueing. Each retry requires a new native grant. Closing the panel is disabled
while a save is pending; closing/navigating the window revokes it.

Main reextracts the exact selected retained message through the existing authenticated
HTTP endpoint, using the in-memory Electron session, redirects denied, a five-second
request/body timeout and 256 KiB response ceiling. The complete response contract and
all request identities/source hash must match. Original saves use this verified retained
text; draft saves use separate bounded page text and never claim it is retained original.
The panel keeps recorded provenance and immutable original visible; saved files contain
only the explicitly selected Markdown text, without fabricated metadata or versions.

The save dialog suggests only `artifact.md`, filters `.md` and does not add recent items.
Filters alone are not security: main checks the actual extension and canonical parent.
Existing regular, nonexecutable single-link files must be at most 32768 bytes; symlinks,
hardlinks, directories, aliases resolving to a different/nonregular target and large or
ambiguous destinations fail closed. macOS aliases are not dereferenced by the writer;
the descriptor always refers to the actual selected regular file. Replacement requires
an additional native warning displaying the exact canonical path, defaulting to Cancel.
Cancel writes nothing. See [the contract](../api/artifacts.md#native-desktop-save-contract)
for descriptor checks, failures and concurrency limits.

**Save and open** authorizes one `shell.openPath` call with only this operation's freshly
saved, reverified `.md` path. No open-only method, source/history path, URL, executable,
command line or reusable grant is accepted. The configured system file association is
used; ORQST cannot guarantee it is an editor or that a window appeared. No shell command
string, `openExternal`, renderer permission exception or clipboard workaround is added.
Changing the default Markdown application remains an OS/user choice.

The explicit disposable Electron smoke exercises real preload/IPC, reextraction and file
writes, while intercepting native dialog choices/confirmation and editor dispatch in
that temporary main process. It does not accept native dialog visuals or an actual
external editor launch. The owner client and Bridge are preserved. Run `pnpm build`
and `pnpm test:desktop` with the pinned toolchain; no real agent data is used.

Official references checked for this boundary: [dialog](https://www.electronjs.org/docs/latest/api/dialog),
[IPC sender validation](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages),
[contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge),
[openPath](https://www.electronjs.org/docs/latest/api/shell#shellopenpathpath),
[Node 24 filesystem flags](https://nodejs.org/docs/latest-v24.x/api/fs.html#file-system-flags).

## Analytics export boundary

Supported clients offer native CSV/Markdown save through `orqstAnalytics` v1, separate
from Artifacts. Native downloads remain denied; old clients without this capability
show an unavailable explanation. Main reobtains the current validated aggregate,
compares the confirmed reading's digest/query/cursor and checks live context after
async work. Refresh/filter/ranking/connection/document changes revoke pending authority.
One file operation runs at a time; cancelled/busy/consumed readings require Refresh.

Only a native destination and explicit replacement confirmation authorize writing.
CSV requires exactly `.csv`, Markdown `.md`; output and existing destinations are
bounded to 2 MiB with the same descriptor policy as Artifacts. There is no external
open. Two sequential revalidations each have a 15-second HTTP/body deadline and can
fail busy without retry. This is not an atomic database-to-file snapshot or atomic
replacement. See the [full native contract and review](../api/analytics-export.md).

The disposable smoke covers real preload/IPC, authenticated aggregate retrieval,
CSV/Markdown writes, cancel, overwrite denial/approval, extension refusal and context
revocation. Native dialogs and external dispatch are intercepted; this does not prove
native visual acceptance. The profile, Bridge, sessions and files are synthetic and
disposable. `ORQST_DESKTOP_SMOKE_OUTPUT` optionally places screenshots in an exclusive
output directory; by default they are discarded with the temporary profile. Never
use the owner's profile or installed Bridge for this smoke.

## Terminal scope

The shared session details now provide a bounded **Observed tools** evidence view.
It does not attach to a process or expose input/interrupt controls. See the
[terminal boundary](terminal-boundary.md) for supported semantics and the concrete
managed-execution decisions required before an interactive terminal can ship.

## Separate native Terminal acceptance application — 2026-11-03

The [explicit synthetic native lab](terminal-native-acceptance.md) composes its own
restricted document, session, preload and native IPC runtime with an owned Node-host
PTY. It is built only by `pnpm accept:terminal-native --authorize-synthetic-pty`,
never by normal Desktop startup/build or automatic tests. The regular observer
main/preload, shared route allowlist and sender policy keep their boundaries. No
Desktop terminal menu, provider execution or external-session authority is enabled.
Real transport acceptance uses intercepted native dialogs; native human/modal and
Codex-specific acceptance remain pending.

## Prepare a pair entirely in the client — 2026-11-03

The new native **Create and review terminal pair A/B…** action precedes existing
manifest selection/opening. Choose reviewed canonical CLI/Node binaries and an empty
disposable project, review complete private files and explicitly acknowledge shared
native identity/session effects. No CLI is executed by creation, including version
checks. Optional MCP is a separate provider-specific selection; OpenCode stays blocked.
A proven pre-admission/Core view failure can now reopen selection after cleanup;
capacity, journal or uncertain state retains its existing reservation. See the
[complete workflow and recovery limits](cli-team-recovery.md). A loaded old shell
is preserved and will not acquire this menu merely from a build or second instance.
