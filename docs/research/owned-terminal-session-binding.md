# Owned terminal session binding — 2026-11-05

Reference: Anywh commit `546f189c04415c3c5af5f40e3931a0a90b9aba31`,
[LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
Apache-2.0; the inspected tree has no tracked NOTICE. Files and source headers were
inspected. Anywh's [CodexPool.startThread](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/codexPool.ts)
obtains `thread.id` from a structured app-server response; [AgentHost](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/agentHost.ts)
routes subsequent Codex notifications by exact thread ID and learns Claude's ID
from its own structured stream. These are not the ORQST interactive PTY contract.
Replacing the PTY with these drivers would alter execution and consent; keep the
existing Core and never derive identity from timing, CWD or terminal output.

Anywh's [transcriptReader.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/claude/transcriptReader.ts)
uses a project-keyed Claude transcript path and tool-use blocks. ORQST narrowly
adapts its `sanitizeCwd`/`transcriptPath` path spelling, with attribution in NOTICE,
and adds prior-absence, exact launch UUID/CWD, receipt/epoch, no-symlink, inode,
read budgets, private durable binding, and tool-name-only checks. It does not copy
the upstream transcript parser, history, prompts, recovery or process control.

Claude's `--session-id` is already fixed to a freshly generated UUID in the
reviewed native launch. Only a later matching transcript record after an owned
receipt-backed start establishes the binding. The 2 MiB/512-record bound means
larger or unsupported transcripts remain unavailable. This is a narrow owned
display projection, not a general Claude observer or provider acceptance.

The native Codex TUI does not expose Anywh's `thread/start` response to this PTY
owner; scanning a rollout directory by creation time, project, PID or proximity is
not a binding. The OpenCode standalone TUI contract likewise supplies no verified
per-terminal session identity here. Both stay unavailable until a provider-specific
identity channel is proven; no guess or private service attachment is introduced.
