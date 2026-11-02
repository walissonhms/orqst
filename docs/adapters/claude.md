# Claude Code adapter contract

## Status

**Contract only. Not implemented.**

- Package: `packages/adapters/claude`
- Export: `claudeDescriptor`
- `implemented: false`
- Every capability is `false`, including `remoteControl`.

The package contains no discovery, parser, watcher, HTTP client, or event
emitter. It exists so the dashboard can display Claude Code as a planned
integration and so a future implementation has a fixed contract to satisfy.

```ts
export const claudeDescriptor: AdapterDescriptor = {
  id: 'claude',
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
    'Contract only. See docs/adapters/claude.md; no capability has been validated in ORQST.',
};
```

## Why it is not implemented

The master brief lists candidate mechanisms — hooks, session records, subagent
lifecycle events, and tool execution events — but ORQST has not validated any
of them against a real Claude Code installation. The project rule is that a
capability is `true` only after real evidence and a tested normalization path.

No Claude Code session files, hook payloads, or event streams have been
inspected for this repository. Nothing in this document should be read as a
claim that Claude Code exposes a particular field, file, or lifecycle event.

## What an implementation must satisfy

A future Claude adapter must:

1. **Observe sessions started outside ORQST.** Requiring the user to launch
   Claude through ORQST would violate the product model.
2. **Work read-only.** No writing to session files, no injected prompts, no
   approvals, no process control.
3. **Produce protocol events.** Every output must validate against
   `eventSchema` and carry file/stream source references, timestamps, machine,
   workspace, session, agent, and correlation identifiers.
4. **Keep source traceability.** For file-based sources: path, byte offset,
   line, and content hash. For stream-based sources: a stable source identifier,
   sequence, and raw record reference.
5. **Be idempotent.** Re-reading or reconnecting must not duplicate events.
6. **Handle recovery.** Restart, partial writes, truncation, rotation, stream
   disconnects, duplicate delivery, malformed records, and missing fields.
7. **Use explicit evidence only.** No inferred parentage, completion, failure,
   or delegation from prose or inactivity.
8. **Apply the same privacy rules.** Redact common secrets, cap text, avoid raw
   logs and reasoning, and never execute captured content.
9. **Declare capabilities honestly.** A capability stays `false` until
   validated. `remoteControl` remains `false`.

## Investigation plan

Before writing code, record answers to these questions with real evidence:

### Discovery

- Where does Claude Code store session or transcript data on macOS?
- Is the format stable across versions, or internal and undocumented?
- Can sessions be discovered without changing the user's workflow?
- Are subagent sessions stored separately? Is there an explicit parent link?

### Hooks and lifecycle

- Are hooks opt-in per project or user? If ORQST requires hook configuration,
  does that violate the "no workflow change" requirement, or can it be optional?
- Which lifecycle moments are observable: session start, turn start, turn end,
  tool start, tool end, subagent start/end, interruption, failure?
- What identifiers correlate a hook payload to a session, turn, and tool call?

### Messages and tools

- What are the message roles and content shapes?
- Are tool inputs and outputs available, and are they correlated by a call ID?
- Is there a reliable final-result record, or only the last assistant message?

### Tokens

- Does the source expose input, output, cached, and total tokens?
- Are values cumulative, per turn, or per response?
- Is there a session-level snapshot that avoids double counting?
- Is the model identifier available?

### Intervention and control

- Is a request for user input explicitly recorded?
- Can ORQST detect it without reading prose?
- Is there any documented control channel? If so, it is out of scope for the
  read-only MVP and requires a separate design.

## Capability evidence gate

To turn a capability on, the adapter page must record:

- the Claude Code version and date inspected;
- the real record shape that proves the capability;
- the normalization mapping and test that covers it;
- at least one absence/malformed case;
- the known limitations.

Until then, the dashboard must show Claude Code as planned, and no document may
imply parity with Codex.

## Privacy notes

Claude Code transcripts can contain source code, shell output, file contents,
and secrets. A future adapter must follow the same rules as Codex:

- read-only source access;
- path containment and symlink rejection for file sources;
- best-effort redaction before persistence;
- no raw logs, reasoning, account data, or environment blocks;
- plain-text rendering only.

## Non-goals

- launching Claude Code;
- configuring hooks automatically without the user's knowledge;
- sending answers or approvals;
- remote control;
- claiming a capability from documentation alone.
