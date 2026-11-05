# Feature permission reuse review — 2026-11-05

The implementation follows the preserved V6 Feature hierarchy, especially
[MASTER lines 281–301](../design/v6/source/ORQST_MASTER_SPEC_FEATURES_ATUALIZADO.md),
line 286's intra-Feature default, role neutrality and explicit cross-Feature gate.
The HTML's role-driven simulated delegation is presentation, not authorization.
The operation names delegate/execute/view are this increment's reviewed contract.

The source checkouts below were inspected outside the application; exact SHAs were
revalidated for this increment. No upstream source or asset is incorporated, and no
dependency is added. Historical audit records remain unchanged.

## ORQST: keep the existing implementation

Baseline: `4231f76da29e347ef6d6c8841582c3f62d0c41d5`.
`packages/database/src/features.ts` (`openFeatures`, read/assign/CAS/audit),
`terminal-teams.ts` (`openTerminalTeams`), Core `communication/service.ts`
(`PaneCommunication.authorize`, admit, dispatchNext, visible, notify) and
`terminal/feature-configuration.ts` already provide the required identities,
transactions, exact grants and composition boundary. Dependencies are the existing
Node 24 `node:sqlite`/crypto, Zod 4 and protocol/shared modules; repository LICENSE
and package metadata are Apache-2.0. Decision: **keep and narrowly extend**.
A parallel runtime, transport or interpretation of role would weaken the existing
contract. The new policy can only restrict current authorization.

## Anywh: do not use the permission bridge for this policy

Pinned revision: `546f189c04415c3c5af5f40e3931a0a90b9aba31`.
The required [architecture](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md),
[Agent Host](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md)
and [runtime contract](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md)
were reviewed alongside actual bridge code.

[permissionBridge.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/bridges/permissionBridge.ts)
defines `PermissionCheckHost.checkPermission`,
`McpPermissionBridge.registerTurn` and `handleRequest`.
[Its tests](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/bridges/permissionBridge.test.ts)
cover a turn-scoped bridge. Direct dependencies are `node:http`/`node:crypto` plus
an implementing session host. The bridge uses ephemeral tokens to decide a pending
Claude CLI tool approval; it is not a persisted Feature matrix or SQLite CAS audit.
Its local `readJsonBody` accumulates chunks without a byte limit in that file.
Copying it would introduce HTTP/MCP/approval changes outside this increment and
would not solve the persistence contract. Decision: **do not use this component**;
keep ORQST's existing native grants and CLI approval boundary.

The pinned [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
is Apache-2.0. No tracked NOTICE was found; the inspected bridge has no additional
license header. No code is copied, so no modification/attribution payload is added.

## Tucano: keep ORQST's task-scoped authorization

Pinned revision: `0501956d127699300209902e889f3e69a0948766`.
[db.ts](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/db.ts#L361)
implements conversation membership through `createConversation`, `setMembers` and
`setAgentChannels`, using `node:sqlite`, crypto and internal Conversation/Agent
models. [runs.ts](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/runs.ts#L333)
resolves conversation members, and its chain orchestration resolves mentions among
members and schedules execution. That orchestration depends on engines, gateway,
context and queue services, not an isolated Feature permission helper.
[policy.ts](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/policy.ts)
`allowed(tool, grant)` applies read/read_write connector governance, not a directed,
revision-bound terminal policy. Channel membership cannot replace exact native
actor/target/task grants. Importing orchestration would create a parallel runtime
and risk treating prose as execution authority. Decision: **keep ORQST**.

The pinned [LICENSE](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE)
and package metadata are Apache-2.0. No tracked NOTICE or additional license header
was found in this component. No source is copied or adapted.

## Overclock

[Overclock](https://overclock.sh) remains a UX reference. No exact source repository
and compatible source/asset license were established for this component; decision:
**do not use source/assets**. No Overclock runtime or messaging integration is added.

## Production wiring revalidation — 2026-11-05

The wiring increment starts from ORQST `5db368b`. Revalidated the exact Anywh and
Tucano SHAs above and their Apache-2.0 LICENSE files; neither checkout tracks a
NOTICE. No external source, asset or dependency is incorporated.

Anywh's pinned
[Agent Host protocol](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/protocol.ts)
(`parseClientMessage`, `AGENT_HOST_PROTOCOL_VERSION`) and
[socket server](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/socketServer.ts)
(`ensurePrivateDir`, `SocketServerOptions`) use a separate persistent agent host,
Unix socket/handshake, generic request parameters and resumable logs. Dependencies
include Node net/fs/path, its log reader and line splitter. This is not a trusted
Feature-catalogue bootstrap and would replace ORQST's existing private IPC/native
ownership contract. Decision: **keep ORQST**, no transport/session manager import.
The permission bridge and Tucano channel/policy decisions above still apply.

The exact ORQST components reused are
`terminal/preparation-context.ts::resolveTerminalPreparationContext`,
`terminal/codex-profile.ts::readManagedCodexConfig`,
`terminal/identity.ts::terminalIdentity`,
`terminal/feature-configuration.ts::featureConfigurationDatabase`,
`managed-codex/runtime.ts::CodexStructuredRuntime` and the existing
`managed-agents-core.ts`/`managed-agents-host.ts` fork/IPC chain.
The narrow adaptation adds bootstrap validation and captured-scope checks,
injects the existing permission reader, and routes Feature mentions/team proposals
through existing facades. Rust `agents.rs` supplies the same native app-data roots
as `terminal_creation.rs`; IDs are resolved inside the owned Node bootstrap from
validated preparation bindings/catalogue, never taken from a renderer request.
No external runtime, catalogue, database schema or administrative transport is added.

## Native review correction — 2026-11-05

The existing ORQST native consent and private Node/Core channel remain the reuse
basis; the pinned Anywh and Tucano decisions above do not change. The review
binds the Feature and view revisions in the existing SQLite transaction rather
than importing a separate upstream permission or session manager. No third-party
source was copied.

The Rust review now directly declares `sha2` 0.10.9, already present transitively
in the locked Cargo graph. The installed crate metadata declares `MIT OR
Apache-2.0`; the package contains `LICENSE-MIT` and `LICENSE-APACHE`, with no
NOTICE found. The locked checksum is
`a7507d819769d01a365ab707794a4084392c824f54a7a6a7862f8c3d0892b283`.
See the exact [crate release](https://crates.io/crates/sha2/0.10.9) and its
[RustCrypto repository](https://github.com/RustCrypto/hashes). The dependency is
used to bind a review plan digest to the audited save, not as evidence of native
consent or platform acceptance.
