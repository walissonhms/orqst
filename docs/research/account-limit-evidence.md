# Account limit evidence — 2026-11-05

ORQST's existing Codex observer reads bounded, complete JSONL records under its
configured sessions root and persists the source file, byte offset and SHA-256 on
normalized token events. The managed terminal host and observer are separate
processes, so the account panel reads the observer's private SQLite index in
read-only mode, then reopens the referenced local source read-only and verifies
its path, file identity, complete line and recorded hash before projecting the
fixed rate-limit fields. It does not re-run a provider CLI or access credentials.
The result identifies the ORQST default directory, not a verified current
provider login; a user who changes logins in one directory may see an older
reading from that directory.

Reference: Anywh commit `546f189c04415c3c5af5f40e3931a0a90b9aba31`, Apache-2.0
[LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE),
no tracked NOTICE (tree inspected). Its
[`codexLimits.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/planUsage/codexLimits.ts)
identifies the account bucket and windows by duration; its
[`codexRateLimits.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/planUsage/probes/codexRateLimits.ts)
spawns an app-server and queries the provider. **Decision: keep ORQST's existing
observer** and adapt the bucket/duration distinction; no code copied. The probe
would contact a provider and touch CLI state, contrary to the requested offline
read-only contract. Codex's
[`protocol.rs`](https://github.com/openai/codex/blob/c48785a9b746cbfd01fcae3bef6e4dacb73ca49a/codex-rs/protocol/src/protocol.rs)
defines `TokenCountEvent`, `RateLimitSnapshot` and `RateLimitWindow`, including
`limit_id`, `used_percent`, `window_minutes` and `resets_at`. ORQST consumes only
the observed rollout form.

Anywh's [`claudeEvent.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/planUsage/claudeEvent.ts)
parses a stream-json event, while [`transcriptLimits.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/planUsage/transcriptLimits.ts)
reads refusal evidence. Claude's [status-line documentation](https://code.claude.com/docs/en/statusline)
describes rate-limit fields when available. The current ORQST owned interactive
PTY has neither an owned status-line collector nor a structured event stream for
this data. Do not infer percentages from refusal or alter the user's status-line
settings. Claude is omitted until a bound source is implemented and verified.

OpenCode commit `e3b0ca61ad02c983ff70252b18a0480a1821a29a` has an MIT root
[LICENSE](https://github.com/anomalyco/opencode/blob/e3b0ca61ad02c983ff70252b18a0480a1821a29a/LICENSE).
Its [`usage-limits.ts`](https://github.com/anomalyco/opencode/blob/e3b0ca61ad02c983ff70252b18a0480a1821a29a/packages/core/src/usage-limits.ts)
resolves a Console credential and performs HTTP reads. Its
[`stats.ts`](https://github.com/anomalyco/opencode/blob/e3b0ca61ad02c983ff70252b18a0480a1821a29a/packages/cli/src/commands/handlers/stats.ts)
queries session statistics rather than proving account quota. **Decision: do not
reuse**: no offline percentage source bound to an ORQST profile was established,
and credential/provider calls conflict with this request. OpenCode is omitted.
No account is invented and an absent percentage is never displayed as 0.
