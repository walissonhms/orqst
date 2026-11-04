# Tauri Desktop preview

The owner-approved desktop target is Tauri 2 with the existing React dashboard,
Node 24 Core and SQLite. `apps/tauri` is the first runnable migration increment.
Electron remains available through the existing commands until feature parity is
validated. The observer is unchanged; prepared managed terminals can opt into
a retained native workspace. Prepared structured agents have a separate opt-in Tauri
bridge. Native exports and notifications remain in Electron.

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
and unrelated credentials are not inherited. The observer receives no Tauri command
capability. Navigation remains on the owned origin, new windows are
denied, and the existing Bridge CSP, cookie, Host/Origin checks and API/WebSocket
validation remain authoritative.

The preview owns a separate `core/orqst.db` under the OS application-data directory
for `dev.orqst.desktop.preview`. It intentionally does not reuse `ORQST_DATA_DIR`
from a running service or open the Electron managed-terminal journal. On macOS the
normal path is `~/Library/Application Support/dev.orqst.desktop.preview/core`.
Core still enforces private directory/database permissions. Codex source files
remain read-only; `ORQST_CODEX_SESSIONS` can select a disposable acceptance source.
No existing database or preference profile is migrated automatically.

Closing the application requests shutdown on the private stdin pipe, waits up to
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
native exports, menus/tray parity, OS notifications,
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
select profiles currently owned by Electron. MCP-enabled profiles are refused because
their separate native delegation consent is not ported. Selection failure leaves the
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
only to the dedicated custom-protocol windows. The dashboard stays a remote observer
with zero native execution capability. No execution HTTP route or WebSocket message
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
the dashboard, SQLite layout persistence, PTY teams/mentions and MCP consent,
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
