# Codex CLI adapter

The Codex adapter is the only implemented integration in ORQST. It observes
Codex CLI session files that were produced by Codex itself, outside ORQST. It
never launches Codex and never writes to a session file.

- Package: `packages/adapters/codex`
- Entry points: `src/index.ts` (discovery and reading), `src/normalize.ts`
  (record mapping)
- Descriptor: `codexDescriptor` in `src/index.ts`

## Source location

The observed root is resolved from `ORQST_CODEX_SESSIONS`. If unset:

```
${CODEX_HOME:-~/.codex}/sessions
```

The root is resolved to an absolute path at observer construction. Each scan
also resolves the canonical root with `realpath` and requires every file's
canonical path to remain inside it.

If the root does not exist, the observer records no sessions. A missing root is
not fatal; the rest of the bridge still starts.

## Discovery

Every scan:

1. Resolves the canonical root.
2. Walks the tree recursively to a maximum depth of 5.
3. Skips symbolic links entirely.
4. Considers only regular files whose name ends in `.jsonl`.
5. Sorts the file list for deterministic processing.
6. Reads each file within a per-file budget.

Discovery runs in two ways:

- **chokidar** with `ignoreInitial: true`, `followSymlinks: false`, depth 5.
  Any file event triggers a scan.
- **Polling** every `ORQST_POLL_MS` milliseconds (default 3,000; allowed
  500–60,000). This is the correctness fallback when filesystem notifications
  are dropped or unreliable.

Scans are coalesced: if a scan is already running, a new request returns the
same promise. This prevents overlapping reads of the same checkpoint.

## Reading algorithm

For each file:

1. Open with `O_RDONLY | O_NOFOLLOW`.
2. `stat` the handle; only regular files are read.
3. Build the file identity as `dev:ino`.
4. Load the checkpoint for `root + ':' + relativePath`.
5. Reset the checkpoint if:
   - none exists,
   - the identity changed (rotation or replacement),
   - the stored offset is beyond the current file size (truncation),
   - the anchor hash does not match the bytes before the stored offset.
6. If the offset equals the file size, do nothing.
7. Read in 128 KiB chunks, up to 8 MiB per file per scan.
8. Buffer partial lines. Only newline-terminated records are parsed.
9. For each complete line:
   - if the line is longer than 2 MiB, discard it, increment `oversized`, and
     continue after the newline;
   - otherwise parse JSON; a parse failure increments `malformed` and is
     skipped;
   - normalize recognized records into zero or more events;
   - ingest each event, which validates and deduplicates it;
   - stage successfully stored events for dispatch.
10. After complete lines are handled, save the checkpoint (offset, line,
    identity, anchor, adapter state) and dispatch staged events.
11. Do not checkpoint in the middle of a partial line or an oversized line.

The anchor is a SHA-256 of up to 64 bytes ending at the committed offset. It
detects a file that was modified in place without changing size or inode.

The 8 MiB budget means a very large historical file is processed over several
scans rather than blocking active sessions. The budget is per file, per scan. Finishing an oversized line may exceed this budget to avoid repeatedly stalling before its newline. Large initial histories have not been load-tested and live alerts are suppressed during the initial scan.

## Adapter state

The checkpoint stores a JSON state object across scans and restarts:

```ts
interface CodexState {
  sessionId?: string;
  workspaceId?: string;
  cwd?: string;
  agentName?: string;
  parentSessionId?: string;
  minOrdinal?: number;
  turnId?: string;
  rootTurnId?: string;
  model?: string;
}
```

This state is what lets a later record be interpreted without re-reading the
whole file.

## Record identity

- `session_meta` establishes the session identity. Only the **first**
  `session_meta` in a file is used. A forked file can contain the parent's
  metadata after the child's; using the first prevents the child from being
  relabeled as the parent.
- Session ID comes from `payload.id` or `payload.session_id`.
- Working directory comes from `payload.cwd` and is normalized.
- Workspace ID is `stableId('workspace', cwd)`, or
  `stableId('workspace', 'unknown:' + sessionId)` when no cwd exists.
- Parent session comes only from `payload.parent_thread_id` or
  `payload.source.subagent.thread_spawn.parent_thread_id`.
- Agent name comes from `payload.agent_nickname`, then the thread-spawn
  `agent_nickname`, then `payload.agent_path`, then `basename(cwd) + ' · ' +
sessionId.slice(0, 8)`.
- `payload.subagent_history_start_ordinal` sets a floor. Records with an
  `ordinal` below that floor are inherited history and are ignored.

Records that appear before a session identity is known are dropped. Records
without a parseable `timestamp` are dropped.

## Normalization mapping

