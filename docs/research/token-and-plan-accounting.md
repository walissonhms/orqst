# Token, plan and price evidence

Reviewed 2026-11-17 against the provider protocols below and the ORQST
adapters and native contracts. Provider runtime validation requires separate
native checks on a disposable profile.

| Surface             | Source and decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex CLI observer  | The [rollout adapter](../adapters/codex.md) admits thread cumulative snapshots and compatibility mirrors using the SQLite priority rule. A compatibility `token_count` with quota and no valid usage is indexed by source reference only.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Codex structured    | The pinned 0.169.0 [notification](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server-protocol/schema/typescript/v2/ThreadTokenUsageUpdatedNotification.ts) carries thread and turn IDs, and [its usage payload](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server-protocol/schema/typescript/v2/ThreadTokenUsage.ts) distinguishes total and last. Use the total for the matching owned thread.                                                                                                                                                                                    |
| Codex subscription  | The [App Server account protocol](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server-protocol/src/protocol/v2/account.rs) distinguishes rate limits from token usage. The existing terminal UI reports only the timestamped default bucket from local rollouts. Model buckets, credits, alternate accounts and unidentified profiles remain unavailable.                                                                                                                                                                                                                                                                           |
| Claude Code         | The [Messages rate-limit documentation](https://platform.claude.com/docs/en/api/rate-limits) defines uncached input, cache writes and cache reads as disjoint input components. Reuse the [owned transcript binding](claude-owned-hooks.md) to count response IDs within that session. Coverage is limited to bounded, complete local transcripts. The API description is a counter-semantics reference. It does not establish the transcript format or the CLI's subscription usage.                                                                                                                                                                                             |
| OpenCode structured | In 2.2.5, the [session projector](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/core/src/session/projector.ts) aggregates per-session counters and emits cumulative `session.usage.updated`. Its [session schema](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/schema/src/session.ts) denominates `cost` in USD and its [token schema](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/schema/src/token-usage.ts) defines disjoint components. ORQST preserves the upstream estimate without repricing models or converting currency. |
| Price coverage      | Public [OpenAI API prices](https://developers.openai.com/api/docs/pricing) and [Anthropic API prices](https://platform.claude.com/docs/en/about-claude/pricing) are reference rates. The local observer lacks the billing mode, effective model/provider, request-level tier and cache-write metadata needed to qualify a cost estimate. Subscriber allowance, API spend and provider estimates have different semantics.                                                                                                                                                                                                                                                         |

The reference review retained ORQST's ownership boundaries. At Anywh
`546f189c04415c3c5af5f40e3931a0a90b9aba31`, the
[Claude transcript reader](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/claude/transcriptReader.ts)
implements `sanitizeCwd` and `transcriptPath`, which ORQST already adapts inside
its one-shot binding. Anywh's
[Claude stream mapper](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/streams/claudeStreamJson.ts)
consumes headless assistant events. Its
[Codex mapper](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/streams/codexAppServer.ts)
uses the last response for per-response display. ORQST uses the correlated
cumulative total for its aggregate and retains the existing PTY instead of
adopting the headless driver. Reviewed the
[Anywh Apache-2.0 license](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE).
This increment incorporates no reference source or package dependencies.

Claude Code and OpenCode observer adapters are descriptors only. Claude's owned
PTY evidence does not backfill passive observation. Studio has no structured
Claude provider. The current OpenCode PTY has no bound usage snapshot. The
Codex interactive PTY has no exact observer-session join in the Feature
projection. The per-terminal menu leaves unavailable counters blank. The
dashboard does not read account credentials or infer plan limits for Claude
or OpenCode from their token counts.

## Native acceptance for the owner

1. In a disposable native profile, exercise a verified Codex default-profile
   quota record with no token usage. Verify the account panel refreshes, labels
   the report time and shows an unknown percentage at the reset boundary
   until a newer report appears.
2. Open an owned Claude terminal and complete a prompt with a tool response.
   Compare the pane menu and Feature coverage with the matching transcript's
   unique assistant response IDs. Switch Feature and verify the counter stays
   scoped to its terminal.
3. In the structured Studio, use one owned Codex thread and one OpenCode
   session with a priced model. Compare the Codex cumulative App Server
   breakdown and OpenCode session counters with the UI, including reasoning
   and cache components. Confirm USD pricing is labeled as the OpenCode
   estimate and absent when its amount is zero or unspecified.
4. Repeat the displayed states in English and Brazilian Portuguese. Existing
   Preview instances are independent of these native acceptance checks.
