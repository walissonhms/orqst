# Native Terminal integration acceptance

This is an explicit developer-only application. It implements a functional native
transport for **one fixed disposable synthetic Node fixture**, not managed Codex
or a shipped Desktop terminal. Normal `pnpm desktop`, Bridge, dashboard, build and
automatic tests do not enable or launch this application. No provider, login,
credential, user project, external session or existing service is inspected or used.
The synthetic output is labeled and never enters the observer/database.

## Reproduce

Use the repository's Node `>=24 <25`, pnpm 10.x and installed Electron 45.2.1 binary
in a graphical macOS/arm64 session:

```bash
pnpm accept:terminal-native --authorize-synthetic-pty
```

The exact flag is mandatory; no command, executable, project or provider argument
is accepted. The launcher builds transient bundles in an owner-only temporary
directory, stages the existing MIT `node-pty@1.1.0` package and sets the execute bit
only on its private helper copy. It never modifies shared dependency files. The
private Node 24 executable is captured from the launching runtime; no shell/PATH
lookup is used for the fixture. Electron uses a disposable user-data directory and
an independent memory-only session. It inherits only explicit temporary HOME/TMPDIR
and locale values. No application restart, service command or API listener is needed.

The fixture has an independent eight-second watchdog and cannot interpret input as
code or launch descendants. The Node host has a twelve-second deadline; Electron
has a thirty-second deadline. The test closes its own app and deletes its temporary
files, without searching for or signaling a PID from user sessions. Closing the
native document only revokes control; it never signals the fixture. These limits
are fixture instrumentation, not a production sandbox or provider lifetime policy.

## Implemented path

1. A dedicated `orqst-terminal://local/index.html` document runs with sandbox,
   context isolation and no Node integration in a separate session. Exact local
   HTML/script/style requests are the entire allowlist; Bridge, network, frames,
   downloads, permissions, webviews and new windows are denied. CSP disallows
   connections, frames, objects, forms and inline scripts. The observer route
   policy and shared dashboard route schema are not extended.
2. The separate preload exposes only a frozen versioned `orqstTerminal.request`.
   It checks strict request/reply schemas, transient activation for consent effects,
   one request in flight, bounded output and fixed statuses. It has no generic IPC,
   subscription, signing, file, credential, clipboard or offline-queue method.
3. `bindTerminalRuntime` validates the native window/session/main-frame identity,
   exact URL and trusted document generation on every dispatch and after await.
   It enrolls no renderer. Trusted lab composition creates a fresh memory-only
   Ed25519 enrollment and broker. Private proofs/keys/leases stay in native code;
   only bounded output bytes, instance identity and lifecycle evidence cross IPC.
4. The broker displays the existing native Cancel-default confirmation with the
   exact fixed manifest, action, paste or signal. Input is independently leased;
   blur invalidates pending consent and input. Main navigation, reload, renderer
   loss and document destruction permanently close this client. Reload never
   enrolls another client or recovers an old instance automatically.
5. The supervisor connects to an anonymous private Node child IPC channel. Only
   the Node host loads the PTY addon, avoiding Electron ABI assumptions. It launches
   the one fixed fixture with an explicit credential-free environment. Neither
   public socket nor generic command/argv/cwd/env payload exists. PTY output is
   bounded and backpressured; the UI displays bounded inert text with control
   characters escaped, without an emulator or automatic terminal responses.
6. `lost()` reports private transport failure as `ownership_lost`. Exit is accepted
   only from the host's PTY exit record. Late exit cannot erase uncertainty; no
   retry, adoption, stored-PID signaling or automatic resume exists.

## Evidence and remaining gates

The macOS/arm64 run on 2026-11-03 used Electron 45.2.1 (bundled Node 24.22.1),
Node-host 24.22.2 and node-pty 1.1.0. Real Electron/preload/IPC/Node-host/PTY checks
passed for isolation/network denial, native cancellation, start, attach/read,
leased exact paste, blur revocation, stop with confirmed exit and permanent
reload revocation. Automatic tests cover strict shapes, sender/generation
substitution, concurrent dialogs, navigation during pending consent and transport
uncertainty with synthetic doubles.

Native message-box answers are intercepted during this explicit automated run.
The run is **not** evidence of a real human gesture, modal focus behavior, visual
layout, accessibility, signed packaging or a provider sandbox. No real provider
or credential was executed or opened. Ingestion is unchanged; `validate:local`
is not needed for this transport-only increment.

Codex remains the first managed provider candidate. Enabling it remains blocked by:

- No production backend that binds an admitted executable and cwd without the
  `realpath/hash` then path-based-spawn replacement race. The lab deliberately
  trusts a disposable cooperative location and does not claim to close that gap.
- No separately provisioned managed authentication/configuration/history. External
  Codex homes, credentials and session files cannot be reused by discovery.
- No selected/accepted native-vs-container containment, descendant cleanup and
  enforceable provider lifetime/extension policy. A PTY is not an OS sandbox.
- No durable attempt journal/reconciliation or independent long-lived Core host.
  The experimental supervisor still lives in the disposable Electron app; it
  cannot supply production crash recovery or work surviving native-client exit.
- No exact-binary provider acceptance for start, sandbox, input, interruption,
  stop and any later approval/resume operation. Each needs specific owner
  authorization; this command never launches an installed provider to infer support.

Claude Code and OpenCode remain unvalidated observation contracts. No managed
capability, provider approval, external-session control or public execution route
is added. The next production increment must resolve those concrete gates rather
than enabling this synthetic application in the normal Desktop menu.

## Security review note

No existing API/WS/cookie/static-file/observer-route rule changes. A new isolated
developer application alone registers `orqst:terminal-native`; production entry
points and observer preload remain unchanged. IPC checks both request/reply shapes,
document identity, native focus and revocation. Same-user/native-code compromise
remains outside this boundary; a compromised renderer with an active lease can
abuse input until revocation. The lab is not authentication for a future cross-process
Core control endpoint and does not justify exposing one through observation cookies.