| Source record        | Condition                                                       | Normalized event              | Payload                                                                                                                         |
| -------------------- | --------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `session_meta`       | first in file                                                   | `session.started`             | `status: unknown`, `parentSessionId` if explicit                                                                                |
| `turn_context`       | —                                                               | `session.updated`             | `model`                                                                                                                         |
| `token_usage_record` | `thread_id` absent or equal to session                          | `agent.tokens.updated`        | `thread_token_usage` as `session_cumulative`, `turn_token_usage`, incremental `usage` as `responseUsage`, `responseId`, `model` |
| `event_msg`          | `payload.type: task_started`                                    | `agent.started`               | `status: running`, `model`                                                                                                      |
| `event_msg`          | `payload.type: task_complete`                                   | `agent.completed`             | `status: completed`, `result: last_agent_message`                                                                               |
| `event_msg`          | `payload.type: turn_aborted`                                    | `agent.updated`               | `status: interrupted`                                                                                                           |
| `event_msg`          | `payload.type: error` or `task_failed`                          | `agent.failed`                | `status: failed`, `text` from `message` or `error.message`                                                                      |
| `event_msg`          | `payload.type: token_count`                                     | `agent.tokens.updated`        | `info.total_token_usage` as `session_cumulative`, `model`                                                                       |
| `response_item`      | `payload.type: message`, role `user`/`assistant`                | `agent.message`               | `role`, `text`, `phase`                                                                                                         |
| `response_item`      | `payload.type: agent_message`                                   | `agent.message`               | `role: agent`, `text`, `recipient`, `name` from `author`                                                                        |
| `response_item`      | `function_call` / `custom_tool_call` named `request_user_input` | `agent.intervention.required` | `status: waiting_for_user`, `name`, `callId`, `text` from arguments/input                                                       |
| `response_item`      | other `function_call` / `custom_tool_call`                      | `agent.tool.started`          | `name`, `callId`, `text` from arguments/input                                                                                   |
| `response_item`      | `function_call_output` / `custom_tool_call_output`              | `agent.tool.completed`        | `status: running`, `role: tool`, `callId`, `text` from output                                                                   |

Everything else is ignored. This includes `world_state`, `reasoning` records
(including `encrypted_content`), `inter_agent_communication_metadata` itself,
and unknown record types. Ignored records are not persisted.

### Event identity and source

Each event ID is deterministic:

```
stableId('codex', machineId, sessionId, recordType,
         subtypeOrResponseIdOrRecordIdOrContentHash, normalizedEventType)
```

The stored source reference contains:

- `file` — path relative to the session root, with `/` separators;
- `offset` — byte offset of the record;
- `line` — 1-based line number;
- `hash` — SHA-256 of the record bytes;
- `recordType` — `event_msg:<subtype>`, `response_item:<subtype>`, or the
  top-level type.

Because the ID is deterministic and `events.id` is unique, re-reading the same
record after a restart, rotation, or duplicate scan is a no-op.

### Correlation

- `turnId` comes from `payload.turn_id`, the internal chat metadata passthrough,
  or the tracked state.
- `rootTurnId` comes from `payload.root_turn_id` or tracked state.
- `callId` comes from `payload.call_id`.

Correlation is recorded for traceability. It is not used to invent a
parent/child relationship between sessions.

## Status semantics

Statuses are evidence-based:

- `unknown` — session discovered, no lifecycle evidence yet;
- `running` — an explicit task start or tool return;
- `waiting_for_user` — a direct `request_user_input` call;
- `completed` — an explicit `task_complete` (the **turn** completed, not
  necessarily the process exit);
- `failed` — an explicit `error` or `task_failed`;
- `interrupted` — an explicit `turn_aborted`.

Inactivity is never treated as completion. A stale running session remains
running until the source says otherwise.

The database rejects out-of-order status overwrites using `state_at`, so a late
older record cannot move a session backwards.

## Live versus imported events

An event is marked `live` only when:

- the initial scan has completed, and
- the event timestamp is less than 60 seconds old, and
- the timestamp is not more than 5 seconds in the future.

History imported during the first scan is stored and replayed to the dashboard
but never raises a notification. This avoids a burst of alerts for old
sessions.

## Recovery behavior

