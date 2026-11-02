# OpenCode adapter contract

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
