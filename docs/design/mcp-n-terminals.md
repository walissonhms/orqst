# MCP for every terminal (N-terminal messaging) — design

Status: draft 2026-11-06, pane-768. Owner decisions recorded below. Reference research
(AGENTS.md §13) by pane-824 (handoff h-1aw): Tucano `91061b0` and Anywh `51bca54`, both
Apache-2.0; attribution goes to NOTICE and `docs/research/mcp-n-terminals.md`.

## Owner decisions (2026-11-06)

1. Every ORQST terminal gets the ORQST MCP server so terminals talk natively.
2. Inside one Feature, terminals message each other freely: no per-message or per-task
   native confirmation. Messages to another Feature or workspace are refused.
3. Every message is audited with metadata only (sender, recipient, kind, time, Feature);
   content is never written to the audit journal or logs.
4. The owner can also send a message to a terminal from the Studio mention box (owner as a
   sender, identified as such).
5. Claude keeps its owned hooks (working/completed state and notifications) together with
   MCP; the combination gets its own review and tests.

## What exists (baseline)

- `InteractiveMcpSession` (`packages/core/src/terminal/interactive-mcp.ts`): one disposable
  pair, two Unix-socket endpoints (`source`, `worker`) from `openMcpInstanceSockets`
  (`mcp-socket.ts`), one native-signed grant per task (`McpTaskBroker`, `mcp-task.ts`).
- Relay (`mcp-relay.ts`): stdio JSON-RPC for the CLI, static tools per role
  (`delegate_task`, `wait_task`, `submit_result`).
- Core host (`host.ts`): MCP only for the initial selection when slot 0 opted in;
  enrollment (`host.ts` enroll) builds profiles without MCP.
- Launch per CLI (`provider-mcp-config.ts`, `codex-profile.ts`, `opencode-profile.ts`):
  Codex `-c mcp_servers.<name>`, Claude `--strict-mcp-config --mcp-config`, OpenCode
  `OPENCODE_CONFIG_CONTENT`. Claude MCP excludes owned hooks today.
- Audit: `mcp-communication.ts` metadata journal scoped to the Feature that owns both
  terminals; projected into the Studio as communication events.

## Target design

### Core message hub (replaces the pair session for N terminals)

- One hub per Core. Each terminal slot (initial or enrolled) gets its own endpoint: a
  private Unix socket and capability file (0700/0600, one authenticated connection,
  `timingSafeEqual`), reusing `openMcpInstanceSockets` framing and limits.
- The endpoint identity is the terminal's stable `terminalId`, bound at dispatch to the
  running instance (same `owned` check as today).
- Feature scope is read from the Feature configuration database at every send: sender and
  recipient must belong to the same, non-archived Feature. Otherwise `refused`.

### Tools (per terminal, no role split)

Every call answers at once; nothing holds a call waiting for another agent (Anywh
`roomTools.ts:1-8`, and its abandoned held `present_choice`, `mcpBridge.ts:216-230`).

| Tool             | Purpose                                                                         | Reference                                        |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------------------------ |
| `list_terminals` | Members of my Feature: `T-00x`, name, CLI, state, queue                         | Anywh `room_status`                              |
| `send_message`   | `to` (`@T-00x`, ≤ 3 recipients), `text` ≤ 16 KiB → `{messageId, state}`         | Anywh `message_agent`; Tucano `MAX_MENTIONS=3`   |
| `read_messages`  | Next messages for me (≤ 20), oldest first, long text truncated with a notice    | Tucano follow-ups, `MAX_RESULT_BYTES` truncation |
| `wait_messages`  | Same, waiting ≤ 60 s; timeout returns empty, never an error                     | Anywh "never hold a call"                        |
| `delegate_task`  | `to`, `task` → `{taskId}` immediately; the result arrives as a `result` message | Anywh `delegate`                                 |
| `submit_result`  | `taskId`, `status` (`done`/`failed`/`blocked`), `summary`                       | Anywh `report`                                   |
| `task_status`    | `taskId` → state, summary                                                       | Anywh `room_status`                              |

Limits: inbox 20 per terminal (full → instructive refusal), 30 sends per minute per
sender, chain depth ≤ 3 from one owner message (Tucano `MAX_DEPTH=3`), no self-message.
Delivery is pull-based (tool calls); nothing is typed into a PTY (no steering).

### Safety

- Content from another terminal is untrusted input. Tool descriptions say so; results carry
  the sender identity separately from the text. ORQST never executes or interprets it.
- Loop/flood control: per-sender rate limit, bounded inbox, no automatic replies by ORQST.
- Unknown outcomes (disconnect, timeout) stay `unknown`; no implicit retry or replay.
- Hooks: Claude terminals keep owned hooks with MCP (decision 5).

### Creation

- `create-batch` provisions every terminal with `interactive.mcp: true` and the per-CLI
  acknowledgement fields; enrollment builds profiles with the terminal's hub endpoint.
- The MCP pair flow (`create-mcp-pair`) stays available until the hub is accepted.

### Studio

- The mention box delivers owner messages into each Feature member's hub inbox
  (`queued` / `hub_inbox`); unassigned terminals stay recorded-only.
- Communication arcs/badges come from recent hub events (metadata only, terminals only).
- Audit: `<preferences>/hub-communication/<epoch>.jsonl` (0600, append-only, 1 MiB cap,
  metadata only, owner messages included); composer mention records omit the text.

## Open questions

None open; decisions 4 and 5 answered them on 2026-11-06.

## Phases

1. Hub + tools + limits + Feature scope + audit (Core, unit tests).
2. Launch wiring for initial and enrolled terminals; batch provisions MCP.
3. Studio projection and composer.
4. Native/provider acceptance with Codex, Claude and OpenCode on the owner's Mac.
