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

## Owned notification wiring — 2026-11-05

Revalidated Anywh's pinned
[`notify_turn_complete`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/notifications.rs)
and its root Apache-2.0 LICENSE; the exact tree has no NOTICE. The function accepts
renderer title/body/session/profile data and relies on an older plugin's platform
behavior. Decision: keep ORQST's fixed native category text, private owned-host pipe
and existing callback instead of copying the command or its captured-content payload.
No Anywh source or assets are incorporated by this increment.

The installed `tauri-plugin-notification 2.8.0` crate's `.cargo_vcs_info.json` proves
revision `128190689dbe59b59d344e01bf07b00862aa3791`. Re-inspected
[`NotificationBuilder::show`, `Notification::on_action`, `imp::show_tracked`, `wait`](https://github.com/tauri-apps/plugins-workspace/blob/128190689dbe59b59d344e01bf07b00862aa3791/plugins/notification/src/desktop.rs):
macOS click responses are reported by a waiting thread, not by the observer DOM.
The Apache-2.0 OR MIT license and existing NOTICE entry remain applicable; no new
dependency or version change. Delivery is asynchronous and OS suppression/errors
are not an acceptance receipt. Keep the existing twenty-attempt native run cap.

The new Core poller consumes only `TauriTerminalService.canvasEvidence` for exact
owned identities. It rereads the existing private observer notification preferences
through a bounded read-only SQLite query. Missing/corrupt settings, lost or stale
samples, and shutdown clear the transition baseline. A native click returns through
the current host epoch and layout generation and resolves exact Feature membership
in Core; it never starts a CLI, types into a PTY, or restores an input grant.
