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

## Approved future scope

The requirements below describe external observation mode and remain read-only.
Managed execution and structured delegation are approved future directions under
[ADRs 015–024](../architecture/decisions.md), with separate ownership, permission
and [lifecycle contracts](../api/lifecycle-contracts.md). These directions do not
implement the adapter, validate a provider version or enable any capability.
Provider-specific execution/resume support requires a separately approved phase.

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

## Managed-terminal research update — 2026-11-03

[Primary-source CLI research](managed-terminal-research.md) now records public
release metadata and documented TUI/structured interfaces. This is not a real
provider run, implemented managed adapter or capability validation. The existing
observation descriptor remains unchanged; external sessions stay read-only.

## Version-scoped interactive MCP configuration — 2026-11-03

The separate managed integration now has a pure configuration builder,
`claudeInteractiveMcpConfiguration`, in Core's `terminal/provider-mcp-config.ts`.
It is **not** a launch factory, observer adapter, native-login test or permission
grant. The descriptor above and every observation capability remain false.

Passive inspection resolved the local native installation labeled `2.1.178` and
hashed its canonical executable:
`473495d0c15d6616cd0870480db5eb8aa0402fe4f8ead3277a1b521e94110309`.
Embedded CLI help strings confirm `--mcp-config` accepts inline JSON,
`--strict-mcp-config` selects supplied MCP configuration, and `--session-id` accepts
a UUID. The binary also contains `MCP_TIMEOUT`/`MCP_TOOL_TIMEOUT` names. This is
offline interface evidence, not output from executing `--help`/`--version`, a
handshake or evidence of runtime timeout semantics.

The [official CLI reference](https://code.claude.com/docs/en/cli-reference) and
[MCP reference](https://code.claude.com/docs/en/mcp) support that configuration
shape. The current MCP reference also documents a project-approval startup issue
before 2.1.246 even with strict configuration. The installed 2.1.178 cannot inherit
that later fix or newer client-runtime behavior by assumption. The builder keeps
this explicit blocker; preview channels/tasks/reconnection are not selected.
Unlike the Codex merge, strict selection intentionally excludes the user's other
MCP definitions. A future native launch must disclose and obtain acknowledgment
of that change; it must not silently call this behavior equivalent to native MCP
reuse. Strict selection does not isolate native hooks, plugins or managed policy.

The strict input requires the exact reviewed version/hash label, a fresh caller
session UUID and a bounded relay/endpoint descriptor. Unknown versions/hashes,
extra credentials, argv and identity fields are rejected. It generates only the
reviewed MCP/session argv and timeout override candidates. It neither substitutes
HOME/CLAUDE_CONFIG_DIR nor selects another Keychain/login identity, reads auth,
writes native config, grants tools, supplies a prompt or resumes a session.

Every result remains `execution: "blocked"`, `providerAcceptance: "not_run"`.
The builder cannot establish that a supplied UUID is new, rehash a binary at
dispatch or prove login preservation; a future native composition must do those
checks. Reusing an existing `--session-id` has not been validated; collision and
resume behavior must be checked before a launch is admitted. Every listed blocker
is a future launch gate, not advisory metadata that a composition may ignore.
Native configuration/hooks/plugins, shared session writes, approval UI,
relay protocol revision and idle-worker delivery still require acceptance. There
is no Claude Desktop launch profile or provisioning command in this delivery.

## Native Desktop launch opt-in — 2026-11-03

A separate [owned native PTY launch path](../development/claude-interactive-terminal.md)
now admits the exact installed 2.1.178 binary after explicit shared-state and native
start authorization. A fresh UUID and one dispatch per manifest replace the earlier
no-factory/session-collision gates. Optional strict MCP excludes other definitions;
project/enterprise approval can still block startup. This has synthetic process
evidence only, with no native login, MCP or inference acceptance. The external
observation descriptor above remains entirely false.
