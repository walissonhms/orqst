# Structured Codex Studio pilot

## Reference research

| Candidate                     | Pinned source and files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Decision                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex CLI 0.169.0, Apache-2.0 | [Release source](https://github.com/openai/codex/tree/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server), [license](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/LICENSE). The installed CLI generated both TypeScript and JSON Schema with `app-server generate-ts --experimental` and `app-server generate-json-schema --experimental`. Inspected the initialize handshake, `ThreadStartParams`, `ThreadStartResponse`, `TurnStartParams`, `TurnStatus`, `ThreadItem`, `DynamicToolCallParams` and the command/file approval and server request schemas. | Implement against the wire contract. Generated files stay outside the checkout.                                                                                                                                                      |
| T3 Code, MIT                  | [Pinned source and license](https://github.com/pingdotgg/t3code/tree/de7b5e05f6a95573f65c923727fe84542a5b86e9). `apps/server/src/provider/CodexProvider.ts`, `Drivers/CodexDriver.ts`, `Drivers/CodexManagedProvider.ts`, and `packages/effect-codex-app-server/src/{client.ts,rpc.ts,_internal/stdio.ts}`. The private package uses Effect for the typed request and stream lifecycle.                                                                                                                                                                                                                | Adapt the app-server session model. Keep ORQST's bounded channel, native authorization and package stack.                                                                                                                            |
| Anywh, Apache-2.0             | [Pinned source and license](https://github.com/anywh-sh/anywh/tree/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21). `relay/src/runtimes/defs/{codex.ts,codexDriver.ts}`, `streams/codexAppServer.ts`, `transports/codexDaemon.ts`, and `relay/src/agentHost/codexPool.ts`. A per-session daemon separates request acceptance from turn completion and uses explicit interruption. Its relay/agent-host also supports recovery across relay lifetimes.                                                                                                                                                        | Adapt lifecycle and event correlation. Keep the ORQST private native IPC boundary and use ephemeral threads for the pilot.                                                                                                           |
| Tucano, Apache-2.0            | [Pinned source and license](https://github.com/eduwxyz/tucano/tree/0501956d127699300209902e889f3e69a0948766). `src/core/engines/codex.ts` and `src/core/router.ts`, with the existing ORQST audit as context.                                                                                                                                                                                                                                                                                                                                                                                          | Keep the ORQST dynamic tool and exact user grant. Tucano's ephemeral exec/gateway model has a different turn and routing contract.                                                                                                   |
| ORQST                         | `packages/core/src/managed-codex/{channel,adapter,dynamic-tools,runtime,native-host}.ts`. Historical commits `517dd63e57dd000b62dddd2ef9f7dbf9d108c626` and `b3a1bf24dc89f154fd79b98bec612a9f8a06880b` are available locally. The current tree already contains the bounded RPC channel, structured thread lifecycle, and a peer delegation tool.                                                                                                                                                                                                                                                      | Reuse the channel, dynamic tool and correlation pattern. The existing adapter serves a signed terminal-pair workflow and leaves native approvals unresolved. Add an opt-in conversation projection and approval handling for Studio. |

No upstream source, assets or dependencies were incorporated.

## Studio workflow and ownership

1. Launch the Apple Silicon macOS Tauri app with `ORQST_STRUCTURED_AGENTS=1`.
2. Open the Feature panel in an active, non-archived Feature in native Studio,
   then open **Structured Codex**. This uses the existing selected workspace and
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

The pilot keeps up to four sessions in memory and bounds turn duration, wire
traffic, displayed items and approvals. Content redaction is best-effort. Codex
still owns its local logs and configuration. No process adoption, thread resume,
persistence, cross-Feature routing, durable history or Claude/OpenCode support is
included. Cleanup covers the owned group during ordinary stop, transport loss and
app shutdown. A hard kill of the Node host or a descendant that leaves its process
group is outside the demonstrated cleanup guarantee.

Native acceptance still requires packaging and opening an isolated Tauri build,
checking the default and enabled surfaces, trying Cancel and Approve on the real
AppKit sheet, sending authenticated turns, verifying real-model A → B → A and
checking lifecycle behavior when switching Features and quitting. The credential-free
CLI smoke and the synthetic protocol tests cover different parts of that workflow.
