# Owned MCP pair communication projection — 2026-11-05

## Reference inspection and decision

- Anywh commit `546f189c04415c3c5af5f40e3931a0a90b9aba31`:
  [RoomBridge / roomOwnerOf](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/bridges/roomBridge.ts),
  [McpChoiceBridge](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/bridges/mcpBridge.ts),
  and the previously inspected architecture, agent-host and runtimes documents.
  Inspected exact source with `git show`, plus Apache-2.0 LICENSE and absent root
  NOTICE. These bridges depend on Node HTTP/crypto and internal room/choice hosts;
  room ownership derives from a key and choices return without proving a worker
  result. They do not provide ORQST's epoch/instance/native-grant/Feature evidence.
  **Keep existing ORQST broker and filesystem safety helpers.** No code copied.
- Tucano commit `0501956d127699300209902e889f3e69a0948766`:
  [router.ts / parseRoute / route](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts)
  and [Apache-2.0 LICENSE](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE)
  rechecked at permanent raw-source URLs. Its engine/model and channel/message
  dependencies select speakers by handles and prose. This cannot prove an owned
  terminal-to-terminal exchange. **Do not use** for event projection. No code or
  asset incorporated; no dependency or NOTICE change.
- Existing ORQST at `1401ee8ba2b746d38d0c612aa12594ddf4c16d89`:
  `InteractiveMcpSession`, `McpTaskBroker`, `withTerminalPreferences`,
  `terminalDirectory` / `terminalFile`, and `TauriFeatureService`. The PTY pair
  broker had only volatile state. `CommunicationJournal` belongs to the separate
  structured-agents composition; it has no canonical binding to this PTY pair.
  **Adapt narrowly:** metadata-only audit callbacks at the existing broker's
  actual delivered/result-accepted transitions. Do not import the separate host's
  messages, reconstruct a second router, or add a delivery route for the composer.

## Evidence boundary

The callback is installed inside the owned Core when the reviewed MCP pair is
created. At grant preparation it captures both exact launch instance IDs and one
active Feature/revision containing both stable terminal IDs. Every event rechecks
that membership/revision. Queuing a task, an unsupported composer attempt, a grant
alone, terminal output, inactivity, disconnect and process exit emit no event.

`delegation` means the broker accepted the worker's matching `wait_task` and handed
it the granted task; it does not assert a provider processed the response.
`result` means that worker submitted a result for the exact delivered task ID and
its source-side completion promise was resolved. It is not proof of project/task
success beyond that result submission.

The private audit retains epoch, grant/task/instance IDs, Feature/revision,
terminal IDs, kind, timestamp and deterministic event ID, without task/result
bodies. It uses an exclusive epoch file, mode 0600 under a 0700 directory, pinned
inode/device, no-follow opens, single-link checks, complete writes and fsync.
A replaced, modified, linked, unsafe, partial or over-budget audit is unavailable;
accepted MCP operations are neither retried nor cancelled by display failure.
The current producer verifies disk bytes against its own committed metadata before
projection. Old epoch files are preserved but never adopted after restart.

The existing pair admits at most 16 grants, so its audit contains at most 32
records, read under a 64 KiB budget. The public schema remains capped at 50.
Only the currently selected Feature's current members/owned slots are projected;
no Feature or split membership yields an empty feed. No configured MCP pair or an
unsafe/unavailable journal omits the field. This is not N-member orchestration,
cross-Feature delivery or provider/native acceptance.
