# Multi-workspace and turn evidence research — 2026-11-05

ORQST's `inspectManagedTerminalFiles` and `inspectTerminalEnrollment` reject
different projects. `terminal/host.ts` chooses a single Feature database from
the first selection; simply removing those guards would mix Feature membership
and permissions across workspaces. Keep the current guard until Feature/view
storage, layout membership, admission and per-slot workspace identity are all
independently scoped and tested. The native pool is eight slots.

Anywh commit [546f189c04415c3c5af5f40e3931a0a90b9aba31](https://github.com/anywh-sh/anywh/tree/546f189c04415c3c5af5f40e3931a0a90b9aba31)
is Apache-2.0 ([license](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE));
the inspected tree has no tracked NOTICE. Its
[Codex driver](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/codexDriver.ts)
tracks structured `turn/started` and `turn/completed` from its own app-server,
and its [host session driver](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/hostSessionDriver.ts)
learns Claude session identity from its owned stream. ORQST's interactive PTY
does not own those streams; keep the existing PTY and do not copy or infer their
events. The upstream transcript reader calls the JSONL an internal, incompletely
documented format. An observed assistant or tool record alone does not prove a
completed turn, a permission prompt, or a failure.

Claude's [hook reference](https://code.claude.com/docs/en/hooks) documents
`Stop`, `StopFailure`, `UserPromptSubmit`, and `PermissionRequest`; it says the
final transcript record is not guaranteed to exist when `Stop` fires, and a
permission hook can also run without an interactive prompt. A safe owned hook
channel would need exact session/launch correlation, turn identity, passive
non-blocking behavior, independent configuration and consent review, and
provider-version acceptance before being used for state or notifications.

For a bounded display projection, the [Messages API stop-reason reference](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)
defines `end_turn` as completion of a response and `tool_use` as a tool call.
Claude Code's transcript is a distinct, undocumented local format, so these
fields are recognized only when present in the exact owned transcript; missing
fields remain unknown. A [Claude Code issue](https://github.com/anthropics/claude-code/issues/96795)
reports a pending `AskUserQuestion` is absent until answered. Consequently no
pending prompt or permission is inferred from absence of a result; hook delivery
is deferred. An [upstream issue](https://github.com/anthropics/claude-code/issues/87972)
reports API errors marked `isApiErrorMessage`; this projection requires that
explicit flag and remains unvalidated against a real owned provider session.

[OpenAI's app-server documentation](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
binds `thread/start` to its structured response and reports `turn/completed` with
a turn status. It does not supply that channel to the existing interactive PTY.
[OpenCode's CLI documentation](https://dev.opencode.ai/docs/cli/) describes
`--session` as continuing an existing session and `attach` as connecting to a
server; neither proves the session created by the current standalone PTY. A
separate server or app-server would change the launch contract and must not be
silently introduced. Codex/OpenCode binding remains unproven here.
