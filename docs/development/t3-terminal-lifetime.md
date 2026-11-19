# Run-owned managed terminal lifetime

The 2026-11-19 owner decision makes the Desktop process lifetime the ownership
boundary for the Node and Rust managed PTY paths. Studio does not read or
mutate historical admission markers during normal startup, provisioning,
enrollment or Quit. A Core epoch and native presentation still bind the
same focused document to the one-use authorization for each start.

The native helper arms a macOS kernel process-exit watch before executing the
provider. The watch covers the PTY owner and session leader. The Node PTY
owner exits on private IPC disconnect. The Rust PTY owner is the Rust Core,
which exits when its private parent transport closes. The watch sends signals
only to the process groups and jobs in its own PTY session. Explicit Quit
uses the existing signed stops and records each leader's actual exit. A crash
can leave an incomplete receipt. Studio can still project an ended terminal
without assigning a timestamp or exit status.

Reopen replaces the saved member with a new terminal UUID and retains its
display ordinal, name, Feature handle, provider, model and workspace cwd.
The provider argv is bound to the new manifest. Claude can resume from the
existing exact-session transcript binding and lifecycle receipt. Codex and
OpenCode use their resume argv when an owned manifest carries an evidenced
conversation ID. The interactive baseline has no durable per-process mapping
from their shared native stores back to older ORQST terminals. Those entries
launch a fresh conversation. An argv request does not establish that the
provider loaded the conversation.

## Reference review

- **T3 Code** at `470ca63499293f7f680f8ad2e77381a6752f1348`. The Node server
  ties provider process ownership to runtime effects and scopes. Its process
  controller captures and terminates owned processes. The session manager
  interrupts subscribers on shutdown so restart recovery can settle them
  from persisted state. Provider bindings live in the SQLite projection.
  ORQST adopts the lifetime and reopen behavior while retaining its PTY
  runner, database and signed grants. T3 Code uses its own provider SDK and
  orchestration dependencies. The reviewed root license is MIT. No code or
  assets were incorporated.
  [Process ownership](https://github.com/pingdotgg/t3code/blob/470ca63499293f7f680f8ad2e77381a6752f1348/apps/server/src/process/providerProcesses.ts)
  [Session manager](https://github.com/pingdotgg/t3code/blob/470ca63499293f7f680f8ad2e77381a6752f1348/apps/server/src/orchestration-v2/ProviderSessionManager.ts)
  [SQLite bindings](https://github.com/pingdotgg/t3code/blob/470ca63499293f7f680f8ad2e77381a6752f1348/apps/server/src/persistence/Migrations/OrchestrationV2/ProviderSessionBindings.ts)
  [License](https://github.com/pingdotgg/t3code/blob/470ca63499293f7f680f8ad2e77381a6752f1348/LICENSE).
- **Anywh** at `16d572d247ef16b79431c1ffe5695a8a1b57c913`. The
  `spawnTerminal` path uses node-pty and a persistent named tmux session.
  The background-job runner uses group signals. The Agent Host's process
  sweep uses Linux `/proc`; the macOS Relay startup explicitly sets
  `kill_on_drop(false)`. These ownership contracts allow a service or
  session to outlive the client. ORQST retains its existing clients and
  uses macOS kernel process-exit events and session membership to enforce
  the Desktop run boundary. The reviewed license is Apache-2.0 and the
  pinned tree has no root NOTICE. No code or assets were incorporated.
  [Architecture](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/docs/architecture.md)
  [Agent Host](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/docs/agent-host.md)
  [Runtime contract](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/relay/src/runtimes/README.md)
  [PTY attachment](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/relay/src/host/terminalSession.ts#L61-L117)
  [Process groups](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/relay/src/host/backgroundJobs.ts#L523-L542)
  [Relay setup](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/client/src-tauri/src/relay_setup.rs#L1022-L1033)
  [License](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/LICENSE).
