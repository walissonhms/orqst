# Synthetic PTY acceptance

ORQST has a repeatable developer check for native PTY mechanics. **It does not add
an interactive terminal to the application.** The observer, external agent
sessions, Desktop IPC and API remain unchanged. See the
[managed terminal design](../architecture/managed-terminal-design.md) for the
proposed authorization, ownership, isolation and persistence boundary. The next
[owned terminal library](terminal-owned-lab.md) is now included in this explicit
lab; it remains outside the application import graph.

## Run deliberately

With the repository's Node 24 and pnpm 10 toolchain, on macOS/arm64 as a non-root user:

```bash
pnpm install --frozen-lockfile
pnpm accept:terminal-pty --authorize-synthetic-pty
```

The exact flag authorizes only this fixed synthetic experiment. No executable,
project, provider, environment, user text or session parameter is accepted. Without
the flag, the script refuses before staging files or creating a PTY. It is excluded
from `test`, `build`, application startup and CI. Automatic unit tests exercise only
in-memory backends, signed authorization/lifecycle and output-budget helpers.

The script stages the locked `node-pty@1.1.0` JS, MIT license and macOS/arm64 native
files into a new private temporary directory. The published helper is not executable
in the inspected package, so the script sets `0700` on **only its temporary copy**.
It neither changes `node_modules` nor enables package install scripts. The existing
esbuild-only dependency-build allowlist is preserved. No native source compilation,
privileged install, service restart or provider command is involved.

## What it checks

Three sequential starts, with at most one active child, run the current absolute Node
binary and a fixed synthetic fixture through a real PTY. Each gets a fresh private
cwd, HOME, CODEX_HOME and TMPDIR, a small explicit locale/terminal environment and
no inherited loader options or credentials. The fixture validates its TTY, directory
and environment (allowing macOS's added CoreFoundation encoding key), accepts only
fixed test words and never evaluates input or creates descendants.

The check exercises input, initial size and resize, raw Ctrl+C bytes, pause/resume
during a finite output burst, a bounded tail, normal exit and SIGTERM through the
owned handle. Ctrl+C is deliberately only a byte in raw mode; the signal case is
separate. It does not use PID lookup or signal arbitrary processes.

The third start goes through the experimental supervisor. A test-only ephemeral
Ed25519 key signs exact prepared operations. It checks unsigned/replayed start
denial, backend readiness evidence, input lease/sequence, resize, Ctrl+C, pending
grant revocation on blur, detach without stop, fresh attachment/lease, exact paste
binding, separately scoped stop and exit evidence. The executable and fixture
hashes are rechecked; this does not close path replacement races. Signing in this
explicit test is not native user-gesture acceptance. No private key is persisted.

Each probe has a five-second deadline, a 256 KiB cumulative received-output budget
and a 4096-code-unit retained tail. Failure attempts SIGKILL only through its created
handle and waits up to two seconds for exit. Each fixture also has its own eight-second
watchdog. Native calls/event-loop failure are not contained by those JavaScript
deadlines; this is a bounded cooperative fixture, not an OS resource sandbox. There
is no claim of hard CPU/memory/descendant limits. Output is never interpreted as
terminal commands and success prints metadata/check names only. Temporary files are
removed on normal completion and handled failure; no transcript or provider history
is retained. External termination of the parent, including SIGINT/SIGTERM, can bypass
its `finally` cleanup and leave the private temporary directory behind. There is no
parent signal handler; the child watchdog still bounds a cooperative child's lifetime.
Failure diagnostics can show
escaped synthetic output, not raw terminal escape sequences.

## Evidence and limits

The opt-in probe passed on macOS/arm64 with Node `24.22.2` and `node-pty` `1.1.0`.
The increment also passed `pnpm lint`, `pnpm typecheck`, `pnpm test` (238 tests,
including four new synthetic unit cases) and `pnpm build`. The build retains the
existing dashboard chunk-size warning; no bundling/runtime dependency changed.
This earlier evidence establishes checkout-only Node-host mechanics, not Electron ABI compatibility,
signed packaging, emulator behavior, arbitrary load, descendant cleanup, crash/reboot
recovery, native authorization or real-provider acceptance. The terminal runtime is
intended to live alongside Core under Node; Electron native loading is not needed
for this experiment and was not tested. Windows/Linux remain unvalidated.

No real provider, API key, native user session, installed Bridge, observer database
or external process is used. `validate:local`, browser tests and native Desktop smoke
are unnecessary for this script-only increment and were not run. Phase 2/4 terminal
acceptance remains incomplete; there are no new controls to enable in the UI.

### Owned supervisor increment

The subsequent library increment passed `pnpm lint`, `pnpm typecheck`, `pnpm test`
(250 tests, including 12 new in-memory terminal cases), `pnpm build` and the expanded
opt-in native probe on the same macOS/arm64 Node `24.22.2` / `node-pty` `1.1.0`
toolchain. The build still reports the existing dashboard chunk-size warning.
The native probe now includes the third supervisor-driven fixture described above.

No real provider, session data, installed service or database was accessed.
`validate:local`, browser tests and native Desktop smoke were not run because the
observer, API, IPC and renderer did not change. Native gesture/enrollment,
provider/PTY integration and durable audit/recovery acceptance remain incomplete.

### Reviewed integration

Candidate `fdff231` received independent read-only critical QA approval for this
experimental, uncomposed scope. Finalization with the navigation baseline passed
lint, typecheck, all 252 Node tests, full build and the explicit synthetic PTY command
above using Node24.22.2 / pnpm10.34.9 on macOS/arm64. No tests were skipped or weakened;
the existing dashboard bundle-size warning remains. QA did not independently rerun
commands. The late-exit/capacity and per-supervisor attempt-cap clarifications are
recorded in the [library guide](terminal-owned-lab.md).

Earlier browser evidence is reused without claiming a new full-browser pass; the
known shared-fixture failures remain documented in [testing](testing.md). Ingestion,
transport and UI are unchanged, so local-source, browser, native Desktop and real
provider acceptance were not repeated. No push or service restart was performed;
installed processes/storage and external sessions were preserved. Native enrollment,
consent, provider terminals, durable recovery and runtime composition remain unavailable.
