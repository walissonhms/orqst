# Feature-scoped mentions and communication

## Current routes

| Surface             | Authority and result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Studio PTY composer | Resolves stable pane handles from the current canvas. The bridge checks current Feature membership again. An owner message may enter an opted-in MCP inbox. The receipt says `queued`; the receiving CLI must explicitly call its inbox tool. A composer sender selected as a terminal has no route.                                                                                                                                                                                                                                                                                                                                                                                  |
| PTY MCP hub         | One authenticated local relay per opted-in slot. A terminal can list other slots, send, and queue tasks within its active Feature. This is the existing hub membership policy. The worker must pull the task and explicitly submit a result. The hub never starts a provider turn or types into a PTY.                                                                                                                                                                                                                                                                                                                                                                                |
| Signed PTY MCP pair | The existing source/worker transport has a separate native one-use grant and distinct `wait_task` workflow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Structured agents   | With `ORQST_STRUCTURED_AGENTS=1`, open an active Feature and use **Structured agents → Delegate a task**. In **Worker session**, enter an unambiguous `@name` or `@<session UUID>`, then enter the exact task. The source is the session selected in the panel. The host resolves the handle during both prepare and apply, checks that it still resolves to the submitted ID, and uses the existing native one-time grant review. Approving the grant prefills the source turn. Review and send that turn separately. The source must call the existing structured delegation tool with the granted target and exact task. CLI/Core events drive the worker turn and result receipt. |

Structured handles are case-insensitive, Feature-local and satisfy the address
grammar shown in the [request schema](../../packages/protocol/src/structured-agents.ts).
Session UUIDs remain usable when a label has spaces or a same-Feature name
collision. Another Feature's identical label, a stale target binding, and a
self-target confer no authority. The orchestrator designation is descriptive.
The native review binds both the submitted handle and the resolved grant.
Structured sessions and PTY panes have distinct identities and launch paths.

## Source findings

