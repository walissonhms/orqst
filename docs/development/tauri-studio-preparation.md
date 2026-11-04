# Tauri Studio preparation — 2026-11-04

Studio's Tauri preparation source now calls the same native wizard as **Prepare
Tauri terminals**. Choose Codex or Claude Code and 1–8 terminals in one empty test
project. Native executable/project pickers, complete configuration review, shared
identity acknowledgment and separate opening review stay authoritative. Opening
initializes the existing terminal Core/journals; it does not start a provider.
Each Start/output/input operation still uses its existing native signed controls.

A cancelled opening keeps completed prepared files. **Continue prepared-file
review** uses the native-held files, without manual path selection or repeated
creation. An uncertain write blocks new creation; any opening attempt locks fresh
selection for that launch, including after signed retirement. Preserve files,
reservations and uncertain outcomes. No automatic retry or recovery is offered.

Tauri offers no mixed Codex/OpenCode preset, model picker, file import, login,
automatic task or MCP opt-in through this flow. Its newly prepared profiles keep
ORQST MCP disabled. Electron retains its independent `DesktopStudio` contract and
mixed preset; browser observation remains read-only.

## Composition and native boundary

`TauriStudioPreparation({native?: TauriStudio})` is an independent preparation
fragment, suitable for the full-window Studio drawer. It adds no workspace,
sidebar, terminal surface or CSS layout. The native facade is
`window.orqstTauriStudio` version 1. Without it, use a truthful Tauri-unavailable
message and the existing native menu, never the older-Electron/relaunch warning.

The injected client initializes on supported dashboard documents so reloading
Settings/Overview and then returning through SPA navigation can still reach Studio.
This exposes no capability on those other routes: native invocation still requires
actual main Webview/parent, exact owned origin at root/Studio, no credentials/query/
fragment, generation and focused AppKit first responder. Native pickers own paths;
JS supplies only provider/count or review of already prepared files.

Menu and Studio share all preparation/exclusion latches. Navigation/reload, main
close/destruction, another owned native window, NSApp deactivation and any Quit
attempt fence the generation. The existing AppKit observer permits only main's
active own-sheet exception during preparation. MCP/retirement/selected-host and
both Quit gates stay in the existing native/Core implementation. The component
keeps its in-flight result through own-sheet focus transitions, ignores obsolete
responses, and reads current capabilities after a snapshot-less mutation reply;
it never repeats the mutation.

See [API/security](../api/tauri-studio.md) and [pinned reuse review](../research/tauri-studio-preparation.md).

## Verification and remaining acceptance

Source, frontend and pure checks precede Cargo. All outputs are isolated from the
owner's open Preview app. The application, its `dist`, data, Core, processes and
uncertain fixtures are untouched. Worktree/branch remain available for integration;
no push, tag, app launch, provider, new runtime fixture, Start or headful acceptance
is performed by this increment.

Run the session-free checks from the worktree with the existing Node 24/pnpm 10:

```sh
pnpm lint
pnpm typecheck
pnpm exec tsx --test tests/tauri-studio.test.ts tests/feature-view.test.ts tests/terminal-layout.test.ts tests/tauri-terminal-layout.test.ts
pnpm build
pnpm exec tsx scripts/accept-studio-preparation.ts --authorize-synthetic-studio-ui
```

The renderer command uses actual React components, compiled dashboard CSS and
intercepted resources with in-memory, schema-validated synthetic facades. It opens
headless Chromium only; no Core, host, PTY, database, provider or network server.
It checks both locales, provider/count bounds, pending/denied/locked states,
own-sheet focus races, a new-generation snapshot without mutation retry, narrow
geometry and the unchanged Electron action-only contract.

Results for this delivery are recorded below. The broad
`pnpm test`, real-source `validate:local`, runtime/session acceptance scripts,
native WebKit/dialog input (including Settings reload → SPA Studio and actual ACL
resolution), provider behavior, final Quit, native bundle launch and
packaging acceptance are not run. Earlier six-PTY EN/PT evidence remains scoped to
its own baseline; the original six missing exit receipts remain uncertain and
preserved. This source increment does not update the app the owner is testing.

### Actual results

On isolated source based on `ad191d386f2293361a2bb44603f4b1691251b494`, Node
24.22.2 / pnpm 10.34.9:

| Check                                                                                       | Result                                                                            |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm lint`                                                                                 | Passed; complete ESLint and Prettier                                              |
| `pnpm typecheck`                                                                            | Passed                                                                            |
| Four listed session-free Node test files                                                    | 28 passed, zero failures/skips                                                    |
| Explicit renderer command                                                                   | Passed EN/PT; Tauri component and Electron contract, 1440/720/390px               |
| `pnpm build`                                                                                | Passed dashboard/Bridge/Desktop; existing >500kB dashboard chunk warning retained |
| `node scripts/build-tauri-resources.mjs`                                                    | Passed, 17 dependency notices, worktree-only resources and COW Node staging       |
| `cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml`                                | 30 passed, zero failures/skips; no native app/window                              |
| `cargo clippy --manifest-path apps/tauri/src-tauri/Cargo.toml --all-targets -- -D warnings` | Passed                                                                            |
| `cargo build --manifest-path apps/tauri/src-tauri/Cargo.toml --features custom-protocol`    | Passed; executable compiled, never launched or bundled                            |
| `git diff --check`                                                                          | Passed                                                                            |

Native checks exclusively used `/tmp/orqst-691-target`,
`CARGO_HOME=/tmp/orqst-tauri-toolchain-676/cargo`,
`RUSTUP_HOME=/tmp/orqst-tauri-toolchain-676/rustup`, its Cargo `bin` on PATH,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`, `CARGO_INCREMENTAL=0`,
`CARGO_BUILD_JOBS=1`. Compilation was cold and serial. Resource staging used the
existing exact Node distribution license. Disk was 7.3GiB initially, 6.1GiB before
Cargo and 5.1GiB after native compilation; no unrelated cache, bundle, runtime,
quarantine or proof was removed. Compiled target/resources/worktree are preserved
for coordinated integration and packaging.

Initial worktree TypeScript failed with missing package-local dependency links and
an implicit client parameter type. Local read-only dependency links and an explicit
parameter type corrected this without changing dependencies. The first renderer
bundle could not resolve Tailwind's CSS import through plain esbuild; the test now
consumes actual Vite-built dashboard CSS. A first lint run reported one test-script
formatting issue, corrected before the successful complete rerun. No check was
weakened and no native/provider pass is inferred from these corrections.

The VM bootstrap case verifies installation and fixed command dispatch, not actual
WebKit Settings reload → SPA Studio or native ACL resolution. The renderer case
mounts the preparation fragment independently of the separately coordinated
`StudioWorkspace` shell. Its integration into that drawer needs the caller's final
composition check; the isolated legacy `Studio.tsx` adaptation is an optional,
separate commit and should be omitted when integrating the new full-window shell.
There is no new persisted schema or data migration.

## Integrated full-window package — 2026-11-04

The caller integrated the native bridge and standalone component while omitting
its provisional legacy `Studio.tsx` composition. `StudioWorkspace` now mounts
`TauriStudioPreparation` on the first explicit drawer opening and keeps it mounted
when the drawer closes; the workspace is never remounted by preparation. There is
no Electron mixed preset or old-Desktop warning in this Tauri drawer.

On the integrated source, TypeScript, repository lint, 26 session-free Studio/broker
Node tests, the explicit renderer EN/PT command and three focused Playwright tests
passed. The latter includes the actual App/drawer composition, provider/count
choices, 390px drawer geometry and Overview navigation. Dashboard build and native
resource staging passed with 17 notices. No broad Node suite rerun is claimed.

The frozen worker binary was checked against all 13 recorded Rust/configuration
file hashes and its SHA-256 before bundling. The existing native compile was reused;
no second Cargo target was created. All 109 staged resource files were checked
against the resulting app and its local ad hoc signature passed deep strict
verification. Both the executable and previous Preview's recorded resources were
preserved. The local artifact is:

```text
dist/native-preview-studio/ORQST Preview.app
```

After the previous Preview was no longer running, this new package was opened.
Actual WebKit observation confirmed one full-window Studio shell, **+ Terminal**
opening its preparation drawer, a successful native snapshot showing **Ready to
prepare**, enabled prepare/provider/count controls, and closing the drawer back
to the full workspace. No create/review mutation, picker selection, profile write,
provider Start, login or task was performed in this check. The app remains open
for owner testing. Native Settings reload → SPA Studio, the actual provisioning/
opening flow, terminal input, provider behavior and final Quit remain unaccepted.
