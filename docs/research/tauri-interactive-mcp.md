# Tauri interactive MCP consent — 2026-11-04

Baseline: clean `main` at `9346271`, isolated worktree/branch
`feat/tauri-interactive-mcp-688`. Existing worktrees, observed sources, native
credentials and the quarantined reservation were not opened or changed. Inspection
confirmed Node 24.22.2, pnpm 10.34.9, strict TypeScript 6.0.3, React 19,
Tauri 2.12.5, Electron 45.2.1, SQLite, node-pty 1.1.0 and xterm 6.0.0.
No dependencies, provider pins or capability grants changed.

Before final delivery the branch was rebased without conflicts onto main
[`be1c0543eddc7993377fbdedb8d8ad5b9ca8ed6e`](https://github.com/walissonhms/orqst/tree/be1c0543eddc7993377fbdedb8d8ad5b9ca8ed6e),
preserving the concurrent isolated native-acceptance runner and its synthetic
preflight regression. The application implementation under test was unchanged;
the combined checks were repeated.

## Pinned sources and decisions

The separate existing research checkouts were inspected again at their exact SHAs;
no upstream executable, install script or dependency installation was run. Anywh's
`docs/architecture.md`, `docs/agent-host.md`, `relay/src/runtimes/README.md` and the
source implementations below were consulted. GitHub browser fetches for the two
bridge files returned cache misses; local pinned Git objects supplied the evidence.

| Candidate                      | Permanent source / exact symbols                                                                                                                                                                                                                                                            | Dependencies, contract and decision                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native child lifecycle         | Anywh [`tailnet_sidecar.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs), `TailnetSidecars`, `Running`, `tailnet_sidecar_start`                                                                                | Tauri shell, Tokio, serde. **Reuse existing ORQST adaptation**, including fixed owned Node entry, retained child, bounded private pipe and shutdown. No remote tailnet, arbitrary spawn or second host.                                                                                           |
| Provider approvals             | Anywh [`permissionBridge.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/bridges/permissionBridge.ts), `McpPermissionBridge.registerTurn`, `handleRequest`, `PermissionCheckHost`                                                            | Node HTTP/crypto; token-addressed HTTP and Claude `approve` tool/turn permission decisions. **Do not use**: these grant provider-tool decisions rather than ORQST's one-use, instance/epoch-bound communication authority. No provider approval interception or HTTP fallback is introduced.      |
| Session-scoped tool gateway    | Tucano [`gateway.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/gateway.ts), `Gateway.open`, `handle`, `Session`                                                                                                                             | Node HTTP/net/crypto, MCP SDK and application language module. **Keep ORQST Core**: its private Unix sockets already bind fixed source/worker tools, exact correlations, deadlines and owned instances. Importing a token-URL HTTP gateway adds another transport and a different trust boundary. |
| Routing and automatic chaining | Tucano [`router.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts), `route`, `parseRoute`; [`runs.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/runs.ts), `Runner.chain`, `MAX_DEPTH` | Application engines, DB, types and language helpers. **Do not use**: selecting speakers/model-reply chaining cannot authorize a task or prove CLI delivery. Existing Core's fixed explicit source/worker exchange is the current implemented boundary.                                            |
| Concrete local implementation  | ORQST baseline [`9346271`](https://github.com/walissonhms/orqst/tree/9346271abdf2be45670901b6d9abb8a479fe08ec), `TerminalNativeBroker`, `InteractiveMcpSession`, `McpTaskBroker`, `connectManagedTerminalCore`, `terminal/host.ts`, `mcp-relay.ts`                                          | Node crypto, SQLite, existing PTY/RPC/Zod. **Reuse directly**: port Electron's `authorizeMcp` native review to Tauri's private host, retaining exact Core challenge bytes, grants, one-use scope and Unix/stdio configuration. No replacement session manager, provider driver or task transport. |

The pinned [Anywh LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
and [Tucano LICENSE](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE)
are Apache-2.0. Their tracked trees contain no NOTICE/COPYING files and the selected
source files have no additional license header. No new upstream source, asset or
dependency was copied; existing attribution in NOTICE remains intact. The original
Tucano audit is preserved.

## Native implementation and security review

`terminal.rs` adds a menu action only for an MCP-opted-in pair. The current native
WKWebView first responder selects the reviewing document; the public terminal
request schema, renderer commands and capabilities acquire no MCP action. The
review binds a native request ID, exact document, loaded state and generation.
Default/Escape cancel; approval rechecks focus and current generation.

`TauriTerminalService` calls the existing Core `prepareMcp`, displays the complete
bounded grant, then signs its exact challenge once after explicit native acceptance.
Concurrent authorizations/process mutations are refused while consent is pending.
Wrong confirmation IDs, blur/layout revocation, shutdown, late preparation and
expired consent cannot sign. Core independently checks the owned running pair,
fixed source/worker UUIDs, epoch, workspace, maximum deadline, byte limits and replay.
Focusing B to review never swaps the source/worker roles.

On document destruction/reload, the private service calls Core `closeSlot`, which
invalidates MCP before disposing that slot's existing transport. Hiding a retained
pane only revokes input/pending consent. Native transport ambiguity fences the
document without automatic mutation retry. No retirement/reselection, reservation
release, quarantine reconciliation, process adoption or provider-tool approval is
added. Existing EOF/Core cleanup remains authoritative.

No observer HTTP route, WebSocket message, cookie, CSP, ingestion or captured-content
rendering changes. Grants/proofs/keys stay in native/Node composition; paths and
grant metadata are shown only in native review. Private socket/capability modes,
secret handling, environment allowlists and inherited-provider configuration rules
remain those of the existing Core. A completed native consent means only that the
grant was authorized; task delivery/result still require actual MCP calls.

See the [workflow, checks and remaining gates](../development/tauri-interactive-mcp.md).
