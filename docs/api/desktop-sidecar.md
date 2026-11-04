# Native Desktop Core process contract

This is a private inherited-stdio protocol between the Tauri shell and its owned
Node process, not an HTTP API or a renderer capability. It carries no agent prompts,
PTY input, credentials, provider decisions or task acknowledgments.

The native host starts its bundled Node executable with exactly the packaged
`core/desktop-sidecar.mjs` entry and dashboard directory. An explicit private
`ORQST_DATA_DIR` is required. The existing Bridge binds only IPv4 loopback. Native Desktop supplies `ORQST_PORT`
(default `4319`, configurable through `ORQST_TAURI_PORT`) for a stable browser
origin; standalone checks may omit it for an OS-selected port. A valid
packaged `index.html` and completed Core startup precede the one stdout record:

```text
ORQST_CORE_READY <decimal-port>\n
```

The native receiver accepts only ports 1024–65535 and waits at most 30 seconds.
Other stdout records, exit/error, missing resources or timeout fail startup and
dispose the owned child. Stderr is drained without displaying provider content or
local paths. After readiness both streams remain drained. Only this child can
clear its native running entry on observed termination.

Native application exit writes `shutdown\n` to stdin. The Core stops the existing
Bridge/observer, closes SQLite and destroys stdin; EOF or process SIGINT/SIGTERM
uses the same cleanup. The native host allows five seconds before killing its
owned child. Stdin has a 32-byte budget and no command dispatcher: a newline or
oversized input requests shutdown. It cannot start or manipulate an agent.

Browser bootstrap, HttpOnly/SameSite cookie authorization, API/WebSocket shapes,
source provenance and persisted event schemas are unchanged. Process readiness
does not prove provider authentication, task execution or desktop feature parity.
