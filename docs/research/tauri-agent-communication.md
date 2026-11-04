# Tauri structured agent communication — 2026-11-04

## Baseline and scope

Baseline `ee08ecb` on main had concurrent README/ROADMAP edits and an untracked
master-spec tracker. Work was isolated in `feat/tauri-communication-683` at
`/private/tmp/orqst-tauri-communication-683`; those edits and other worktrees were
preserved. The master specification, repository rules, original implementation plan,
preserved Tucano audit, current Tauri implementation and managed composition were
read before implementation. Baseline `pnpm test`: 594 passed.

Confirmed toolchain: Node 24.22.2, pnpm 10.34.9, TypeScript 6.0.3, React 19,
Tauri 2.12.5, Electron 45.2.1, node:sqlite, node-pty 1.1.0 and xterm 6.0.0.
No runtime or framework upgrade, new provider protocol or second session manager.
This increment ports the existing structured two-Codex client; it does not constrain
the eventual N-member model or claim completion of the master specification.

## Pinned component review

Research checkouts were separate from ORQST. Upstream executables, dependencies and
install scripts were not run. The earlier required Anywh documents were inspected:
[architecture](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md),
[Agent Host](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md),
[runtime contract](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md).
Behavior decisions below use source rather than README claims.

| Candidate                       | Exact source and dependencies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Decision and contract differences                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native sidecar                  | Anywh `546f189c04415c3c5af5f40e3931a0a90b9aba31`, [`client/src-tauri/src/tailnet_sidecar.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs), `TailnetSidecars`, `tailnet_sidecar_start`, `kill_all`; Tauri shell, Tokio, serde                                                                                                                                                                                                                                                                                                                                      | **Keep existing ORQST adaptation.** Extend the fixed-entry/private-pipe pattern already used by `terminal.rs`; retain owned handles, bounded drain, shutdown and native-only capability. No remote tailnet/profile service or arbitrary renderer spawn.                                                                  |
| CLI permissions                 | Same Anywh pin, [`relay/src/bridges/permissionBridge.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/bridges/permissionBridge.ts), `McpPermissionBridge`, `registerTurn`, `handleRequest`; Node HTTP/crypto. [`session/permissionModes.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/session/permissionModes.ts), `resolveInitialMode`; runtime definitions. [`session/approvalInput.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/session/approvalInput.ts), `compactToolInput`; standard JS | **Do not use.** These address Claude tool approval and provider permission modes, not ORQST's directed agent-message authority. Their tokenized HTTP path, persisted fallback modes and compacted review inputs cannot replace exact one-use Core challenges. Native CLI tool approvals are not added by this increment. |
| Mentions                        | Tucano `0501956d127699300209902e889f3e69a0948766`, [`src/core/context.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/context.ts), `mentioned`; [`src/shared/types.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/shared/types.ts), `CODE_SPANS`; standard JS for selected fragment                                                                                                                                                                                                                                                                    | **Reuse existing attributed adaptation** in `packages/core/src/communication/mentions.ts`. No second parser. Core resolves submitted mentions to stable UUIDs, rejects ambiguity and checks directed routes before task admission.                                                                                       |
| Automatic chaining              | Same Tucano pin, [`src/core/runs.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/runs.ts), `Runner.chain`, `MAX_DEPTH`; application DB/runner/engines and language contracts                                                                                                                                                                                                                                                                                                                                                                                                                     | **Do not use.** The method scans model reply text and enqueues conversation turns. ORQST requires explicit source-backed task calls and separate signed authorization; captured prose cannot grant delivery authority. Existing Core already supplies loop prevention, task queue, state and return correlation.         |
| Panes and navigation            | [Overclock official reference](https://overclock.sh/en), native panes and delegation presentation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **Functional reference only.** Exact source repository/SHA and compatible license were not established. No source/assets, binary extraction or visual identity copied.                                                                                                                                                   |
| Existing structured composition | [ORQST baseline `ee08ecbf6d5c008fedeb7fd41cf993e5ba464988`](https://github.com/walissonhms/orqst/tree/ee08ecbf6d5c008fedeb7fd41cf993e5ba464988), `DesktopManagedAgents`, `connectManagedAgents`, `managed-agents-host.ts`, `managedAgentsDocument`, `managed-agents-client.ts`; Node crypto/IPC, SQLite, protocol, i18next                                                                                                                                                                                                                                                                                                                     | **Reuse directly.** Add only a Tauri browser adapter, parent-pipe review service and native shell integration. Keep the existing runtime, driver, signatures, journals, permissions, deny-by-default policy and Electron implementation.                                                                                 |

Anywh and Tucano exact root LICENSE blobs were inspected again: Apache-2.0, with
SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.
Tracked trees expose no additional NOTICE/COPYING or selected-source license header.
[LICENSE Anywh](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE),
[LICENSE Tucano](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE).
No new upstream fragment is copied: existing source attribution and root NOTICE
remain intact. No upstream package closure is installed. The new protocol workspace
link uses Apache-2.0; pnpm generated the lock change. New bundles reuse existing
Tauri API (Apache-2.0 OR MIT), i18next (MIT), zod (MIT) and Node standard modules.
The resource builder includes actual agent bundle inputs in its notice gate.
Full native transitive redistribution obligations remain unresolved as documented
in the [earlier shell review](tauri-core-reuse.md); this is not installer clearance.

## Security review and limitations

The [native contract](../api/tauri-agents.md) documents exact document identity,
user activation/focus, generations, bounded reviews, Cancel defaults, signatures,
serial mutations, pipe limits and no retry/adoption. The remote dashboard receives
no command capability. Observer HTTP, WebSocket, cookies, source access, CSP and
read-only ingestion are unchanged. `orqst-agents` has its own restricted protocol,
window capability and resources; no renderer shell/dialog/filesystem grant.

Prepared fresh profiles and native authentication acknowledgments are still required.
An invalid structured selection leaves observer/PTY startup independent. Tauri uses
a separate `structured-agents` admission directory, but profile journals remain the
ownership source: never select profiles in use by Electron or PTY terminals. Hiding
keeps owned work and drafts; it never signals a process. Quit requires disconnect
consent. Metadata persistence is not durable process or payload recovery.

No N-member structured team, mixed-provider message delivery, arbitrary provider tool
approval, automatic planning, new team creator, durable reconnect, token/spend hard
containment, native WebKit consent acceptance, installed-provider login/task acceptance,
Windows/Linux/Intel builds or signed installers is claimed. Keep Electron until
parity is proved. The prepared PTY team and structured communication remain separate.

Rollback is `git revert <increment-commit>` after integration. Do not reset journals,
release uncertain admission, restart resident apps or rewrite native sessions. Additive
bundled resources and capability are removed by rebuilding; existing private state is
preserved. Full UI/provider acceptance remains a separate owner milestone.

## Verification

Results and the actionable acceptance checklist are recorded in the
[Tauri development guide](../development/tauri.md#structured-agent-communication--2026-11-04).
The packaged acceptance uses fixed synthetic C executables, actual isolated Node
hosts and SQLite, and Chromium running the shipped Tauri browser bundle. The native
invoke/focus/dialog boundary is simulated and explicitly labeled. No credentials or
observed sessions are read. No service or resident Desktop is restarted.

Executed in this isolated worktree with Node 24.22.2/pnpm 10.34.9 and the existing
isolated Rust 1.99.1 toolchain:

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: passed. The existing Vite chunk-size
  advisory remains; no dependency, timeout or warning budget was weakened.
- Final `pnpm test`: **600 passed**, zero failures, cancellations or skips. This
  includes the final browser adapter, review service and unchanged regression suite.
- Six focal Node tests cover mutation activation, foreign fields, invalid native
  replies, private-diagnostic suppression, current one-use routing signatures,
  explicit cancellation, revoke/close, stale preparation, oversized/expired reviews
  and concurrent snapshot/mutation behavior. They passed after the final browser
  boundary extraction. Packaged acceptance also passed with that exact shipped bundle.
- `pnpm test:tauri`: three Rust tests passed, including exact structured-window
  identity and cross-surface rejection. `cargo fmt` and `cargo clippy -- -D warnings`
  passed. Cancelling either quit review resets prior quit approvals for both native
  surfaces; human native-modal acceptance remains pending.
- `pnpm build:tauri --debug --bundles app`: passed, generating a macOS Apple Silicon
  debug `.app` (163.23 MiB). The app was built but not launched for human acceptance.
  After verification, only this worktree's generated Cargo intermediate directories
  were removed to relieve disk pressure; its executable and `.app` were preserved.
- `pnpm accept:tauri-agents --authorize-synthetic`: passed. Actual packaged Node
  helpers and two fixed synthetic C CLI processes established independent threads,
  cancelled startup, signed starts/routes/tasks, deny-by-default/cycle rejection,
  autocomplete, correlated source→worker→source results, confirmed native exits,
  signed retirement and graceful pipe shutdown. Chromium ran the actual Tauri adapter
  and shared document/client. Invoke identity/focus/native dialog decisions were
  simulated; no installed provider or credentials were used.
- Existing `pnpm accept:tauri-core` and
  `pnpm accept:tauri-terminals --authorize-synthetic`: passed against the expanded
  resource bundle, retaining observer/Analytics and independent PTY transport evidence.
- `git diff --check`: passed. No generated output, captured content, credentials,
  local instructions, private journal or acceptance log is committed.

The first full suite during concurrent native compilation reported 596 passed,
one failure and one cancellation: the existing 40 ms MCP grant test expired before
its authorization, and the existing native-initialize diagnostic test exceeded its
55-second limit. The unchanged MCP file passed separately; the next full suite
passed all 598 then-present tests. No application/test timeout or assertion was
changed. A later optional browser-activation assertion was invalidated by
Playwright/CDP's synthetic gesture state; activation rejection is now exercised at
the actual injected browser boundary, while packaged UI tests retain real click,
authorization and delivery assertions. No application guard was relaxed.

Not run: full Chromium suite, Electron native UI smoke, real provider login/inference,
human Tauri/WebKit active consent, `validate:local`/`validate:live` (ingestion unchanged),
other-platform builds, signed/notarized distribution or complete native notice audit.