| Situation                  | Behavior                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------- |
| Bridge restart             | Checkpoint resumes at the committed offset and restores adapter state                   |
| Partial JSONL write        | Incomplete line stays buffered; it is parsed after the newline arrives                  |
| File truncation            | Offset beyond file size resets the checkpoint; the file is re-read                      |
| File rotation/replacement  | `dev:ino` change resets the checkpoint; the new file is read from the start             |
| In-place modification      | Anchor hash mismatch resets the checkpoint                                              |
| Duplicate scan             | Deterministic event IDs make ingestion idempotent                                       |
| Corrupted JSON line        | `malformed` counter increments; the line is skipped                                     |
| Oversized line             | `oversized` counter increments; the line is discarded and reading continues             |
| Missing fields             | The record is dropped or normalized with optional fields absent; no event is fabricated |
| Missing session identity   | Records before `session_meta` are dropped                                               |
| Inherited subagent history | Records below `subagent_history_start_ordinal` are ignored                              |
| Very large file            | The 8 MiB per-scan budget spreads processing over multiple scans                        |

## Diagnostics

The observer exposes counters used by the dashboard's "Source health" panel:

```ts
{
  files: number;
  malformed: number;
  skipped: number;
  oversized: number;
  errors: number;
  lastScan: string | null;
  scanning: boolean;
}
```

- `files` — `.jsonl` files found in the last scan;
- `malformed` — JSON parse failures;
- `skipped` — files whose canonical path escaped the root;
- `oversized` — lines over 2 MiB;
- `errors` — scan or watcher errors;
- `lastScan` — completion time of the last scan;
- `scanning` — whether a scan is in progress.

Counters are cumulative for the process lifetime, not persisted.

## Limitations

- **Only direct evidence.** Parentage requires an explicit field. Inter-agent
  message `author` and `recipient` values are path labels; they do not prove a
  session relationship.
- **Compatibility mappings.** Failure and interruption mappings are
  compatibility paths exercised by synthetic fixtures. They are not guaranteed
  for every Codex version or every error shape.
- **Turn completion is not process completion.** `task_complete` ends a turn.
- **Token totals are snapshots.** ORQST keeps the largest accepted cumulative
  snapshot. It does not sum records, estimate cost, enforce budgets, or report
  provider quota.
- **No intervention delivery.** A detected request is displayed; the user must
  return to the original terminal.
- **Schema drift.** Unknown record types are ignored. A future Codex format
  change may reduce captured detail without an error.
- **File layout assumptions.** Depth 5 and the `.jsonl` suffix are assumptions.
  A different layout needs a configuration or adapter change.
- **No Windows validation.** Path and file-identity behavior on Windows/WSL is
  untested.
- **Large histories are gradual.** The 8 MiB budget limits work on each file per scan. Full-archive discovery latency is unmeasured.

## Validation

The adapter descriptor records that local Codex `0.162.1` JSONL was inspected,
that parent relationships use only explicit fields, that intervention mapping
uses only direct `request_user_input` calls, and that failure/interruption
mappings are fixture-tested compatibility paths. That is the adapter's declared
evidence; actual execution results are recorded below.

Two validation layers exist:

1. **Synthetic tests** in `tests/normalizer.test.ts` and
   `tests/observer.test.ts`. They cover protocol shapes, inherited records,
   inter-agent messages, lifecycle status, intervention, redaction, impossible
   token records, partial UTF-8 writes, malformed records, restart, truncation,
   rotation, duplicate replay, symlinks, oversized lines, and live completion.
2. **Real-data script** `scripts/validate-local.ts` (`pnpm validate:local`).
   It selects up to eight recent local Codex files under 5 MiB, copies them
   into a temporary session root, ingests them into a disposable database,
   checks expected cumulative totals, re-scans for replay stability, restarts
   the store for restart stability, verifies the source files' captured prefix
   is unchanged, and deletes the temporary directory. It prints aggregates
   only, never captured content.

Both layers passed on the recorded macOS environment. Other providers, releases and platforms require their own evidence. See
[../development/testing.md](../development/testing.md).

## Security notes

- Source files are opened read-only and never modified.
- Symlinks are skipped and canonical paths must stay inside the root.
- Each line is parsed as data. Nothing from a session file is executed.
- Text is redacted best-effort and capped at 32,000 characters before storage.
- Raw logs, reasoning, account/identity fields, and environment blocks are not
  persisted.

## Validation evidence (2026-11-02)

Local JSONL metadata identified Codex CLI 0.162.1. A bounded validation used eight actual sessions across two workspaces, including one explicit parent relationship. Cumulative accounting, replay, restart and source-prefix integrity passed. The compiled application and Chromium dashboard also loaded this disposable real dataset. See [validation scope and reproduction commands](../development/testing.md).

No direct `request_user_input`/`functions.request_user_input` call was found in a separate 30-file recent sample, so `userIntervention` remains false. Failure, interruption and input-request compatibility paths are fixture-tested only. Code-mode-nested requests, approval prompts and arbitrary terminal input cannot be reliably detected or answered from this adapter.
