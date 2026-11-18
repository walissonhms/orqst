# Google Antigravity CLI adapter

## Managed CLI updates

Studio can verify a signed replacement at the reviewed canonical `agy`
path with Google Team ID `EQHXZ8M8AV` and required notarization. The
managed terminal still uses the native TUI with no per-session ORQST MCP.
See the [installation and update evidence](../development/cli-signed-updates.md#provider-evidence).

The Google Antigravity adapter passively observes session transcripts produced by
the Antigravity CLI (`agy`) outside ORQST. It never launches `agy`, never sends
input or approvals, never opens live SQLite conversation databases or credential
files, and never modifies observed files.

- Package: `packages/adapters/antigravity`
- Entry points: `src/index.ts` (discovery and bounded reading),
  `src/normalize.ts` (record and workspace metadata mapping)
- Descriptor: `antigravityDescriptor` in `src/index.ts`

## Inspected installation and on-disk layout (2026-11-18)

Passive inspection on macOS (`arm64`) examined:

- Binary: `/Users/<user>/.local/bin/agy` (`224,809,248` bytes, Mach-O 64-bit
  executable `arm64`, SHA-256
  `780ee763a9938a37b45c7f9d6ae31747d7c574358fd10c64d3a1cdc36faf2798`), logging
  embedded language server version `1.5.10`.
- Data directory: `~/.gemini/antigravity-cli` (configurable in ORQST via
  `ORQST_ANTIGRAVITY_HOME`).

Observed files relevant to external session observation:

| Relative path                                                    | Observed size range | Format and role                                                                                             | Observer action                                           |
| ---------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `brain/<sessionId>/.system_generated/logs/transcript_full.jsonl` | 815 B – 376 KiB     | Untruncated newline-delimited JSON step records (`step_index`, `source`, `type`, `status`, `created_at`, …) | Read-only (`O_RDONLY \| O_NOFOLLOW`), preferred           |
| `brain/<sessionId>/.system_generated/logs/transcript.jsonl`      | 815 B – 94 KiB      | Compact JSONL step records with optional `truncated_fields`                                                 | Read-only fallback when `transcript_full.jsonl` is absent |
| `cache/conversation_metadata.json`                               | ~6.5 KiB            | JSON map of `projectId -> sessionId -> summary` (`ID`, `AgentName`, `UpdatedAt`, `WorkspaceURIs`)           | Read-only bounded metadata lookup (≤ 4 MiB)               |
| `conversation_summaries.db`, `conversations/<sessionId>.db`      | 53 KiB – 28 MiB WAL | Live SQLite WAL state owned by `agy` (protobuf blobs and FTS index)                                         | Never opened (avoids WAL/SHM locking)                     |
| `settings.json`, `mcp_config.json`, `antigravity-oauth-token`    | 191 B – 2.6 KiB     | User settings, MCP configuration, and keychainless OAuth token                                              | Never opened                                              |
| `history.jsonl`, `annotations/*.pbtxt`, `implicit/*.pb`          | 23 B – 4.5 KiB      | Prompt/slash-command input history and internal protobuf state                                              | Never opened                                              |

## Reference review (`AGENTS.md` §13)

| Reference candidate                               | Pinned source and license                                                                                                                                                                                                                                                                                                                                                                                                           | Findings                                                                                                                                                                                                                                          | Decision                                                                                                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anywh (`TranscriptIndex` and runtime definitions) | [`anywh-sh/anywh` @ `4f8aef7b5f0dc9cf0832457c224dc09a9792a21`](https://github.com/anywh-sh/anywh/tree/4f8aef7b5f0dc9cf0832457c224dc09a9792a21), [`relay/src/planUsage/transcriptIndex.ts`](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832457c224dc09a9792a21/relay/src/planUsage/transcriptIndex.ts), [`LICENSE`](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832457c224dc09a9792a21/LICENSE) (Apache-2.0) | Contains runtimes for `acp`, `claude`, `codex`, and `kimi` only; `TranscriptIndex` caches Claude `~/.claude/projects/**/*.jsonl` modification times without byte checkpoints, `O_NOFOLLOW`, or Antigravity support.                               | Keep ORQST's checkpointed JSONL observer pattern (`packages/adapters/codex`); no Anywh code copied.                                                              |
| Tucano (`antigravityEngine`, `antigravityParser`) | [`eduwxyz/tucano` @ `4522704ecdcb2d51d7ad4ea002375dcfe8d447be`](https://github.com/eduwxyz/tucano/tree/4522704ecdcb2d51d7ad4ea002375dcfe8d447be), [`src/core/engines/antigravity.ts`](https://github.com/eduwxyz/tucano/blob/4522704ecdcb2d51d7ad4ea002375dcfe8d447be/src/core/engines/antigravity.ts), [`LICENSE`](https://github.com/eduwxyz/tucano/blob/4522704ecdcb2d51d7ad4ea002375dcfe8d447be/LICENSE) (Apache-2.0)           | Spawns owned headless turns (`agy --output-format stream-json --input-format stream-json`) in disposable `HOME` directories and parses stdout `stream-json` events (`init`, `step_update`, `result`), not external on-disk `brain/*` transcripts. | Do not use for observation: launching `agy` violates ORQST's read-only observer boundary, and stdout `stream-json` differs from on-disk `transcript_full.jsonl`. |
| Overclock                                         | `https://overclock.sh`                                                                                                                                                                                                                                                                                                                                                                                                              | Workspace/pane UX reference; no compatible public source repository for an Antigravity read-only transcript observer.                                                                                                                             | Do not use.                                                                                                                                                      |

## Source location and discovery

The observed root is resolved from `ORQST_ANTIGRAVITY_HOME`. If unset:

```
~/.gemini/antigravity-cli
```

Missing roots or missing `brain/` subdirectories are non-fatal (`ENOENT` leaves
diagnostics error-free with zero discovered files).

Each scan:

1. Resolves the canonical root with `realpath`.
2. Optionally reads `cache/conversation_metadata.json` if `cache/` and the file
   are non-symlink entries whose canonical paths remain inside the canonical
   root and whose size is at most 4 MiB.
3. Walks `brain/<sessionId>/.system_generated/logs/`, verifying at every segment
   with `lstat` and `realpath` that no symlink is traversed and every directory
   stays inside the canonical root.
4. Selects `transcript_full.jsonl` when present as a regular file, falling back
   to `transcript.jsonl` only when `transcript_full.jsonl` is absent for that
   session.
5. Sorts selected paths deterministically and reads each file within an 8 MiB
   per-file, per-scan budget using `O_RDONLY | O_NOFOLLOW`, 128 KiB chunks, a
   2 MiB maximum line length (`MAX_LINE`), an unfinished oversized-line discard
   path, `dev:ino` identity tracking, and a 64-byte SHA-256 checkpoint anchor.

Discovery runs via both a `chokidar` watcher (`ignoreInitial: true`,
`followSymlinks: false`, depth 4, restricted to `brain/**` and
`cache/conversation_metadata.json`) and periodic polling every `ORQST_POLL_MS`
milliseconds.

## Normalization mapping

Session identity comes from the `brain/<sessionId>/...` path segment. Working
directory (`cwd`) comes from `summary.WorkspaceURIs[0]` (`file://` URI) in
`cache/conversation_metadata.json` when available; otherwise `workspaceId` falls
back to `stableId('workspace', 'unknown:' + sessionId)`. If metadata arrives
after the transcript file has already reached EOF, a deterministic
`session.updated` event sourced from `cache/conversation_metadata.json` updates
`cwd` and `agentName`.

| Source `type`       | `status` condition                              | Normalized event(s)                                                                                                                                                                          | Notes                                                                                                  |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| First valid step    | any                                             | `session.started` (`status: unknown`)                                                                                                                                                        | Emitted once per session before the step's own event(s)                                                |
| `USER_INPUT`        | any                                             | `agent.started` (`status: running`), `agent.message` (`role: user`)                                                                                                                          | Starts deterministic `turn-<step_index>` and redacts/caps `content`                                    |
| `SYSTEM_MESSAGE`    | any                                             | `agent.started` (`status: running`)                                                                                                                                                          | Reactive wakeup / turn continuation; raw system prompt/notification text is not persisted              |
| `PLANNER_RESPONSE`  | `model` present                                 | `session.updated` (`model`)                                                                                                                                                                  | Updates session model and compact model analytics evidence                                             |
| `PLANNER_RESPONSE`  | `DONE` with non-empty `tool_calls`              | optional `agent.message` (`commentary`), plus per-call `agent.tool.started` (`status: running`) or `agent.intervention.required` (`status: waiting_for_user` when `name === 'ask_question'`) | Queues deterministic `callId`s for subsequent `GENERIC` tool result steps; `thinking` is omitted       |
| `PLANNER_RESPONSE`  | `DONE` with empty/absent `tool_calls`           | optional `agent.message` (`final_answer`), `agent.completed` (`status: completed`, `result`)                                                                                                 | Marks the latest observed turn completed                                                               |
| `PLANNER_RESPONSE`  | `RUNNING` / `GENERATING` / `PENDING` / `QUEUED` | `agent.updated` (`status: running`)                                                                                                                                                          | Explicit in-progress step state                                                                        |
| `PLANNER_RESPONSE`  | `WAITING`                                       | `agent.intervention.required` (`status: waiting_for_user`)                                                                                                                                   | Explicit step wait state                                                                               |
| `PLANNER_RESPONSE`  | `CANCELED` / `INTERRUPTED` / `HALTED`           | `agent.updated` (`status: interrupted`)                                                                                                                                                      | Explicit interruption state                                                                            |
| `PLANNER_RESPONSE`  | `ERROR`                                         | `agent.failed` (`status: failed`, `text`)                                                                                                                                                    | Explicit planner step failure                                                                          |
| `GENERIC` (`MODEL`) | `DONE` or `ERROR`                               | `agent.tool.completed` (`status: running`, `role: tool`)                                                                                                                                     | Correlated to queued `callId`; tool-level `ERROR` returns output to the model without failing the turn |
| `GENERIC` (`MODEL`) | `RUNNING` / `GENERATING` / `PENDING` / `QUEUED` | `agent.updated` (`status: running`)                                                                                                                                                          | Background/in-flight tool execution                                                                    |
| `GENERIC` (`MODEL`) | `CANCELED` / `INTERRUPTED` / `HALTED`           | `agent.updated` (`status: interrupted`)                                                                                                                                                      | Interrupted tool execution                                                                             |
| `ERROR_MESSAGE`     | any                                             | `agent.failed` (`status: failed`, `text`)                                                                                                                                                    | Explicit top-level error step                                                                          |
| `ASK_QUESTION`      | `WAITING` / `RUNNING` / `PENDING`               | `agent.intervention.required` (`status: waiting_for_user`)                                                                                                                                   | Direct question step compatibility mapping                                                             |

## Token accounting and plan/quota limitations

On-disk `PLANNER_RESPONSE` records contain `input_tokens`, `output_tokens`, and
`cache_read_tokens` for each individual model response, **not** a cumulative
session snapshot:

- Local empirical inspection confirmed per-step values where `cache_read_tokens`
  exceeds `input_tokens` (for example: step 1 `input_tokens: 14326`,
  `output_tokens: 561`, `cache_read_tokens: 0`; step 8 `input_tokens: 16202`,
  `output_tokens: 601`, `cache_read_tokens: 14327`; step 12
  `input_tokens: 2489`, `output_tokens: 674`, `cache_read_tokens: 29726`).
  `input_tokens` in the JSONL step record represents uncached prompt tokens for
  that single call, and `cache_write_tokens` / `thinking_output_tokens` are not
  written to `transcript_full.jsonl`.
- No cumulative session token snapshot, subscription plan tier, or rate-limit /
  quota window record exists in `transcript_full.jsonl`, `transcript.jsonl`, or
  `cache/conversation_metadata.json`.
- Per ORQST's token integrity rules (`AGENTS.md` §5), the adapter does **not**
  sum incremental response counters into synthetic session snapshots.
  `antigravityDescriptor.capabilities.tokenUsage` remains `false`,
  `SessionView.usageRecorded` remains `false`, and Model Analytics records
  observed Antigravity models with `usage: null` and `usage_not_reported`.

## Other known limitations

- **Subagent parentage (`subagents: false`).** `transcript_full.jsonl` and
  `cache/conversation_metadata.json` contain no explicit `parentSessionId`
  field. `invoke_subagent` tool calls embed subagent identifiers in prose/tool
  text, which ORQST never parses to infer relationships.
- **User intervention (`userIntervention: false`).** Direct `ask_question` tool
  calls and `WAITING` steps map to `agent.intervention.required` in synthetic
  tests, but no `ask_question` record occurred in the local real sample.
- **Secondary Codex-only endpoints.** `/api/sessions/:id/metrics`,
  `/api/sessions/:id/model-history`, `/api/artifacts/extract`, and the Codex
  paired-tool drawer remain scoped to `codex` and return explicit
  `unsupported_adapter` responses for Antigravity sessions.

## Validation

1. **Implemented in code and synthetic tests:** `tests/antigravity-normalizer.test.ts`
   and `tests/antigravity-observer.test.ts` exercise normalization, redaction,
   non-fabrication of token usage and parent links, partial UTF-8 writes,
   malformed lines, restart, truncation, in-place step rewrite, atomic file
   rotation, late metadata arrival, symlink rejection, oversized lines, live
   Bridge WebSocket/notification delivery, and Model Analytics reporting.
2. **Validated on machine (`pnpm validate:local`, 2026-11-18):** copied 6
   bounded local Antigravity transcripts and `cache/conversation_metadata.json`
   into a disposable temporary directory and SQLite database, ingesting 6
   sessions across 2 workspaces (1,688 normalized events, 2 observed models,
   `usageRecordedSessions: 0`, `malformed: 0`, `errors: 0`,
   `replayStable: true`, `restartStable: true`,
   `sourcePrefixesUnchanged: true`, `temporaryDataDeleted: true`) without
   printing captured content. Full dashboard/native Tauri visual acceptance and
   root `pnpm build` were not run in this observer-only increment.
