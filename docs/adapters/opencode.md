# OpenCode adapter contract

The passive [standalone launch review](../development/opencode-standalone-review.md)
now establishes the exact installed 2.2.5 private-server selector and an inspectable
candidate command. Native launch stays unavailable because credentials/sessions share
the database and startup can apply migrations. No observation capability changes.

## Status

**Contract only. Not implemented.**

- Package: `packages/adapters/opencode`
- Export: `opencodeDescriptor`
- `implemented: false`
- Every capability is `false`, including `remoteControl`.

The package contains no client, event subscription, parser, or normalization
logic. It exists so the dashboard can display OpenCode as a planned integration
and so a future implementation has a fixed contract.

```ts
export const opencodeDescriptor: AdapterDescriptor = {
  id: 'opencode',
  implemented: false,
  capabilities: {
    sessionDiscovery: false,
    realtimeEvents: false,
    messages: false,
    toolCalls: false,
    subagents: false,
    tokenUsage: false,
    taskResults: false,
    userIntervention: false,
    remoteControl: false,
  },
  evidence:
    'Contract only. See docs/adapters/opencode.md; no capability has been validated in ORQST.',
};
```

## Why it is not implemented

The master brief lists candidate mechanisms — APIs, event streams, sessions,
messages, permissions, and token usage — but ORQST has not validated a specific
OpenCode version, endpoint, event schema, or authentication model. No OpenCode
instance, API response, or event stream has been inspected for this repository.

The adapter must not be built from assumptions. In particular, an API that
exists for an OpenCode instance launched by another tool may not be reachable,
stable, or authorized for a passive observer.

## Approved future scope

The requirements below describe external observation mode and remain read-only.
Managed execution and structured delegation are approved future directions under
[ADRs 015–024](../architecture/decisions.md), with separate ownership, permission
and [lifecycle contracts](../api/lifecycle-contracts.md). These directions do not
implement the adapter, validate a provider version or enable any capability.
Provider-specific execution/resume support requires a separately approved phase.

## What an implementation must satisfy

A future OpenCode adapter must:

1. **Observe external sessions.** It must not require ORQST to launch OpenCode
   or own its lifecycle.
2. **Be read-only.** No prompts, approvals, permission grants, tool decisions,
   or process control.
3. **Produce protocol events.** Every output must validate against
   `eventSchema`, with machine, workspace, session, agent, correlation, and
   source references.
4. **Preserve source traceability.** For API/stream sources: endpoint or stream
   identifier, sequence or cursor, and a raw record reference or hash.
5. **Be idempotent.** Reconnects and replays must not duplicate events.
6. **Handle recovery.** Disconnects, backoff, cursor gaps, resync, partial
   records, malformed payloads, and missing fields.
7. **Use explicit evidence only.** No inferred parentage, completion, failure,
   or delegation.
8. **Apply privacy rules.** Redact common secrets, cap text, avoid raw logs and
   reasoning, never execute captured content.
9. **Declare capabilities honestly.** Keep them `false` until validated.
   `remoteControl` remains `false`.

## Investigation plan

Record answers with real evidence before implementing:

### Availability and transport

- Does a running OpenCode instance expose a local HTTP API, a WebSocket/SSE
  stream, or only on-disk state?
- Which versions expose it, on which host and port, and is it enabled by
  default?
- How does a passive observer authenticate or authorize without changing the
  user's workflow?
- Is the interface documented as stable, or internal and version-specific?

### Sessions and events

- How are sessions listed and identified?
- What event types exist for session start/update/end, turn start/end, tool
  start/end, errors, and interruptions?
- Is there a monotonic cursor or sequence for replay and gap detection?
- What happens on reconnect, and how is duplicate delivery avoided?

### Messages and tools

- What are the message roles and content shapes?
- Are tool calls and outputs correlated by a call ID?
- Is a final result explicit, or only the last assistant message?
- Are subagent sessions represented, and is there an explicit parent link?

### Tokens

- Which token fields exist: input, output, cached, total?
- Are they cumulative per session, per turn, or per response?
- Is a session-level snapshot available to avoid double counting?
- Is the model identifier exposed?

### Permissions and intervention