- The Node host and Rust Core enumerate provisioned MCP slots before a relay
  authenticates. Both previously exposed those slots as `running`. The listing
  now reports `mcp_connected` for an authenticated local relay and
  `unconfirmed` for a provisioned slot without that evidence. A connection
  says nothing about the model's current activity or ability to accept a turn.
  See [Node host](../../packages/core/src/terminal/host.ts#L93),
  [Rust membership](../../apps/tauri/terminal-core/src/hub/journal.rs#L179)
  and [hub listing](../../packages/core/src/terminal/mcp-hub.ts).
- The hub previously called a delegation `delivered` at enqueue. It now
  reports `queued` at admission and `dequeued` when Core services the
  worker's authenticated inbox read. A socket may close before its response is
  consumed. `done`, `failed`, and `blocked` represent explicit worker
  submissions. If the source inbox cannot accept the result, `resultQueued`
  is false and the original participants can use `task_status`.
  See [Node hub](../../packages/core/src/terminal/mcp-hub.ts) and
  [Rust hub](../../apps/tauri/terminal-core/src/hub/hub.rs).
- Recipient strings previously deduplicated before resolving identity.
  Alias variants could consume two inbox slots for one send. Resolution now
  requires one match per address and deduplicates by terminal ID before
  admission. Queued content and task status are bound to the original
  Feature and checked against current endpoint membership. The hub keeps
  bodies and task state in memory. The existing audit persists queue metadata.
  See [Node hub](../../packages/core/src/terminal/mcp-hub.ts) and
  [Rust hub](../../apps/tauri/terminal-core/src/hub/hub.rs).
- The Studio composer previously matched substrings of emails, code samples
  and qualified handles. It now requires an exact unambiguous pane handle in
  text outside code. The structured dialog uses its own address field and the
  private sidecar resolves current sessions before the existing grant review.
  See [PTY composer](../../apps/dashboard/src/MentionComposer.tsx#L38),
  [structured host](../../apps/desktop/src/tauri-structured-agents-host.ts),
  and [native review](../../apps/tauri/src-tauri/src/features.rs#L1915).

## Per-provider boundary

| Provider    | PTY opt-in and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | The PTY path accepts the reviewed 0.162.1 and Apple Silicon 0.169.0 version/SHA pairs and adds the required per-launch `mcp_servers.<name>` stanza with 10 s startup and 125 s tool limits. Inherited MCPs remain configured. A required relay startup failure can prevent opening the TUI. The separate structured pilot uses app-server sessions and its existing dynamic tool instead. [PTY profile](../../packages/core/src/terminal/codex-profile.ts#L357) and [structured pilot](../design/structured-codex-pilot.md).                                                                                |
| Claude Code | The PTY adapter accepts only reviewed version/SHA pairs (2.1.178 and 2.1.318 in the MCP catalog), generates `--strict-mcp-config --mcp-config` and a launch UUID, and preserves the native login. Keep any unreviewed binary refusal pending a new review. The strict project MCP approval may still refuse this server. Owned hooks plus MCP additionally require the reviewed hook-capable configuration. Claude is outside the structured pilot. [MCP config](../../packages/core/src/terminal/provider-mcp-config.ts#L10) and [PTY gate](../../packages/core/src/terminal/interactive-profile.ts#L102). |
| OpenCode    | The reviewed 2.2.5 PTY configuration uses `--standalone` and a local server in merged `OPENCODE_CONFIG_CONTENT`. Startup and native database/plugin effects require separate authorization. The structured pilot uses an owned server, permission decisions, and provider session events. [MCP config](../../packages/core/src/terminal/provider-mcp-config.ts#L107) and [structured pilot](../design/structured-opencode-pilot.md).                                                                                                                                                                        |

Existing evidence includes separately documented real Codex and OpenCode native
terminal interaction and the OpenCode structured no-turn startup smoke. No real
CLI was invoked for this correction. Real CLI hub discovery, pull/result behavior
across providers, Claude MCP approval, and native structured review plus an
authenticated A → B → A round trip remain acceptance items. The pair transport
and the Rust/Node fixture parity cover distinct contracts.
[Native terminal milestones](../architecture/v6-feature-checklist.md#current-human-verified-milestones--2026-11-05)
and [interactive MCP evidence](interactive-cli-mcp.md).

## Pinned reference decisions

- **Anywh `4f8aef7b5f0dc9cf0832e457c224dc09a9792a21`, Apache-2.0.**
  `roomToolsFor`, `RoomManager.delegate` and `recordReport` use the Node/TypeScript
  room host, role-scoped tools and a per-room worker tree. Keep ORQST's existing
  attributed async tool surface. The hub already queues for provisioned Feature
  members, and structured execution already requires native grants. The upstream
  room worker launcher and recovery model would change that authority.
  [Room tools](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/relay/src/session/roomTools.ts#L127),
  [Room manager](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/relay/src/session/roomManager.ts#L1211),
  [Agent Host](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/docs/agent-host.md)
  and [license](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/LICENSE).
- **Tucano `0501956d127699300209902e889f3e69a0948766`, Apache-2.0.**
  `mentioned` and `routerPrompt`/`parseRoute` use TypeScript Agent/channel
  state and a model router for untargeted channel messages. ORQST retains its
  existing attributed mention-pattern work and explicit address selection.
  Provider output and channel prose cannot authorize an ORQST turn.
  [Context](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/context.ts#L303),
  [router](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts#L46)
  and [license](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE).
- **T3 Code `de7b5e05f6a95573f65c923727fe84542a5b86e9`, MIT.**
  `taskStatusForRun` and `taskResultTransfer` use Effect and orchestration
  projections to correlate status and a child-to-parent context transfer.
  Keep ORQST's private socket and local one-use grant. T3's loopback HTTP MCP
  bridge adds a different exposure surface, and its default run mapping can
  report running when a run is absent.
  [Service](https://github.com/pingdotgg/t3code/blob/de7b5e05f6a95573f65c923727fe84542a5b86e9/apps/server/src/mcp/OrchestratorMcpService.ts#L492),
  [MCP contract](https://github.com/pingdotgg/t3code/blob/de7b5e05f6a95573f65c923727fe84542a5b86e9/docs/orchestration-v2/orchestrator-mcp-server.md)
  and [license](https://github.com/pingdotgg/t3code/blob/de7b5e05f6a95573f65c923727fe84542a5b86e9/LICENSE).

The three pinned trees contain no root NOTICE. Existing ORQST attribution
remains in NOTICE. No third-party dependency or source was incorporated in
this increment.

## Native acceptance for the owner

1. Use a separate disposable Preview built from the integrated branch, with
   isolated app data and a private workspace. Start two reviewed hub PTYs in
   Feature A and a third in Feature B. Run the following twice, with the default
   Node Core and with `ORQST_RUST_TERMINALS=1`.
2. From A1 call `list_terminals` in the actual CLI and verify A2's relay state
   and the absence of B. Send an owner mention to A2 from Studio. Confirm
   **Queued** while A2 remains idle, then ask A2 to run `read_messages` and
   verify the exact message and owner identity. Repeat with an email, code
   sample and qualified handle and verify that the composer resolves none.
3. Ask A1 to call `delegate_task` for A2 with a harmless request. Check
   `task_status` before and after A2 explicitly reads the task. Have A2 call
   `submit_result`; verify the matching task ID and summary at A1 by reading
   its inbox and checking status. Verify B cannot query that task ID. On Claude
   or a different installed binary, record any review or startup refusal
   before trying a different provider.
4. In a separate run with `ORQST_STRUCTURED_AGENTS=1`, start two approved
   structured sessions in one Feature. Enter the worker's handle and a
   harmless exact task, cancel the first grant sheet, and confirm no worker
   turn starts. Approve a fresh grant, then explicitly review and send
   the source turn. Verify its dynamic tool call, the worker's accepted and
   completed events, and the result receipt in the original source turn.
   Repeat with a duplicate name and an exact session UUID, then switch
   Features and confirm that only addresses in the selected Feature resolve.
