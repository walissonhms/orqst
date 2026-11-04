# Tauri native terminal preparation — 2026-11-04

## Baseline and chosen gap

The implementation starts from ORQST `ee08ecb`; the independent central tracker
commit `c3f8c28` was subsequently fast-forwarded into the feature worktree. Existing
README/ROADMAP/tracker edits and other worktrees were preserved. Node 24.22.2,
pnpm 10.34.9, TypeScript 6.0.3, Tauri 2.12.5, dialog 2.8.4, shell 2.6.0,
node-pty 1.1.0 and xterm 6.0.0 were verified from installed metadata/lockfiles.
No dependency or lockfile change is introduced.

The largest independently deliverable creation gap was the requirement to prepare
manifests externally before Tauri could open a terminal. The Electron preparation
and full selection review already existed. Porting those exact modules avoids a
second provisioning/session manager and leaves concurrent workspace-layout work
independent. A native menu is used because the loopback observer dashboard deliberately
has no native execution capability.

## Anywh inspection and reuse decisions

Anywh was cloned outside the application and checked out at
[`546f189c04415c3c5af5f40e3931a0a90b9aba31`](https://github.com/anywh-sh/anywh/tree/546f189c04415c3c5af5f40e3931a0a90b9aba31).
The required `docs/architecture.md`, `docs/agent-host.md` and
`relay/src/runtimes/README.md` were read before implementation, then the actual
candidate functions below were inspected. No upstream installer or runtime was run.

| Candidate and permanent source                                                                                                                                                                  | Dependencies and contract                                                                                                                                    | Decision                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`useSessionActions.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/hooks/useSessionActions.ts), `handleNewConversation`, `handleNewTabInGroup` | React, local profile/tab hooks and remote Relay clients. A UUID-backed blank tab is created before a first prompt starts the session.                        | **Keep existing ORQST.** Reuse `prepareTerminalCreation` and `TerminalSelection`, which already disclose complete configurations and bind binaries, directory identities and signed-start ownership. A blank remote chat tab is not equivalent to native CLI preparation. |
| [`useTerminalTabs.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/hooks/tabs/useTerminalTabs.ts), `addTerminal`, `closeTerminal`                | React hooks, UUIDs and localStorage; terminal tabs belong to chat sessions, with optional initial cwd. Tab removal and actual tmux termination are separate. | **Keep existing ORQST.** Preserve the existing UUID manifests and retained terminal document. No layout or localStorage implementation is copied by this creation change.                                                                                                 |
| [`terminalSession.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/host/terminalSession.ts), `spawnTerminal`, `killTerminal`                      | `node-pty`, `node:child_process`, external tmux. `new-session -A` creates or reattaches to a named session; closing calls `kill-session`.                    | **Do not use.** Adding tmux attachment changes ownership, recovery and platform dependencies. ORQST's existing native broker/PTY/journal already implement the required owned start and must not adopt an unknown process.                                                |
| [`tailnet_sidecar.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs), `tailnet_sidecar_start`, `TailnetSidecars`     | Tauri shell plugin, retained child and continuous stream drain.                                                                                              | **Keep the existing attributed adaptation.** Extend the current Rust-only fixed-Node integration with a short-lived passive helper. No remote service, tailnet config or renderer spawn API is added.                                                                     |

The exact root [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
is Apache-2.0. `git ls-files '*NOTICE*'` returned no file; the inspected selected
TypeScript sources have no separate licensing header. No new upstream source or
assets are incorporated, so previous Anywh attribution in NOTICE is retained unchanged.
The candidate dependencies are recorded to explain why their implementations were
not imported; no unreviewed dependency enters ORQST.

Tucano communication and Overclock pane-layout implementations are outside this
passive creation delivery. Their historical audits are preserved, with no new
capability, license grant or visual acceptance inferred from them.

## Concrete implementation and security review

`tauri-terminal-preparation.ts` calls the unchanged Electron `terminal-creation.ts`
and `terminal-selection.ts`. It supports bounded 1–8 same-provider Codex/Claude
preparation and full paged review. The packaged Node executable supplies its own
path/hash; no installed Node path or terminal manifest needs manual configuration.
The reviewed provider pins, trusted empty project, directory identity checks,
private permissions and inert partial-state policy remain authoritative.

Rust `terminal_creation.rs` exposes only native menu events. An initial focused
dashboard starts native pickers and parented dialogs. While a modal owns focus, the
transaction remains bound to the original visible document URL/page-load generation and a five-minute
deadline; creation review has a separate 60-second budget. This provisioning rule
does not alter the existing stricter CLI-start/input focus checks.

The private bounded correlated pipe has no HTTP or WebSocket endpoint. EOF, invalid
IDs, oversized input, timeout and cancellation cannot authorize provisioning. A
native commit latch precedes any possible file write. Separate opening reviews
revalidate complete manifests; the native open latch precedes Core admission and
remains set on uncertain failure. A cancelled opening retains the same files for
fresh review. New preparation is unavailable after a possible write; no state,
reservation or journal is deleted to permit retry. Shutdown kills only the passive
helper, which never owns provider processes. Failed Core/window initialization uses
the existing terminal cleanup without clearing reservations.

Creation starts no CLI, authentication probe, login or task. Opening initializes
the existing owned Core and journals; each provider start still needs a separate
native signed authorization. MCP is disabled in newly prepared profiles. The helper
receives only HOME, PATH, TMPDIR, LANG, CODEX_HOME and CLAUDE_CONFIG_DIR; provider
credentials, NODE_OPTIONS and NODE_PATH are not forwarded. Captured session access,
observer cookies/API/WebSocket, CSP, capabilities and Node source readers are unchanged.

## Verification and limits

The delivery's commands/results and platform limits are recorded in the
[Tauri development guide](../development/tauri.md#native-terminal-preparation--2026-11-04)
and the [central checklist](../architecture/master-spec-tracker.md). Tests include
1/4/8-member Codex and Claude preparation, complete UUID-backed configuration,
all pre-write cancellation stages, expiry, project and manifest drift, cancelled
opening/review, strict production pins and a real Node helper over private pipes.
Synthetic pin substitution is confined to temporary test bundles; production pins
are explicitly tested to reject the Node executable as a provider.

The first focused run reported three Claude assertion failures: its post-check
incorrectly used the production inspector against synthetic binary pins. The test
inspection bundle was corrected; no application guard was relaxed. Native dialog
interaction, installed provider tasks and platform distribution remain separate
acceptance obligations. This is not complete Electron/Tauri parity.

The first complete Node run passed 609 tests. After adding three pipe-negative
cases, a complete 612-test run made concurrently with native compilation reported
610 passed, one Analytics `ECONNRESET` failure and one Codex initialize timeout
(55 seconds). These failures are retained in the central log. Concurrent load is
a possible factor, not an established root cause; no test timeout, assertion or
application behavior was changed in response.

The final complete retry after native compilation finished passed all 612 tests,
without failures, cancellations or skips. Lint, typecheck, build, resource staging,
both packaged Tauri acceptances, four Rust tests and Clippy with warnings denied
passed. The final macOS ARM64 debug bundle was built successfully. The private
preparation helper was also copied with the shipped Node outside the checkout and
passed cancellation, wrong-ID and production-pin rejection with no state writes.
The four subprocess preparation checks run only on the same non-root macOS ARM64
platform supported by the existing terminal host; no other platform is certified.
