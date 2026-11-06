# Studio Open gesture authorization — 2026-11-06

## Owner decision

The owner explicitly selected direct opening from Studio. The focused main-window
Open gesture authorizes the exact selected CLI/model/workspace or batch, including
private provisioning and the subsequent owned Open. Ordinary `create-selected`
and `create-batch` no longer present an additional preparation or CLI-use sheet.
This supersedes only the ordinary Studio dialog UX in earlier consent decisions;
revocation, permission expansion, MCP grants, destructive actions and legacy
manual preparation retain their existing checks and reviews.

## Pinned reference review

- Anywh [51bca540a205401c5a89c60dae86e99d7392b9ed](https://github.com/anywh-sh/anywh/tree/51bca540a205401c5a89c60dae86e99d7392b9ed):
  `docs/architecture.md`, `docs/agent-host.md`, `relay/src/runtimes/README.md`,
  `relay/src/runtimes/defs/claude/persistent.ts:buildPersistentArgs` and
  `relay/src/agentHost/claudeProcess.ts`. The persistent driver builds CLI arguments
  with the selected permission mode (default `default`); the agent host owns spawn.
  This is a stream-JSON host, unlike ORQST's native PTY and signed broker.
  Root LICENSE is Apache-2.0; no root NOTICE. Decision: keep ORQST's tested
  broker and adapt the direct-opening UX, without copying code, dependencies or assets.
  ORQST does not adopt Anywh's optional bypass-permissions argument.
- Tucano [91061b0d06649fa2f0f14c5d91c7ad9f35398dc1](https://github.com/eduwxyz/tucano/tree/91061b0d06649fa2f0f14c5d91c7ad9f35398dc1):
  `src/main/index.ts:workspaces:delete` and `update:install` show dialogs for
  destructive deletion or interrupting active work during update. These specific
  call sites support retaining destructive-operation reviews; they do not prove
  the absence of every dialog elsewhere. Root LICENSE is Apache-2.0; no root
  NOTICE. Decision: retain ORQST's own IPC and lifecycle implementation; no copying.
- Overclock: no licensed source candidate is incorporated. This increment changes
  authorization transport, not terminal visual assets or layout.

## Security contract

The renderer request shape does not change. Studio still requires a real activation
in the existing client and the native main source, actual first responder, current
preparation generation, single-use commit latch, admission fence, immutable catalog,
model/binary/hash/path and provisioning revalidation. The prepared opening intent
still binds the exact profile, terminal document, presentation generation and expiry,
is consumed once, and is invalidated by blur/navigation/revocation.

Only `terminal_open_prepared` can mark the private Rust-to-Node request
`openingAuthorized: true`, after consuming that intent. The service accepts it only
for `open`; its lifetime is the current request, never a persistent renderer grant.
The policy store still hashes and rechecks the binary, compares permission scope,
refuses explicit revocation, atomically persists its epoch and rejects concurrent
policy changes. The broker independently revalidates focus/document/generation and
consumes fresh signed Core start/attach/input challenges; journal/audit is unchanged.
The mark is absent from public request/reply schemas. Observed sessions gain no route.
Provider permission modes and tool approval defaults are unchanged. MCP pair consent
and legacy manual opening keep their own existing review. No new dependency or API
network endpoint is added.

Synthetic tests are source evidence only. Native Studio focus, provider approvals
and one-click opening require owner acceptance in the separately packaged candidate.

Source checks for this increment: 100 selected/batch provisioning cases and 38
policy/service cases passed; Rust custom-protocol 183 passed with two existing
ignored tests; lint and typecheck passed. Full integrated checks and signed
packaging are recorded separately; these focused runs are not native acceptance.
