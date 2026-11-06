# Owned Claude hook review — 2026-11-05

Scope: newly prepared owned Claude TUI 2.1.318 launches only. Observer processes,
legacy manifests and the separate 2.1.178 MCP contract are unchanged.

## Settings merge prerequisite

The [official settings precedence](https://code.claude.com/docs/en/settings#settings-precedence)
describes `--settings` as an additional session layer, retaining omitted user/project
keys. The [hook reference](https://code.claude.com/docs/en/hooks) documents common
session/prompt IDs, stdin JSON and command hooks. These are mutable documentation,
not provider acceptance for the pinned binary.

Read-only inspection of the installed 2.1.318 native distribution, SHA-256
`677a2ea7bf576cedd20e191d973914ed8a41796f53a63b1923381ddc4d5b5e7d`,
confirmed its additional-settings flag and default source list includes user,
project, local, flag and policy settings. Its `NBn`/`MB` implementation merges flag
settings and concatenates ordinary arrays; hook schemas include common `prompt_id`,
Notification, Stop and StopFailure. No CLI was executed during inspection. Distribution identity:
[official npm version metadata](https://registry.npmjs.org/@anthropic-ai/claude-code/2.1.318).
The distribution publishes no source commit; the exact binary digest identifies
this inspection. Its license is proprietary (SEE LICENSE IN README.md); no binary
implementation is copied or redistributed by this change.

## Reuse decision

Re-inspected the Apache-2.0 Anywh commit
`546f189c04415c3c5af5f40e3931a0a90b9aba31`, including architecture, Agent Host,
runtime README and
[`buildPersistentArgs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/claude/persistent.ts).
That code uses headless stream-json and agent-worker settings-source selection.
ORQST retains its interactive owned PTY and existing transcript/session binding;
changing to that driver or disabling user settings would change the approved
contract. Keep existing ORQST lifecycle/binding readers and add an original bounded
private metadata hook channel. No upstream code/dependency is copied; no new NOTICE
entry is required (the pinned Anywh LICENSE is Apache-2.0, no root NOTICE).

## Evidence boundary

A UserPromptSubmit metadata hook supplies the exact common prompt UUID as the
running baseline; Notification, Stop and StopFailure use that same explicit UUID. This avoids
mapping a hook to a transcript turn by time, text or proximity. Transcript binding
must still prove the exact preselected Claude session before hook state is exposed.
Post-tool metadata clears a waiting state only after an explicit callback.
StopFailure preserves explicit failure signals without matching a transcript error to a different prompt UUID.
Subagent events, missing IDs, changed files, malformed/partial data and unavailable
proof do not establish a state. Stop means Claude invoked its finished-response
hook; other configured hooks may continue work. It does not establish process exit
or completion of an entire delegated task. Missing hooks or policies disabling them
remain unavailable, with no attempt to override user or managed policy.
