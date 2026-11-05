# Single local CLI authorization — source review, 2026-11-05

Baseline: `f2466101c5731189f68f555d180eb8a879f6f3a9`, clean main before an isolated worktree.
Node `>=24 <25`, pnpm `10.34.9`, TypeScript `~6.0.3`; Cargo.lock pins Tauri `2.12.5`,
Tokio `1.54.1`, objc2 `0.6.5`. No dependency or lockfile changes.

## Required reference review

The files below were fetched at the exact revisions before implementation. No upstream
source is incorporated; existing LICENSE/NOTICE attribution remains intact.

- Anywh [architecture](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md),
  [Agent Host](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md),
  [runtime contract](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md),
  [AgentHost.restore/drain](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/agentHost.ts),
  [hostClient replay](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/hostClient.ts):
  retain ORQST's existing owned Core, receipts and private transport. Anywh restores
  agent metadata and supports session resume/process sweep, whereas this increment must
  neither adopt nor resume uncertain processes. Its Node/socket/registry/CLI driver
  dependency closure is unnecessary for changing the consent decision.
- Anywh [McpPermissionBridge / PermissionCheckHost.checkPermission](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/bridges/permissionBridge.ts):
  keep provider approvals separate. It answers provider tool permissions over HTTP/MCP,
  using Node HTTP/crypto and a turn-scoped host. A CLI-use policy must not auto-answer
  that bridge, change ask-for-approval, or use bypassPermissions. Keep ORQST, no copy.
- Tucano [policy.allowed / approvalHash](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/policy.ts),
  [router.route](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts),
  [Gateway.open / handle](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/gateway.ts):
  retain exact scope and operation binding. Its connector grants, model-directed routing
  and per-turn MCP tool allowlists depend on the shared types, runner/database and MCP
  SDK. They cannot substitute for native document/focus checks or establish bilateral
  cross-Feature authority. Keep ORQST, no copy.

Both exact root LICENSE files are Apache-2.0:
[Anywh](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE),
[Tucano](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE).
The existing pinned tree audit records no upstream NOTICE; selected sources retain
no copied headers because no code is copied. No new dependency license closure is needed.
Overclock provides the owner's workflow reference only; no exact reusable source/license
was identified, so no source or assets are used.

## Decision

Adapt the consent decision in the existing ORQST native broker, without replacing its
supervisor, signed one-shot challenges, ownership, journal, capacity or provider drivers.
A private local policy authorizes normal use of explicitly opened owned terminals with
one reviewed executable. It stores only canonical path, binary hash, authorization epoch
and the explicit permission scope. It stores no PID, session, key, proof or captured text.
Model/cwd/argv remain part of the immutable Core-validated profile and each challenge.
A changed executable needs a new CLI review; a broader permission scope fails inline.

Native origin, current document, focus, generation, owned intent, actual binary/profile
validation, CSP, short-lived signed proofs, input sequence/rate/size caps, receipts,
uncertain transport and MCP opt-in remain separate fences. No observer API is added.

## Acceptance boundary

Synthetic tests can validate policy, broker transitions and malformed/replayed requests.
They do not validate macOS focus, native consent presentation, real providers or Quit.
Window-close/hide and deterministic owned shutdown remain with the native lifecycle
increment; this change must not claim that removing a Quit dialog proves cleanup.
