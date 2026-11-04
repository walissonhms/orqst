# Product preparation of a Codex/OpenCode MCP pair — 2026-11-04

Baseline: `28a03a2dd977dcb4324cef1785cc312a0433cc07`, isolated branch
`feat/tauri-mcp-product-715`. No provider, CLI probe, authentication database,
Core host, PTY, native application, Cargo build, resources or installed package
was started or changed. Installed dependencies were linked into the worktree;
no installation, dependency update, Node copy or new Cargo target was made.

The source manifests/lock retain Node `>=24 <25`, pnpm `10.34.9`, TypeScript
`~6.0.3`, React `^19.3.1`, Tauri 2 (Rust lock `2.12.5`), Zod, `node:sqlite`,
node-pty `1.1.0` and xterm. Checks used the existing Node `24.22.2` / pnpm
`10.34.9` toolchain. Protocol remains schema-only, dashboard remains React-only,
and native preparation continues to call the existing passive Node helper.

## Revalidated source and reuse decisions

The existing separate research checkouts were inspected at the exact commits
below, including Anywh's `docs/architecture.md`, `docs/agent-host.md` and
`relay/src/runtimes/README.md`. No upstream runtime or install script was run.

| Candidate                                | Pinned implementation inspected                                                                                                                                                                                                                                                                                                                                                                                                                                      | Contract, dependencies and decision                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anywh runtime and native ownership       | [`TailnetSidecars`, `Running`, `tailnet_sidecar_start`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs); [`CodexSessionDriver`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/codexDriver.ts); [`assertCoherent`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/registry.ts) | Tauri shell/Tokio/serde; Node runtime driver/protocol/session modules. **Keep ORQST's existing adaptation and Core.** App-server thread/turn continuity and tailnet lifecycle do not implement this interactive Codex/OpenCode pair. No new host, reconnect, provider driver or process-adoption mechanism.                                     |
| Anywh MCP permission bridge              | [`McpPermissionBridge.registerTurn`, `handleRequest`, `PermissionCheckHost`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/bridges/permissionBridge.ts)                                                                                                                                                                                                                                                                  | Node HTTP/crypto and Claude provider approval callbacks. **Do not use.** Token-addressed provider-tool approvals are different from ORQST's instance/epoch-bound one-task communication grant; importing them would add a transport/trust boundary.                                                                                             |
| Tucano gateway and routing               | [`Gateway.open`, `handle`, `Session`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/gateway.ts); [`route`, `parseRoute`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts); [`Runner.chain`, `MAX_DEPTH`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/runs.ts)                                                             | Node HTTP/net/crypto, MCP SDK, application engines/DB/language/types. **Keep ORQST.** Per-turn secret-URL tools and reply-text speaker chaining cannot replace exact signed source/worker ownership or prove CLI receipt. No HTTP gateway or text-based task authority is imported.                                                             |
| ORQST factory, preparation and transport | [`28a03a2`](https://github.com/walissonhms/orqst/tree/28a03a2dd977dcb4324cef1785cc312a0433cc07): `terminal-creation.ts::prepareTerminalCreation`, `terminal-catalog.ts::terminalPreparationCatalog`, `managed-files.ts::inspectManagedTerminalFiles`, `interactive-profile.ts`, `opencode-profile.ts`, `InteractiveMcpSession`, `McpTaskBroker`, `TerminalNativeBroker`, `TauriTerminalService::authorizeMcp`                                                        | Existing Node crypto/fs, Zod, SQLite and PTY/private RPC composition. **Reuse directly with a narrow preparation adaptation.** Select both real catalog entries, persist independent models through the existing mixed factory, then enter the existing native host, grants and Unix/stdio relays. No Core or transport implementation changes. |

Both pinned root licenses are Apache-2.0:
[Anywh LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE),
[Tucano LICENSE](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE).
The tracked trees contain no NOTICE/COPYING file; the selected implementations
have no additional licensing header. No upstream code/assets or dependencies
are incorporated here, so there is no new third-party dependency license closure
or modification notice. Existing ORQST LICENSE/NOTICE and prior attributions remain.
Overclock is only the already approved pane UX reference; no newly verified
reusable source/license or assets are claimed or used. The preserved Tucano audit
is unchanged (the historical plan/audit are local files in the main checkout).

## Smallest composition

Normal CLI → model → Open remains an independent terminal with ORQST MCP disabled.
A separate, unchecked communication option for Codex/OpenCode prepares exactly two
fresh members, in either source direction, in the same validated workspace and
optional current Feature. The request carries both opaque model IDs and the
existing catalog/scope fence; it cannot carry files, executable paths, MCP socket
paths, task text, launch proofs or grants.

The existing factory now accepts a companion's own model instead of applying the
source model to both providers. Every member's model evidence is checked before
planning, before writing and before publication; catalog revalidation remains
before the native commit latch. All complete bounded review pages must be approved
within the same existing deadline. The review names the exact source and worker
terminal UUIDs and states that a separate task grant is required. OpenCode's
existing merged-MCP and native-startup acknowledgments are explicit in the review
and resulting manifest. The same factories preserve pins, canonical paths, private
state, tool PATH and uncertain-write retention.

Native preparation rejects this action while a terminal Core is already running.
It forwards exactly two files to the existing operational-Open flow, with a
separate signed confirmation for each CLI. Existing MCP-host composition derives
roles from that reviewed file order, binds actual owned instance IDs/epoch at
start, and exposes the existing native one-task grant review only for opted-in
pairs. No changes to `main.rs`, `sidecar.rs`, `desktop.rs`, grants, receipts,
quarantines, focus/identity checks or Core lifecycle are required.

See the [API/security contract](../api/tauri-mcp-product-pair.md) and
[workflow, checks and remaining acceptance](../development/tauri-mcp-product-pair.md).
