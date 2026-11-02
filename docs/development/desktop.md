# Local macOS Desktop client

## Scope and trust

The first Desktop slice is an Electron window loading the existing React dashboard
from `http://127.0.0.1:4317/`. The Bridge remains the independent Node 24 composition
root and sole SQLite writer. Desktop imports no Core, adapter, database or service
helper and never starts/stops a Bridge or agent. Browser clients continue working.
Closing a macOS window leaves the Desktop application available in the Dock; activating
it reopens the window. Quitting Desktop also preserves the independently running Bridge
and observer. If the Bridge exits, Desktop cannot keep observation running.

The renderer has sandbox and context isolation enabled, no Node integration, no
preload, no IPC and no webview. Its browser session is in memory with cache disabled.
Requests are restricted to the configured IPv4 loopback origin and its `/ws` socket;
root/hash dashboard navigation is permitted. New windows, subframes, external navigation,
downloads and permission requests are denied. Native notifications, media capture,
external links and file export are not available in this slice. No shell opening or
arbitrary URL configuration is exposed. Dashboard content stays untrusted plain text.

The existing bootstrap cookie, Host/Origin/fetch-metadata checks and CSP are unchanged;
Electron does not inject headers, bypass authentication or proxy the API. This is the
same trusted-OS-user loopback model, not remote authentication or proof of the identity
of a local listener. The main process does not parse captured responses. Initial load
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
  library/version range; it renders only fixed localized fallback text. No packager,
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
tray, native notifications, bundled Bridge/toolchain or OS service installation.
Packager and distribution identity/entitlements need a separate concrete decision and
acceptance before release. No paid Apple account or new system permission is needed here.
