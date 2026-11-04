# Tauri Desktop preview

The owner-approved desktop target is Tauri 2 with the existing React dashboard,
Node 24 Core and SQLite. `apps/tauri` is the first runnable migration increment.
Electron remains available through the existing commands until feature parity is
validated. The observer is unchanged; native-menu preparation or explicitly selected
profiles can open a retained terminal workspace. Prepared structured agents have a
separate opt-in Tauri bridge. Native file exports reuse the Electron savers through a
narrow bridge; [native tray and source-gated alerts](tauri-native-desktop.md) are
also implemented. Native human and provider acceptance remain pending.

The native terminal menu also offers [signed retirement and safe reselection after
restart](tauri-terminal-retirement.md). It preserves uncertain reservations and
keeps old native selections locked for the application lifetime.

## Build and run

Use the repository's Node 24 / pnpm 10 toolchain, a Rust toolchain and the
[native Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for the host.
No global tool installation is performed by the build. `Cargo.lock` pins native
dependencies; `pnpm-lock.yaml` pins the Tauri CLI (`2.12.4`). The current lock resolves
Tauri `2.12.5`, shell plugin `2.6.0`, single-instance plugin `2.5.5` and Tokio `1.54.1`.

Set `ORQST_NODE_LICENSE` to the complete LICENSE from the **same distribution as the
Node 24 executable running pnpm**. This includes Node's third-party notices, not just
the short MIT grant. The copied executable and license hashes are recorded in the
ignored `apps/tauri/dist/core/runtime.json`. The build does not download a runtime or
guess a cross-target executable.

```sh
export ORQST_NODE_LICENSE=/path/to/node-distribution/LICENSE
pnpm dev:tauri

# Local debug application bundle; no public release or signing acceptance implied.
pnpm build:tauri --debug --bundles app

pnpm test:tauri
pnpm accept:tauri-core
```

`build:tauri-resources` builds the unchanged dashboard, bundles the existing Bridge
and its Analytics worker as self-contained ESM, stages the current Node executable,
and copies ORQST/Node/JavaScript dependency notices. The macOS native executable lives
inside `apps/tauri/src-tauri/target/debug/bundle/macos/ORQST Preview.app`.
The application includes Node and its built Core; the installed app needs neither
Electron nor a workspace `node_modules`. Building still requires the development
toolchain. Generated `dist`, `target`, `gen` and `binaries` are excluded from Git.

## Lifetime, state and security

The native shell starts one fixed Node entry through the Rust-only shell plugin.
It waits up to 30 seconds for `ORQST_CORE_READY <port>`, then opens the React dashboard
at that IPv4-loopback origin. Only a valid port is accepted; the Core must have
started observation and validated the packaged `index.html` before announcing
readiness. The native preview uses stable loopback port `4319`, preserving origin-scoped UI
preferences across restarts. Set `ORQST_TAURI_PORT` to another 1024–65535 port if
needed. A collision fails startup; the shell never attaches to an unknown service.
Standalone disposable Core checks omit `ORQST_PORT` to request an OS-selected port.

A second launch focuses the existing application before starting another Core.
The child receives an explicit environment allowlist; `NODE_OPTIONS`, `NODE_PATH`
and unrelated credentials are not inherited. The owned dashboard receives only a narrow native file-export capability;
standalone observer browsers receive none. Navigation remains on the owned origin, new windows are
denied, and the existing Bridge CSP, cookie, Host/Origin checks and API/WebSocket
validation remain authoritative.

The preview owns a separate `core/orqst.db` under the OS application-data directory
for `dev.orqst.desktop.preview`. It intentionally does not reuse `ORQST_DATA_DIR`
from a running service or open the Electron managed-terminal journal. On macOS the
normal path is `~/Library/Application Support/dev.orqst.desktop.preview/core`.
Core still enforces private directory/database permissions. Codex source files
remain read-only; `ORQST_CODEX_SESSIONS` can select a disposable acceptance source.
No existing database or preference profile is migrated automatically.

By default, closing the main window requests application exit; a native per-run
keep-running checkbox instead hides the retained window. Explicit Quit always
passes through managed-host consent. Closing the application requests shutdown on the private stdin pipe, waits up to
five seconds for Core cleanup, then kills only the owned child if necessary.
Parent pipe EOF also requests cleanup. A crashed Core is removed from native state
only for its exact child identity. There is no automatic process respawn, stored-PID
adoption or claim that a disconnected frontend recovered a process. The current
preview only disconnects explicitly selected managed hosts after native quit consent;
owned descendant containment is not guaranteed. Hiding a terminal window keeps its host alive.

## Acceptance and remaining work

On macOS Apple Silicon, this increment built a debug `.app`, opened the real Tauri
window, navigated Overview → Settings, preserved the same Node PID on a second
launch, and closed the application and child. Native inspection used a disposable
empty session root. A changed theme also survived quit/reopen at the stable origin;
the original theme was restored after the check. An earlier native inspection timed out; it is not counted as a
successful run or real-data acceptance.

`tests/desktop-sidecar.test.ts` exercises actual disposable Node processes, readiness,
authenticated HTTP, source immutability, SQLite permissions/checkpoints, stdin/EOF
shutdown, isolated startup failure and absent dashboard rejection. The separate
`accept:tauri-core` copies built resources outside the checkout, runs the shipped
Node binary with synthetic source data, opens the built dashboard in Chromium,
queries the colocated production Analytics worker and verifies graceful exit.
This proves packaging and browser operation, not native WebKit/provider equivalence.

The migration is **not complete**. Prepared PTY terminals have the opt-in bridge below;
native export acceptance, full menu parity and OS-notification delivery acceptance,
durable reconnect and profile migration require incremental
parity work. N-member teams and installed-provider CLI mention/return acceptance remain separate
requirements of the master specification. Prepared structured permissions and editable
handles now have the opt-in bridge below. This change
does not run Codex, Claude or OpenCode, and does not certify any real-provider task.

Windows/Linux builds, macOS Intel, signed/notarized installers and the complete
native transitive redistribution-notice audit have not been accepted. The local
debug bundle is not a release candidate. See the [source review](../research/tauri-core-reuse.md).

## Prepared managed terminals — 2026-11-04

On non-root macOS Apple Silicon, select **fresh** manifests produced by the existing
`terminal:setup` workflows. Set an explicit JSON array of canonical absolute paths
before launching the preview:

```sh
export ORQST_TAURI_TERMINALS='["/absolute/private/terminal-a.json","/absolute/private/terminal-b.json"]'
pnpm dev:tauri
pnpm accept:tauri-terminals --authorize-synthetic
```

Omitting the variable keeps observer-only startup. Selection supports the existing
1–8 same-provider contract and reviewed Codex/OpenCode pair. It retains executable
hash/version checks, native-session acknowledgments, duplicate/overlap rejection,
private file permissions and sticky admission. Existing journals are refused; never
select profiles currently owned by Electron. Explicitly prepared MCP-enabled pairs
now use the [native task-grant review](tauri-interactive-mcp.md), separately from each
signed process start. Native/provider acceptance remains pending. Selection failure leaves the
observer available and prints a fixed refusal without paths or backend diagnostics.

Use the native **Managed Terminal** menu to show prepared panes in the retained workspace. Start, connect
output, enable input, bounded paste and stop use the existing native broker's signed
grants. The shell creates the document; its command identity determines the slot.
Closing or hiding a terminal window revokes input and preserves its process, document,
scrollback and draft. Reopen from the same menu; no process is relaunched. Native window
resize reaches the existing xterm fit and PTY resize transport. Reload permanently
fences that document; it does not adopt or restart anything. Quitting asks to disconnect
owned work, then closes the private Node hosts; arbitrary descendants are not contained.

The shared terminal document serves both the Electron grid and the retained Tauri
workspace. Tauri now keeps independent child webviews in one native window, with
shared layout geometry, private UUID-based preferences, plain-text names, reorder,
hide/show, maximize/restore and compact paging. See the
[workspace workflow and remaining parity gates](tauri-terminal-workspace.md).

The Tauri frontend reuses Electron's terminal document, xterm client, schemas and
Node hosts without importing the Electron runtime. Its two commands are available
only to the dedicated custom-protocol windows. The dashboard keeps zero native managed-execution capability; its file-export
capability is separate. No execution HTTP route or WebSocket message
is added. See [native contract](../api/terminal-native.md) and the
[component research](../research/tauri-managed-terminals.md).

Checks for this increment: 579 Node tests, two Rust tests, Clippy with warnings denied,
lint, typecheck, production build including Electron, macOS debug `.app`, and both
packaged acceptance scripts passed. The terminal acceptance copies built resources
outside the checkout and runs the real staged PTY with the clearly labeled C fixture;
Chromium exercises the Tauri xterm bundle and private Node transport. Native IPC,
focus and dialog consent are simulated in that acceptance. Real native inspection
opened the observer, menu, terminal document/xterm and exact-action start dialog.
It did **not** establish a successful native start/input/stop cycle: focus changed during
the attempt and input was revoked. An earlier UI-tool timeout is not positive evidence.

Remaining limits: full native focus/dialog/keyboard/hide/quit lifecycle acceptance,
real Codex/Claude/OpenCode login/tasks, native retirement/reselection, creation through
the dashboard, SQLite layout persistence, PTY teams/mentions and native MCP acceptance,
durable reconnect, Windows/Linux/Intel and signed installers. Native retirement is absent;
state/admission remain reserved rather than being deleted or automatically reused.
No ingestion logic changed; `validate:local`, `validate:live`, full browser suite and
real-provider acceptances were not run. Electron's implementation remains available.

## Structured agent communication — 2026-11-04

The existing **Managed agents** document now also runs in a dedicated Tauri window,
using the existing Node structured composition, queue, permissions and result trail.
This is independent from prepared PTY windows. On non-root macOS Apple Silicon,
select exactly two **fresh** Codex existing-login manifests prepared with the current
`terminal:setup` workflow and its explicit native-configuration acknowledgment:

```sh
export ORQST_TAURI_AGENTS='["/absolute/private/structured-a/terminal.json","/absolute/private/structured-b/terminal.json"]'
pnpm dev:tauri

# Explicit disposable integration; no installed provider or real credentials.
pnpm accept:tauri-agents --authorize-synthetic
```

Open **Managed agents** in the native menu, enter a supported model and start each
agent through its exact native review. Edit names, unique handles, descriptive roles
and the directed communication checkbox. Routes begin denied. A saved route requires
native review; a subsequent task requires separate authorization of its exact bytes.
Choose either source and use permitted `@handle` suggestions; result and correlation
state come from actual Core/CLI evidence. Stop each owned instance, wait for confirmed
exit, then use signed retirement. No task result is inferred from terminal output.

Profiles must not be owned by another app or contain an earlier journal. Tauri's
admission directory is separate from Electron; this does not permit concurrent use
of the same profile. Startup validates both before creating the native document;
a refusal leaves the observer available and prints a fixed diagnostic without paths.
Omit `ORQST_TAURI_AGENTS` for no structured host. The preview can also enable prepared
PTY windows independently, with different profiles; both menus are retained.

Closing this window hides it, cancels pending authorization and preserves its draft
and owned tasks. Reopen through the same menu. Reload permanently fences that
document. Quit asks for disconnect consent; cancelling either surface's quit review
clears both approvals when PTY and structured windows are configured. Host cleanup
does not prove arbitrary
descendant containment. Retirement does not delete state or silently select a new
pair; launching fresh profiles requires a new preview run. Durable reconnect and
native profile selection/creation remain separate work.

Checklist for this increment (synthetic evidence is not native/provider acceptance):

- [x] Reuse the structured document/client/Core/SQLite without importing Electron.
- [x] Dedicated native capability and exact custom-protocol document identity.
- [x] Signed reviews for start, roles/routes, exact tasks, stop and retirement.
- [x] Deny-by-default direction, explicit mentions, loop rejection and correlated return.
- [x] Cancel/blur/close/expiry/oversize checks and no signature in renderer replies.
- [x] Packaged synthetic hosts and shipped browser adapter integration.
- [ ] Human native WebKit focus/dialog/keyboard/hide/quit cycle.
- [ ] Installed Codex login, inference and source→worker→source acceptance.
- [ ] N-member structured teams, mixed-provider communication and unified PTY UI.
- [ ] Durable reconnect, profile creation/selection UI, other platforms and installers.

See [private native API](../api/tauri-agents.md) and
[pinned research, security differences and rollback](../research/tauri-agent-communication.md).

Checks executed for this structured-client increment: final `pnpm test` passed
600 tests; lint, typecheck, production build, three Rust tests, Clippy with warnings
denied, macOS Apple Silicon debug app bundle and all three packaged Tauri acceptances
passed. The six new boundary/review tests also passed separately. Initial load-related
suite failures and browser test-instrumentation corrections are recorded in the
component review. Native/provider acceptance remains unchecked above.

## Native terminal preparation — 2026-11-04

On non-root macOS Apple Silicon, launch Tauri without `ORQST_TAURI_TERMINALS` and
bring the dashboard to the foreground. The native **Prepare Tauri terminals** menu
offers reviewed Codex or Claude and 1–8 independent same-provider terminals. Select
the canonical native CLI executable and an empty disposable project folder through
the native pickers. The shipped Node 24 is selected automatically. Neither an
external setup command nor a hand-authored manifest is needed for this path.

Review every configuration page, confirm file creation, then separately acknowledge
shared native configuration/login/session effects after a future authorized start.
Creation writes private skeletons and UUID manifests under the separate Tauri preview
profile. It does not inspect credentials or launch a provider. The next complete
manifest review authorizes opening the selected runtime and its private journals;
opening does not start any CLI. Show a document from the existing native terminal
menu; its Start button retains the existing exact native signed authorization.

Cancelling the opening review preserves the completed files. Use **Review and open
prepared terminals** to review those same files again. It neither clones their IDs
nor provisions another set. A preparation can be cancelled and retried before its
write latch; after a possible write, new creation remains unavailable in this run.
Opening has a distinct single-attempt latch before Core admission. Uncertain
failures retain their files/reservations and are not retried automatically. No
retirement/reselection, state migration or process adoption is introduced.

Only exact reviewed Codex/Claude binaries are accepted; the menu's version labels
are reviewed contracts, not live authentication/version probes. Upgrading an installed
CLI can therefore refuse preparation until its exact contract is reviewed. Native
hooks, plugins and provider MCP configuration can cause effects after separately
authorized startup. This flow disables ORQST MCP, offers no mixed-provider composition
and does not select models. The dashboard remains an observer without Tauri execution
capabilities. The preparation menu is separate from the independently evolving
terminal workspace layout.

Verification: `pnpm lint`, `pnpm typecheck`, `pnpm test` (612 passed), `pnpm build`,
`pnpm build:tauri-resources`, `pnpm accept:tauri-core`,
`pnpm accept:tauri-terminals --authorize-synthetic`,
`cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml --locked` (four passed),
Clippy with warnings denied and `pnpm build:tauri --debug --bundles app` passed.
The focused preparation suite passed all 18 tests. The final native bundle was
built, not opened for a native/provider acceptance cycle. The resources include the
new self-contained Node helper and unchanged dependency notices. A shipped-helper
check outside the checkout passed cancellation, wrong-ID and provider-pin rejection.
The existing Vite chunk-size advisory remains. The central checklist retains the
initial synthetic-fixture mistakes and the expanded full-run Analytics connection
failure/Codex timeout during native compilation; the final complete retry passed
without changing assertions or timeouts.

The automated preparation checks use disposable synthetic binary substitutions and
simulated native picker/consent responses. The existing packaged terminal acceptance
uses real synthetic PTYs and the Tauri xterm bundle, with native IPC/focus/dialogs
simulated. Neither is an installed Codex/Claude task or native dialog acceptance.
Native macOS creation/start/stop, real providers, more than one preparation per run,
arbitrary mixed teams, models, durable reconnect, platform packaging and all other
Electron parity gaps remain pending. `validate:local`, `validate:live` and the full
browser suite were not run; no ingestion code changed. See the
[pinned source review and security note](../research/tauri-terminal-preparation.md).

## Native file exports — 2026-11-04

The existing artifact and Analytics controls now use native save/replacement dialogs
in Tauri Preview. Extract a retained artifact and use **Save original Markdown…**,
**Save draft Markdown…** or the corresponding **save and open** action. In Models,
review a current reading and use **Export CSV** or **Export Markdown**. Analytics
requires a new reading after every save attempt; use **Refresh** before exporting
again. The native Analytics scope review precedes the picker. Paths and bytes stay
in the native/Node path rather than returning to the dashboard.

Both shells reuse the same secure Node savers and serializers. No Electron runtime,
new filesystem plugin, new HTTP route or ingestion change is introduced. Existing
path-based navigation/session links and no-eval CSP are preserved. Failed export-host
startup leaves observation available; an uncertain timeout fences exports until the
preview is restarted. See [contract/security](../api/tauri-files.md) and the
[pinned Anywh review and integration checklist](../research/tauri-native-files.md).

```sh
pnpm build:tauri-resources
pnpm accept:tauri-files
```

The acceptance copies the shipped Node/Core/file-host/client outside the checkout
and uses actual dashboard artifact and Models buttons. Retained/draft Markdown,
overwrite cancellation, save-and-open handoff, CSV/Markdown Analytics, reading
consumption, real sidebar routes, rejected non-dashboard source URLs, private file
permissions, source immutability and graceful shutdown are exercised. Native IPC,
focus, pickers/reviews and the system editor handoff are simulated. This is not a
human native WebKit/dialog/editor acceptance.

The focused suite passed eight synthetic tests, including authenticated Bridge
re-extraction, exact bytes, overwrite/symlink races, reload/parent-loss revocation,
Analytics context revocation while busy and a VM regression against eval becoming
unavailable after native initialization. Six Rust tests and Clippy with warnings
denied passed. Production build, resource staging, packaged Core acceptance and
packaged file-export acceptance passed. A macOS Apple Silicon debug `.app`
(167.29 MiB) was built from the final route-aware bridge, without opening it for
native acceptance. The existing Vite large-chunk advisory remains.

Retained failures: initial focused fixtures expected the lexical temporary directory
instead of the writer's canonical path and then omitted the corresponding test
import; both were corrected without changing production guards. Initial browser
acceptance used a function serialized by tsx whose name helper was unavailable in
the page; only the simulated IPC initialization was corrected to literal script.
ENOSPC interrupted log creation, runtime copying and a later native staging attempt.
Only this delivery's generated Cargo target was cleaned. Runtime copies now prefer
standalone copy-on-write copies where supported and retain mandatory hash checks;
no other agent's files or caches were removed. Native builds were completed before
the owner's subsequent low-disk instruction; no additional heavy build is required
for reviewing this commit.

Native dialog focus/save/cancel/overwrite/reload/quit, real default-editor display,
Windows/Linux/Intel and signed/notarized installers remain pending. Electron must
remain available. `validate:local`, `validate:live`, the full browser suite and real
provider tasks were not run; ingestion/provider execution was not changed.

Final complete Node run: `pnpm exec tsx --test --test-concurrency=2 tests/*.test.ts`
passed all **631 tests**, with zero failures, cancellations or skips. The bounded
concurrency matches the integration runs and does not change assertions/timeouts.
`pnpm lint` and `pnpm typecheck` passed on the final source. The native bundle,
focused eight-test suite, six Rust tests, Clippy and the path-based packaged
file-export acceptance also passed on the final source.