- How are permission requests represented?
- Can an observer detect a pending request without acting on it?
- Is there any documented control channel? Control is out of scope for the
  read-only MVP and requires a separate design.

## Capability evidence gate

To set a capability to `true`, the adapter page must record:

- the OpenCode version and date inspected;
- the real endpoint or event that proves the capability;
- the normalization mapping and test that covers it;
- at least one absence/malformed/disconnect case;
- the known limitations.

Until then, OpenCode must appear as planned, and no document may imply parity
with Codex.

## Privacy notes

OpenCode sessions may contain source code, shell output, file contents, and
secrets. A future adapter must:

- avoid copying raw logs, reasoning, account data, or environment blocks;
- redact common credential shapes before persistence;
- cap text length;
- treat all captured content as untrusted and render it as plain text;
- avoid persisting permission tokens or credentials.

## Non-goals

- launching OpenCode;
- controlling sessions or granting permissions;
- assuming an API exists because a newer version has one;
- claiming a capability from documentation alone;
- remote control.

## Managed-terminal research update — 2026-11-03

[Primary-source CLI research](managed-terminal-research.md) now records public
release metadata and documented TUI/structured interfaces. This is not a real
provider run, implemented managed adapter or capability validation. The existing
observation descriptor remains unchanged; external sessions stay read-only.

## Version-scoped interactive MCP configuration — 2026-11-03

The separate managed integration now has a pure configuration builder,
`opencodeInteractiveMcpConfiguration`, in Core's `terminal/provider-mcp-config.ts`.
It is **not** a launch factory or observer client. The descriptor above and every
observation capability remain false; no server is started, scanned or attached.

Passive canonical-path/hash inspection found multiple local launch paths with the
same native binary bytes. Installed package metadata labels the binary `2.2.5`:
`abe4d88594bffb12b364375b8a6732d2d1f7a977195ed1a35c5c76f8e89c9e0e`.
Embedded strings contain `OPENCODE_CONFIG_CONTENT` and local-MCP configuration
descriptions for command, environment, enablement and request timeout. The installed
description gives **5000 ms** as the default, while the current
[official MCP documentation](https://opencode.ai/docs/mcp-servers/) gives 30000 ms
for connection/tool discovery. These are distinct evidence sources; no runtime
timeout was measured. The candidate explicitly sets 125000 ms and keeps its actual
behavior unvalidated. Embedded tool-exposure descriptions also mention Code Mode;
direct tool availability/parity with Codex is not assumed.

The [official configuration reference](https://opencode.ai/docs/config/) describes
merged inline `OPENCODE_CONFIG_CONTENT` overrides, including native/project/managed
sources. The builder generates that document with a randomly named local MCP server,
`command: [node, relay]`, endpoint-path environment and explicit timeout. It adds no
CLI configuration flag, initial prompt, server mode, resume/session attachment or
automatic approval. Native MCPs/plugins/hooks and managed policy are not disabled.

Strict input pins the reviewed version/hash label and rejects extra environment,
credentials, commands and identity fields. It supplies no HOME/XDG overrides:
moving the native data root could also move provider authentication and sessions.
A future environment composition must preserve explicitly validated identity
selectors without inheriting arbitrary secret variables. No credential file,
provider list, Keychain, `.env` or external session was read for this work.

Every result remains `execution: "blocked"`, `providerAcceptance: "not_run"`.
The builder cannot verify the caller's binary hash, native login or effective
merged configuration. Per-instance session/data separation, permissions, auth
refresh, exact protocol/timeout/tool exposure, focus and idle-worker delivery remain
acceptance gates. No OpenCode Desktop launch profile or provisioning command exists.
Every listed blocker is mandatory for any future launch composition; generating
a configuration document cannot bypass those gates.

## Installed schema correction and launch gate — 2026-11-03

Further passive embedded-code inspection found `Mcp.LocalConfig` in installed 2.2.5
uses `disabled`, `codemode`, `protocol` and an object timeout (`startup`, `catalog`,
`execution`). The builder now follows that installed shape rather than the earlier
`enabled`/numeric-timeout candidate. It remains blocked and non-executable. Native
TUI/service attachment, fresh session routing, server exposure and descendant
ownership remain unproved. See [provider evidence and limits](../development/claude-interactive-terminal.md#opencode-stays-blocked).
