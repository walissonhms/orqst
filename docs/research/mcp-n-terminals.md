# Reference research — MCP for N terminals (2026-11-06)

Read-only research by pane-824 (handoff h-1aw) for `docs/design/mcp-n-terminals.md`, as
required by AGENTS.md §13. Both sources are Apache-2.0 (compatible with ORQST Apache-2.0);
any reused code keeps attribution in NOTICE.

## Sources

- Tucano — https://github.com/eduwxyz/tucano @ `91061b0` (Apache-2.0, `LICENSE:1-2`).
- Anywh — https://github.com/anywh-sh/anywh @ `51bca54` (Apache-2.0, `LICENSE:1-2`).

## Decisions

| Piece                                                       | Where                                                                 | Decision                                                                 | Reason                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| @mention grammar                                            | Tucano `src/shared/mention-text.ts:4`, `src/core/context.ts:439`      | Reuse (already adapted in `packages/core/src/communication/mentions.ts`) | Same exact-handle resolution, ignores code spans          |
| LLM router for messages without a target                    | Tucano `src/core/router.ts:1-60`                                      | Do not use                                                               | ORQST has explicit targets; a missing target fails closed |
| Busy-agent follow-up queue, coalescing                      | Tucano `src/core/followups.ts:1-66`                                   | Adapt                                                                    | Bounded per-terminal inbox                                |
| Loop/cost guards `MAX_DEPTH=3`, `MAX_MENTIONS=3`            | Tucano `src/core/runs.ts:35-39,1963`                                  | Reuse values                                                             | Chain depth and recipients per message                    |
| Truncate-and-tell results                                   | Tucano `src/core/runs.ts:45,122-131`                                  | Reuse                                                                    | Long text is cut with a notice, not an error              |
| Content persistence                                         | Tucano `runs.ts:279`                                                  | Do not use                                                               | ORQST audits metadata only                                |
| Per-session tool list, parked sessions                      | Tucano `src/core/gateway.ts:1-118`                                    | Adapt                                                                    | One capability and tool list per terminal                 |
| Unknown methods never stop the server                       | Anywh `relay/src/bridges/mcpBridge.ts:249-335`                        | Reuse policy                                                             | Already applied to the ORQST relay (`1bf30dd`)            |
| Stable per-agent capability revoked by membership           | Anywh `relay/src/bridges/roomBridge.ts:30-38,112-160`                 | Adapt                                                                    | Feature membership replaces per-task grants               |
| Tool surface delegate/message/report/status, answer at once | Anywh `relay/src/session/roomTools.ts:1-96`                           | Reuse surface                                                            | Async delegation, no held calls                           |
| Queue limits 5/20 with instructive errors                   | Anywh `relay/src/session/room.ts:110-111`, `roomManager.ts:1334-1336` | Reuse                                                                    | Inbox 20, explicit refusal text                           |
| Hierarchical anti-loop (descendants only)                   | Anywh `roomManager.ts:1322-1332`                                      | Adapt                                                                    | Feature is flat: depth, rate and no self-message instead  |
| Synthetic report when a turn ends without one, digest       | Anywh `roomManager.ts:774-795,1098`                                   | Adapt later                                                              | Avoids a hanging delegator                                |
| Held tool call waiting for a human                          | Anywh `mcpBridge.ts:63-78,216-230`                                    | Do not use                                                               | Lesson: never hold a call                                 |
| Steering into a running turn                                | Anywh `docs/agent-host.md:106-108`                                    | Do not use                                                               | A PTY has no such channel                                 |

## Risks noted

Loops (depth, rate, no self-message), flood (bounded inbox, per-sender budget), prompt
injection between terminals (messages labelled with their sender, treated as data, size
limited, never executed by ORQST), cross-Feature leakage (targets outside the Feature are
not listed and are refused), and the posture change from per-task signed grants to a
Feature-scoped session capability, to be recorded in `docs/architecture/security-model.md`.
