# Managed CLI research — 2026-11-03

This is a primary-source inventory, not provider acceptance or a supported-version
list. Public release metadata and documentation were fetched on 2026-11-03. No
installed provider was executed, no authentication status was queried and no user
credential, configuration or session source was opened for this research. Moving
upstream documentation may describe features newer than a release; version-specific
behavior still needs a disposable acceptance run against the exact admitted binary.

| Provider    | Latest stable release returned by upstream at inspection                                             | Documented interfaces                                                                | ORQST delivery                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Codex       | [0.166.0](https://github.com/openai/codex/releases/tag/rust-v0.166.0), published 2026-10-29          | Interactive CLI; `exec`; app-server JSON-RPC with default JSONL stdio                | External-session observer implemented. Managed PTY and structured client not implemented. |
| Claude Code | [2.1.317](https://github.com/anthropics/claude-code/releases/tag/v2.1.317), published 2026-11-03 UTC | Interactive CLI; print mode with text/JSON/stream-json and explicit permission modes | Observation contract only; managed integration not implemented.                           |
| OpenCode    | [1.19.5](https://github.com/anomalyco/opencode/releases/tag/v1.19.5), published 2026-10-28           | TUI; `run`; headless HTTP server and OpenAPI/SSE                                     | Observation contract only; managed integration not implemented.                           |

These version numbers are upstream release observations. They do not identify the
owner's installed executables, prove model access or change any adapter capability.

## Codex

The [official CLI reference](https://developers.openai.com/codex/cli/reference/)
documents interactive execution and sandbox selection. The
[official app-server contract](https://developers.openai.com/codex/app-server/)
separates initialization, thread/turn operations, approval requests and interrupt
from process exit. Its default transport is newline-delimited stdio. WebSocket is
explicitly experimental/unsupported; ORQST should prefer an owned private stdio
child for a future structured integration. No connection to an existing control
socket or externally started server is authorized by discovery.

A future TUI profile must validate a fixed executable/version, isolated configuration
and history, sandbox/approval policy, readiness and exit. App-server output is a
structured protocol, not a PTY transcript. `turn/interrupt`, raw Ctrl+C, signals and
provider approval each need separate operation-specific evidence. Neither an
app-server command-execution channel nor a shell is a substitute terminal allowlist.

## Claude Code

The [official CLI reference](https://code.claude.com/docs/en/cli-reference) documents
interactive and print modes, stream-json input/output, resume and permission flags.
The [permission guide](https://code.claude.com/docs/en/permissions) distinguishes
permission choices from sandboxing. A plan/manual permission mode alone is not an
OS containment proof. No bypass flag, automatic permission answer, remote-control
mode, hook installation or external-session resume is admitted by this work.

The first owned TUI trial needs its own fixed version, disposable authentication,
isolated settings/plugins/MCP/hooks, history and provider sandbox validation.
Structured print-mode integration needs independent framing, error, usage and approval
handling; existing Codex normalization cannot be reused as a Claude parser.

## OpenCode

The [official CLI guide](https://opencode.ai/docs/cli/) documents its TUI and headless
commands. The [server guide](https://opencode.ai/docs/server/) describes OpenAPI,
SSE, session abort and permission response endpoints. Server authentication is
configured separately; loopback binding alone does not establish authorization.
The [permissions guide](https://opencode.ai/docs/permissions/) describes allow/ask/deny
and auto approval. These are not an ORQST execution grant or a hard OS sandbox.

A future own-server client needs isolated provider state, independent authentication,
loopback/Origin policy, bounded SSE recovery and exact operation checks. Do not scan
ports, attach to existing servers or call their permission/abort endpoints. A TUI
PTY profile remains separate from that HTTP client. No API client, parser or live
OpenCode capability is implemented by this research.

## Selected next boundary

Continue the existing owned-handle supervisor and bounded inert PTY path. The new
[native broker contract](../api/terminal-native.md) selects fixed profiles only,
keeps private signatures/leases outside IPC and supports native confirmation per
operation. Its concrete Electron helpers remain uncomposed until restricted-document,
enrollment/transport, immutable admission, lifetime/recovery and native acceptance
gates pass. External observers remain read-only. No provider is enabled merely
because its upstream interface exists.
