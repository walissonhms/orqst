# Adapter capability model

## Current capabilities and future managed operations

The matrix and booleans below describe the implemented observation adapters.
Phase 0 does not enable any flag. Future managed execution is approved direction,
with separate versioned [lifecycle/capability contracts](../api/lifecycle-contracts.md).
Observation and managed modes remain distinct; discovery alone grants no control.
Support, authorization and temporary availability must be represented separately.
Provider documentation is design input, not evidence that ORQST implemented or
validated the operation. Each implementation phase needs approval.

ORQST uses a capability model so the dashboard and documentation never imply
more than a provider integration actually provides. A capability is a claim
about observed, validated behavior, not a wish or a roadmap item.

## Capabilities

| Capability         | Meaning                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `sessionDiscovery` | ORQST can find sessions that were started outside ORQST, without the user launching them through ORQST. |
| `realtimeEvents`   | New activity is observed and delivered while the session is still running.                              |
| `messages`         | User and assistant message text can be captured.                                                        |
| `toolCalls`        | Tool invocations and their outputs can be captured.                                                     |
| `subagents`        | An explicit, source-backed parent/child session relationship can be established.                        |
| `tokenUsage`       | Token counts can be captured with enough context to avoid double counting.                              |
| `taskResults`      | A final or delivered result can be captured from an explicit record.                                    |
| `userIntervention` | An explicit request for user input can be detected and surfaced.                                        |
| `remoteControl`    | ORQST can send input, approval, or control into the session.                                            |

`remoteControl` is `false` for every adapter. ORQST has no remote control
implementation and no plan to add one without a separate validated design.

## Evidence rule

A capability may be set to `true` only when all of the following are recorded:

1. the provider version or source format that was inspected;
2. the real record or event that proves the capability;
3. the normalization path that consumes it;
4. a test or validation note showing the path works, including a failure or
   absence case;
5. the limitations of the evidence (for example, "only direct
   `request_user_input` calls", not every possible prompt).

Documentation claims, provider marketing, and schema guesses are not evidence.
If a capability cannot be established reliably, it stays `false` and the
dashboard shows the integration as planned.

## Current matrix

| Capability         | Codex   | Claude Code | OpenCode | Google Antigravity |
| ------------------ | ------- | ----------- | -------- | ------------------ |
| `implemented`      | `true`  | `false`     | `false`  | `true`             |
| `sessionDiscovery` | `true`  | `false`     | `false`  | `true`             |
| `realtimeEvents`   | `true`  | `false`     | `false`  | `true`             |
| `messages`         | `true`  | `false`     | `false`  | `true`             |
| `toolCalls`        | `true`  | `false`     | `false`  | `true`             |
| `subagents`        | `true`  | `false`     | `false`  | `false`            |
| `tokenUsage`       | `true`  | `false`     | `false`  | `false`            |
| `taskResults`      | `true`  | `false`     | `false`  | `true`             |
| `userIntervention` | `false` | `false`     | `false`  | `false`            |
| `remoteControl`    | `false` | `false`     | `false`  | `false`            |

The descriptors live in:

- `packages/adapters/codex/src/index.ts`
- `packages/adapters/claude/src/index.ts`
- `packages/adapters/opencode/src/index.ts`
- `packages/adapters/antigravity/src/index.ts`

## How to read the Codex claims

- `subagents: true` means ORQST honors an explicit `parent_thread_id` or
  `source.subagent.thread_spawn.parent_thread_id`. It does **not** infer
  parentage from message text, timing, or agent paths.
- `userIntervention: false` means no direct request has been verified in the real local sample. Direct `request_user_input` mapping is implemented and fixture-tested, but this does not justify declaring provider support or the ability to answer it.
- `taskResults: true` means a captured final message or explicit result record
  can be shown. It does **not** mean the task succeeded.
- `tokenUsage: true` means cumulative snapshots are captured with explicit
  semantics. It does **not** mean cost, budget, quota, or context-window data
  exists.
- `realtimeEvents: true` means new file activity is observed while the session
  runs. Imported history is replayed but is not treated as live.

## How to read the Google Antigravity claims

- `sessionDiscovery`, `realtimeEvents`, `messages`, `toolCalls`, and
  `taskResults` are backed by local `agy` (`1.5.10` language server) transcripts
  at `brain/<sessionId>/.system_generated/logs/transcript_full.jsonl` (fallback
  `transcript.jsonl`) and workspace metadata in
  `cache/conversation_metadata.json`. See [antigravity.md](antigravity.md).
- `tokenUsage: false` means on-disk `PLANNER_RESPONSE` records expose only
  per-response uncached `input_tokens`, `output_tokens`, and `cache_read_tokens`
  without an explicit session-cumulative snapshot or plan/quota record. ORQST
  does not sum per-step counters into synthetic cumulative totals.
- `subagents: false` means the JSONL transcript and metadata cache carry no
  explicit parent session identifier.
- `userIntervention: false` means `ask_question` intervention mapping is
  fixture-tested only; no `ask_question` record appeared in the local sample.

## Adding an adapter

1. Read [CONTRIBUTING.md](../../CONTRIBUTING.md) and the provider-specific contract page.
2. Investigate the real source format on a real installation. Record version,
   date, and sample shapes without committing captured user content.
3. Implement discovery and normalization behind the shared protocol.
4. Add synthetic tests for normal, malformed, missing, and duplicate records.
5. Set a capability to `true` only with evidence. Keep it `false` otherwise.
6. Update the matrix, the adapter page, and the capabilities documented in `README.md`.
7. Do not add remote control as a side effect of an adapter.
