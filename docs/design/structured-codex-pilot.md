# Structured Codex Studio pilot

The same Studio panel now includes the [OpenCode 2.2.5 increment](structured-opencode-pilot.md).

## Reference research

| Candidate                     | Pinned source and files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Decision                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex CLI 0.169.0, Apache-2.0 | [Release source](https://github.com/openai/codex/tree/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server), [license](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/LICENSE). The installed CLI generated both TypeScript and JSON Schema with `app-server generate-ts --experimental` and `app-server generate-json-schema --experimental`. Inspected the initialize handshake, `ThreadStartParams`, `ThreadStartResponse`, `TurnStartParams`, `TurnStatus`, `ThreadItem`, `DynamicToolCallParams` and the command/file approval and server request schemas. | Implement against the wire contract. Generated files stay outside the checkout.                                                                                                                                                      |
| T3 Code, MIT                  | [Pinned source and license](https://github.com/pingdotgg/t3code/tree/de7b5e05f6a95573f65c923727fe84542a5b86e9). `apps/server/src/provider/CodexProvider.ts`, `Drivers/CodexDriver.ts`, `Drivers/CodexManagedProvider.ts`, and `packages/effect-codex-app-server/src/{client.ts,rpc.ts,_internal/stdio.ts}`. The private package uses Effect for the typed request and stream lifecycle.                                                                                                                                                                                                                | Adapt the app-server session model. Keep ORQST's bounded channel, native authorization and package stack.                                                                                                                            |
| Anywh, Apache-2.0             | [Pinned source and license](https://github.com/anywh-sh/anywh/tree/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21). `relay/src/runtimes/defs/{codex.ts,codexDriver.ts}`, `streams/codexAppServer.ts`, `transports/codexDaemon.ts`, and `relay/src/agentHost/codexPool.ts`. A per-session daemon separates request acceptance from turn completion and uses explicit interruption. Its relay/agent-host also supports recovery across relay lifetimes.                                                                                                                                                        | Adapt lifecycle and event correlation. Keep the ORQST private native IPC boundary and use ephemeral threads for the pilot.                                                                                                           |
| Tucano, Apache-2.0            | [Pinned source and license](https://github.com/eduwxyz/tucano/tree/0501956d127699300209902e889f3e69a0948766). `src/core/engines/codex.ts` and `src/core/router.ts`, with the existing ORQST audit as context.                                                                                                                                                                                                                                                                                                                                                                                          | Keep the ORQST dynamic tool and exact user grant. Tucano's ephemeral exec/gateway model has a different turn and routing contract.                                                                                                   |
| ORQST                         | `packages/core/src/managed-codex/{channel,adapter,dynamic-tools,runtime,native-host}.ts`. Historical commits `517dd63e57dd000b62dddd2ef9f7dbf9d108c626` and `b3a1bf24dc89f154fd79b98bec612a9f8a06880b` are available locally. The current tree already contains the bounded RPC channel, structured thread lifecycle, and a peer delegation tool.                                                                                                                                                                                                                                                      | Reuse the channel, dynamic tool and correlation pattern. The existing adapter serves a signed terminal-pair workflow and leaves native approvals unresolved. Add an opt-in conversation projection and approval handling for Studio. |

No upstream source, assets or dependencies were incorporated.

## Diag21 findings — 2026-11-17

The **New terminal** picker on `4829087` filtered out the installed Codex
0.169.0 because the PTY catalog and preparation only accepted the 0.162.1 digest.
Both Node and Rust PTY profiles also limited the inline MCP contract to 0.162.1.
The structured host already pinned the installed 0.169.0 digest. Rust forwards
`HOME` and `PATH` when present and passive discovery found the matching
`~/.local/bin/codex` fallback with the minimal GUI PATH. A disposable-home
app-server check opened a read-only ephemeral thread. The diagnostic capture did
not establish a separate structured launch failure.

The PTY picker and preparation now accept both exact binaries. The Node and Rust
profiles admit the inline MCP configuration for both reviewed versions. The
installed 0.169.0 reported its version and parsed the existing per-instance
stdio override in `mcp list --json` under a disposable home. See
[release configuration source](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/core/config.schema.json)
and [MCP CLI source](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/cli/src/mcp_cmd.rs).
This check confirms configuration parsing. Real provider MCP tool registration,
login, and messaging still require native acceptance. Multiple distinct
matching Codex paths keep the existing ambiguous-installation refusal.

The terminal picker now distinguishes a missing executable, an unreviewed
digest, and incomplete verification. Structured Studio reports fixed codes for
executable lookup, workspace metadata, host transport, provider connection,
startup timeout and session-policy verification.
With `ORQST_TAURI_FOCUS_DIAGNOSTICS=1`, explicit native actions can also write an
`ORQST_STRUCTURED_AGENTS` stderr line with the action, provider, review stage
and refusal code. The host omits raw exception text, executable and workspace
paths, tool payloads and credentials. The panel displays errors for background
snapshots without logging every poll.

The owner capture shows two `cli_opening=ready` events at 2,005 ms and 1,695 ms
from their opening attempts. That measures opening readiness. In its two
`ORQST_DISPATCH` lines, `mcp=false` means there was no pending bilateral MCP
review, according to the field's producer. It says nothing about hub setup.
Ordinary prepared Studio PTYs request a hub endpoint per slot. A provider must
register the relay and call `list_terminals` to discover the Feature peers.
`send_message` queues a message. `read_messages` or `wait_messages` on the
recipient provides delivery. A busy or idle TUI receives no automatic prompt,
and the hub list represents PTY membership rather than model turn activity.
The separate experimental MCP pair has its own opt-in and task consent. The
capture does not establish provider tool registration, Feature membership or
successful calls for the two PTYs. Claude MCP provider acceptance remains
pending. See [the existing PTY design](mcp-n-terminals.md).

### Peer discovery reference review

- **T3 Code, MIT, `de7b5e05f6a95573f65c923727fe84542a5b86e9`.**
  `OrchestratorMcpService.listThreads` resolves the caller's project, reads
  project threads and builds status summaries. `loadScopedThread` and
  `assertLiveCallerForOtherThread` recheck scope and live callers for writes.
  The React sidebar groups the shared session projection with
  `useSidebarProjectGroups`. Adapt the scoped metadata projection. Keep
  ORQST's native one-use grant and private provider transports, which lack an
  equivalent cross-project MCP capability. T3 uses Effect, typed workspace
  contracts and MCP. Verified the root MIT license and tree, with no root
  NOTICE. [Service](https://github.com/pingdotgg/t3code/blob/de7b5e05f6a95573f65c923727fe84542a5b86e9/apps/server/src/mcp/OrchestratorMcpService.ts),
  [sidebar](https://github.com/pingdotgg/t3code/blob/de7b5e05f6a95573f65c923727fe84542a5b86e9/apps/web/src/hooks/useSidebarProjectGroups.ts),
  [dependencies](https://github.com/pingdotgg/t3code/blob/de7b5e05f6a95573f65c923727fe84542a5b86e9/apps/server/package.json),
  [license](https://github.com/pingdotgg/t3code/blob/de7b5e05f6a95573f65c923727fe84542a5b86e9/LICENSE).
- **Anywh, Apache-2.0, `4f8aef7b5f0dc9cf0832e457c224dc09a9792a21`.**
  `RoomManager.roomStatus` backs `room_status` with the current room's
  worker identities, lifecycle and reports. `RoomToolHost.toolsFor` gates
  membership. The room bridge uses Node HTTP/HMAC for persistent agent
  credentials and the Codex adapter forwards app-server tools to the same
  service. The React `SessionList` groups recent, running and waiting
  sessions. Adapt the live membership/status projection. Keep ORQST's
  ephemeral session pool and omit historical messages and reports from peer
  context. Verified the root Apache-2.0 license and tree, with no root NOTICE.
  [Room tools](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/relay/src/session/roomTools.ts),
  [room manager](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/relay/src/session/roomManager.ts),
  [bridge](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/relay/src/bridges/roomBridge.ts),
  [sidebar](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/client/src/components/shell/SessionList.tsx),
  [license](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/LICENSE).
- **Tucano, Apache-2.0, `0501956d127699300209902e889f3e69a0948766`.**
  `routerPrompt` describes known agents and `parseRoute` resolves the
  router's model-selected targets against that roster. Keep ORQST's exact
  user-selected route and scope checks. The locally derived roster needs no
  routing model or new package. Verified the root Apache-2.0 license and tree,
  with no root NOTICE.
  [Router](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts),
  [dependencies](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/package.json),
  [license](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE).

The structured pilot previously exposed peers in the Studio snapshot and grant
picker but omitted them from provider inputs. The Core now captures a fresh,
bounded roster from owned structured sessions in the same workspace and Feature
when dispatching human and delegated turns. It includes session ID, untrusted
label, provider, lifecycle, busy flag, latest turn state and pending-approval
flag. A newer roster supersedes earlier observations. Codex receives a separate
text input and OpenCode receives a JSON preface on the prompt. The recipient
receives no peer conversation, workspace path or credential. A roster confers
no write authority. Only the existing exact, expiring, one-use grant permits
delegation. The Codex app-server's generated experimental schema permits
omitting `namespace` for a bare dynamic tool. Core accepts absent or null
and continues to deny named namespaces.

## Studio workflow and ownership

1. Launch the Apple Silicon macOS Tauri app with `ORQST_STRUCTURED_AGENTS=1`.
2. Open the Feature panel in an active, non-archived Feature in native Studio,
   then open **Structured agents** and select Codex. This uses the existing selected workspace and
   Feature metadata. Name a session and review its executable, workspace, SHA-256
   and read-only policy in the native sheet. The pilot expects the Apple Silicon
   0.169.0 native binary with the digest disclosed in the sheet. Codex uses its
   existing local configuration and login. ORQST performs no login or account
   read. The app-server starts only after native approval.
3. Compose a message and confirm it in the native sheet. The panel shows
   messages, completed and streaming items, tool and file activity, and approval
   requests. Command and file requests can receive an explicit one-shot decision
   when complete review details are available. Other requests with matching turn
   scope are decline-only. Cross-thread or uncorrelated server requests close the
   session. No session-wide, permission-amendment or automatic approvals exist.
4. Start a second session in the same Feature. Select the source, choose the
   worker and enter the exact task. Confirm the one-use grant, then review and
   send the prefilled message. The source must request the exact task and target
   via `orqst_delegate_task` within five minutes. The worker cannot delegate a
   delegated turn. A busy worker receives no queued turn. B's `turn/start`
   response, `turn/started` and `turn/completed` drive the corresponding
   states. Core sends the bounded worker answer as untrusted data in A's tool
   response. A's matching completed tool item is required to show **Result
   returned**. A's own completion is tracked separately.
5. **Interrupt turn** requests `turn/interrupt`. The response acknowledges the
   request. The later turn notification determines the outcome. **End session**
   gives an active turn a bounded opportunity to complete the interruption, then
   closes stdin and terminates the owned POSIX process group with escalation.
   Closing the panel or switching Features only changes the view. Normal
   application shutdown closes the private Node host and its managed sessions.

The default path is the existing terminal runtime. The flag enables a separate
Studio surface and fixed Node sidecar. The browser dashboard, observer HTTP/WS,
legacy MCP relay and Rust terminal Core have no pilot execution endpoint. The
private command capability belongs to the exact local Feature Webview. Native
focus, the active Feature and current document/presentation epoch are checked
before review and again before the one-shot apply. The host re-resolves Feature
metadata and the canonical workspace, verifies the executable digest again, and
compares the exact reviewed operation before acting. Only the native host can send
the prepare/apply envelope. The structured launch disables the CLI's MCP servers,
apps, plugins, hooks and multi-agent features through its launch overrides. Codex
reports the effective thread sandbox and human approval routing before admission.

## Verification and limits

```sh
pnpm --filter @orqst/core test
ORQST_STRUCTURED_REAL_CODEX=/absolute/path/to/codex pnpm --filter @orqst/core test
```

The default package tests use a labeled synthetic app-server. They exercise RPC
ordering and correlation, human approval gating and replay denial, exact same-Feature
one-use delegation, return evidence, interrupt versus process exit, EOF, and owned
process-group cleanup. The optional smoke uses the supplied executable with a
temporary home and project. It verifies the handshake, ephemeral read-only thread
and shutdown without authenticating or submitting a model turn.

The optional Codex run also creates two real app-server processes with a
disposable home and a synthetic loopback Responses endpoint. It verifies that
the peer roster reaches the model request, the registered dynamic tool dispatches
B's exact task, and A's continuation contains B's correlated result. It uses
no login or external inference. The mixed synthetic provider fixtures verify
both Codex → OpenCode → Codex and OpenCode → Codex → OpenCode.

The pilot keeps up to four sessions in memory and bounds turn duration, wire
traffic, displayed items and approvals. Content redaction is best-effort. Codex
still owns its local logs and configuration. No process adoption, thread resume,
persistence, cross-Feature routing, durable history or Claude support is
included. Cleanup covers the owned group during ordinary stop, transport loss and
app shutdown. A hard kill of the Node host or a descendant that leaves its process
group is outside the demonstrated cleanup guarantee.

### Next native build

1. Enable the pilot and open an active Feature in the native Studio. In **New
   terminal**, confirm that Codex 0.169.0 is selectable and opens. If the picker
   refuses it, record the localized reason.
2. In **Structured agents**, start Codex and OpenCode in that Feature. Try
   Cancel on a native sheet, then approve a fresh request. Send each agent a
   prompt asking it to identify its peer and check the session state in Studio.
3. Review a one-use grant for a short task with a recognizable answer and send
   the proposed source turn. Check B's accepted and completed turns, A's
   receipt of the worker answer and Studio's **Result returned**. Repeat with
   the providers reversed and confirm a consumed grant cannot be reused.
4. Switch to another Feature and verify the original sessions are excluded.
   End one owned session and verify it is absent from the next peer roster.
   After testing, verify owned cleanup in the isolated build.
5. To validate the separate PTY path, explicitly call `list_terminals` in two
   same-Feature MCP-capable PTYs, send a message from one and read it from the
   other. If a tool is absent, record the provider and MCP readiness evidence
   separately from PTY opening readiness.
