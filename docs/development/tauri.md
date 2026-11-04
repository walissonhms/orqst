# Tauri Desktop preview

The owner-approved desktop target is Tauri 2 with the existing React dashboard,
Node 24 Core and SQLite. `apps/tauri` is the first runnable migration increment.
Electron remains available through the existing commands until feature parity is
validated. This preview is an observer client; it does not yet expose Electron's
managed-terminal, native-export or native-notification integrations.

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
and unrelated credentials are not inherited. No Tauri command handlers or renderer
capabilities are granted. Navigation remains on the owned origin, new windows are
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
preview has no managed tasks to keep alive after closing its shell.

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

The migration is **not complete**. Managed PTY/structured terminals still use
Electron's native IPC; native dialogs, trusted input/signing, exports, menus/tray,
OS notifications, durable reconnect and profile migration require incremental
parity work. Teams, permissions, editable handles and actual CLI mention/return
acceptance remain separate requirements of the master specification. This change
does not run Codex, Claude or OpenCode, and does not certify any real-provider task.

Windows/Linux builds, macOS Intel, signed/notarized installers and the complete
native transitive redistribution-notice audit have not been accepted. The local
debug bundle is not a release candidate. See the [source review](../research/tauri-core-reuse.md).
