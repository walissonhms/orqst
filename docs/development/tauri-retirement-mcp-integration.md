# Tauri retirement and interactive MCP integration — 2026-11-04

The retirement delivery `a04de7ee13bec8b6d3ae51e53dd1cc3f42d617e1` is adapted
onto `main` baseline `7a0a91e`, which includes interactive MCP consent `901e0b2`.
Work used the isolated `integrate/tauri-retirement-mcp-691` branch/worktree.
The original retirement worktree 689 is preserved. No existing quarantine,
provider, credentials, observed session or private runtime was inspected or changed.

## Resolution and behavior

The no-commit application had content conflicts in `README.md`,
`tauri-terminal-host.ts`, `tauri-terminal-service.ts`, `terminal.rs` and
`docs/architecture/security-model.md`. Both implementations were retained.
The host always supplies the existing retirement Core port, and supplies the MCP
port only for explicitly opted-in profiles. Both native menu entries and translated
labels remain; public request schemas and Tauri permissions are unchanged.

The service and native menu exclude MCP authorization and retirement from each
other before asynchronous preparation. Public terminal requests cannot race either
review. Revocation of either pane invalidates a pending selection-wide review,
including delayed retirement evidence. Native WKWebView first-responder focus
selects the reviewing pane for both actions; it does not reverse MCP's fixed roles.
Retirement success requires actual owned exits, signed Core evidence and confirmed
Core close. Possibly consumed proofs fence MCP as well as terminal work, with no
retry. Pre-proof cancellation/refusal permits a fresh explicit review.

The selection latch still covers environment startup and stays locked for the
native application lifetime. Reselection requires quitting and fresh profiles after
restart. No automatic adoption, restart, quarantine reconciliation, PID sweep or
in-window reselection is introduced. OpenCode descendant-exit uncertainty retains
its existing Core refusal.

## Revalidated reuse decision

The separate local Anywh checkout was re-inspected at
`546f189c04415c3c5af5f40e3931a0a90b9aba31`, including `docs/architecture.md`,
`docs/agent-host.md` and `relay/src/runtimes/README.md` before implementation.

| Candidate and permanent source                                                                                                                     | Exact symbols, dependencies and decision                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anywh [terminalSession.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/host/terminalSession.ts)      | `spawnTerminal`, `killTerminal`, `killAllTerminalsForSession`; node-pty, child_process, tmux. **Keep ORQST**: attach/create and tmux kill are not evidence-only retirement.                                                                                   |
| Anywh [agentHost.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/agentHost.ts)             | `stop`, `remove`, `forget`, `close`; registry/logs/process trees/runtime/socket. **Keep ORQST**: this host can terminate processes and destroy logs; ORQST requires preserved journals and source-backed exits before capacity release.                       |
| Anywh [permissionBridge.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/bridges/permissionBridge.ts) | `McpPermissionBridge.registerTurn`, `handleRequest`, `PermissionCheckHost`; Node HTTP/crypto. **Do not use**: provider-tool permission decisions over token-addressed HTTP differ from one-use instance/epoch-bound communication grants.                     |
| ORQST [existing Core](https://github.com/walissonhms/orqst/tree/7a0a91e121902981c8acb3e6e9a9576526166010/packages/core/src/terminal)               | `ManagedTerminalPair.prepareRetire/retire`, `InteractiveMcpSession`, `TerminalAuthority`, existing RPC and private Unix socket transports. **Reuse directly** with the narrow native/service composition above; no parallel process or communication manager. |

The pinned Anywh [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
is Apache-2.0; its tracked tree has no NOTICE/COPYING and the selected source files
have no extra license headers. No new upstream code, asset or dependency was copied;
existing NOTICE/attribution and the historical Tucano audit remain unchanged.
The prior [MCP review](../research/tauri-interactive-mcp.md) and
[retirement review](../research/tauri-terminal-retirement.md) retain their original
scope and evidence. No routing or visual redesign changes require new Tucano or
Overclock reuse.

## Checks and limits

Toolchain verified from repository manifests/lockfiles and actual executables:
Node 24.22.2, pnpm 10.34.9, TypeScript 6.0.3, React 19, Tauri 2.12.5 and
Rust 1.99.1 on macOS ARM64. Dependencies were installed offline with the frozen
lockfile; no dependency or provider pin changed.

The combined Node fixture uses the production service/Core, disposable SQLite
journals and real Unix sockets with synthetic owned handles. It exercises the
MCP round trip then retirement, refusal while handles run, both asynchronous
exclusion directions, cross-pane revocation/closure, stale preparation and uncertain
retire/close fencing. Existing opt-in, UUID roles, replay and timeout checks run
with the retirement port present. The packaged MCP acceptance additionally uses
two actual synthetic PTYs and Node stdio relays, then checks archive release and
journal retention after actual owned exits. Native focus/dialog decisions are doubles.

| Check                                                                                                          | Current result                                                                                |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Focused service/MCP/retirement Node tests                                                                      | 36 passed                                                                                     |
| `pnpm lint`, `pnpm typecheck`                                                                                  | Passed (an initial new-fixture implicit array type was fixed before the passing run)          |
| `pnpm test`                                                                                                    | 670 passed, no failure/cancellation/skip                                                      |
| `pnpm build`                                                                                                   | Passed, existing Vite chunk-size advisory                                                     |
| `pnpm build:tauri-resources`                                                                                   | Passed, 18 dependency notices staged                                                          |
| `pnpm accept:tauri-terminal-mcp --authorize-synthetic`                                                         | Passed, combined real synthetic PTY/stdio exchange and retirement                             |
| `cargo test --locked --offline --manifest-path apps/tauri/src-tauri/Cargo.toml`                                | Passed, native compilation and 12 Rust tests                                                  |
| `cargo clippy --locked --offline --manifest-path apps/tauri/src-tauri/Cargo.toml --all-targets -- -D warnings` | Passed                                                                                        |
| `pnpm accept:tauri-terminals --authorize-synthetic` and `--panes=8`                                            | Passed, independent 2- and 8-pane synthetic PTYs, retained xterm layout and signed retirement |

Native menu/dialog/first-responder interaction and human reselection acceptance,
real provider lifecycle/inference, signed distribution and non-ARM64-macOS platform
acceptance remain pending. No real provider was launched. `validate:local`,
`validate:live` and the full browser suite are not run: ingestion is unchanged.
Generated outputs and local check logs are not committed. Existing running binaries
are not upgraded or restarted by this integration.
