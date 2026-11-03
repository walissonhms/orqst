# Interactive CLIs and per-instance MCP

The owner selected a hybrid direction: real native TUI processes in PTY/xterm,
with a separate structured task/result channel. A structured text panel does not
satisfy the interactive-terminal requirement. MCP does not create a terminal or
prove that an idle model accepts, executes or completes a delegated task.

## Implemented boundary

The [interactive pair](managed-codex-terminal.md#two-interactive-windows-and-shared-admission)
has one private Node Core, two independently owned slots, per-slot journals and
document-bound native clients. The common `TerminalBackend` contract provides
owned start/output/exit and explicit user-authorized keyboard/paste/resize/signals;
the pair keeps provider-specific profiles outside that common lifecycle. The
adapter registry has the earlier explicit Codex separate-login factory and a new
[separately acknowledged native-login PTY opt-in](managed-codex-terminal.md#explicit-native-login-pty-opt-in--2026-11-03).
Existing structured manifests remain PTY-blocked. Claude and OpenCode have no factory.
Discovery reports these integration limits separately from executable availability.
Version metadata in a manifest remains owner-supplied, not an inspected protocol
or evidence of native login, model access or provider acceptance.

The independent Core MCP library and Node stdio relay implement a synthetic-only
A -> B -> A path. They are not registered in provider configuration, the Desktop
IPC, Bridge or normal observer startup. Building stages `orqst-mcp-relay.cjs`; it
does not start that helper, open a socket or authorize any provider invocation.
No CLI-specific MCP flags are enabled by this library.

The relay follows the newline-delimited JSON-RPC
[MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#stdio)
and the [tools contract](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
Its deliberately narrow protocol supports `2025-11-25` initialization, initialized
notification, ping, tools/list and tools/call. Other versions/extensions are not
accepted as compatible. It supports neither resources, prompts, sampling, roots,
elicitation, task extensions, push channels nor reconnection.

## Grant and task lifecycle

A trusted native composition must supply distinct owned instance UUIDs, a workspace
identity and an ownership check. It prepares a native challenge covering the exact
source, target, epoch, one-use grant ID, absolute deadline (at most 120 seconds),
4 KiB task and 8 KiB result limits. Only a valid enrolled native signature can
authorize that grant. No MCP client can enroll, change the target, extend a deadline,
mint another grant, start a provider or grant itself a tool.

| Instance | Exposed tools                                     | Core behavior                                                                   |
| -------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| A/source | `delegate_task({task})`                           | One call, fixed B; remains pending until a correlated result or unknown outcome |
| B/worker | `wait_task({})`, `submit_result({taskId,result})` | One delivery and one exact correlated result; cannot delegate                   |

Payload schemas reject extra identity/target/environment fields. Byte limits apply
in addition to schema character bounds. Source-before-worker and worker-before-source
are supported within the same deadline. Delivery is a transport state, not proof of
model execution. Timeout, revoked/lost ownership or authenticated MCP disconnection
produce `unknown`, never success, an invented process exit or an automatic retry.
Completed results stay completed after channel close. Content remains untrusted;
the library never interprets it as a command, approval, authorization or HTML.
Tasks/results live only in memory in this increment; crash recovery is unavailable.

The task broker has no PTY handle or write method. Only the independently authorized
native keyboard/paste path can forward user input. There is no output parser,
synthetic keystroke, permission response or task injection into either TUI.

## Local transport and security review

For the explicit library, Core creates one Unix socket per role inside a new private
canonical temporary directory (`0700`), with socket and capability file modes `0600`.
Socket paths are capped at 100 UTF-8 bytes for macOS. No TCP/HTTP listener, port scan,
observer cookie or external server attachment exists. Windows is unsupported.

Each slot gets an independent random capability. Only a capability-file **path** and
socket **path** are supplied to the relay in `ORQST_CAP_FILE` and `ORQST_SOCKET_PATH`.
The secret itself is never put in argv, inherited environment or diagnostics. The
relay opens only that canonical private single-link regular file with `O_NOFOLLOW`
and checks its owner/mode/size. Socket canonical path, type, owner, mode and identity
are checked before secret transmission. Authentication is a private-stream handshake
with a constant-time hash comparison; role/instance scope comes from the server-side
grant, never caller arguments. Each role admits one authenticated connection and
does not reconnect. Bad unauthenticated attempts cannot revoke a valid grant.

Handshake time is bounded, as are connection/attempt/request counts, frames, pending
tool calls and task lifetime. EOF, malformed/oversized records, repeated IDs or
unsupported cancellation close the relay; uncertain effects are not retried. Cleanup
removes only this disposable transport's own files after closing its listeners.
A crash can leave private files behind; there is no automatic adoption or cleanup
of previously discovered transport roots. No provider credential is read/copied,
and no generated capability is a provider authentication credential.

This is a native same-user contract. Node has no portable peer-credential API here;
private filesystem permissions plus the capability authenticate the local stream.
They are not a defense against a malicious process running as the same OS user,
an immutable executable binding or a filesystem/network sandbox. Directory/socket
checks cannot remove every same-user replacement race. This listener is explicitly
outside the observer network surface and requires native composition review before
provider integration; a loopback HTTP fallback is not silently enabled.

## CLI differences and remaining gates

No installed CLI version is newly admitted by this increment. Review of upstream
mechanisms is a design input, not compatibility or login evidence:

| CLI         | Existing-login boundary                                                                                                                                                                                      | Per-invocation MCP / idle-worker issue                                                                                                                                  | Current status                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Codex       | The structured path can retain native HOME/CODEX_HOME; interactive PTY reuse has an explicit synthetic-only opt-in with shared native session writes. TUI session writes must not be described as ephemeral. | Native configuration can merge user MCPs; every exact flag, timeout and TUI worker mechanism needs installed-version evidence.                                          | Separate-login and explicit native-reuse PTY fixtures; real provider unvalidated |
| Claude Code | Preserve native identity/Keychain selection; do not substitute CLAUDE_CONFIG_DIR or inject API keys.                                                                                                         | Proposed per-invocation strict MCP configuration/session UUID and optional preview channels need separate version/permission validation. Preview flags are not enabled. | No managed adapter or compatibility claim                                        |
| OpenCode    | Preserve native auth/config/data identity; a Codex environment that replaces XDG roots is unsuitable.                                                                                                        | Proposed per-invocation configuration merges and timeouts require exact-version evidence; no headless server is adopted.                                                | No managed adapter or compatibility claim                                        |

The proposed portable B worker starts with a separately authorized initial argv
prompt instructing it to wait/execute/submit via MCP. That is a proposal, not an
implemented CLI start or guarantee of compliance. Any preview push/channel feature
needs its own grant and validation. The Core must still enforce identity, role,
deadline and one-use semantics regardless of native tool allowlists.

Next independent work is exact binary/hash/version and offline flag/schema evidence
per adapter, followed by a specifically authorized no-task native TUI/MCP acceptance,
then separately authorized inference/delegation. Shared native configuration, MCPs,
session writes and auth refresh need explicit disclosure. None of these steps may
rewrite/adopt external sessions, copy credentials, bypass `ownership_lost`, delete
old reservations or infer an exit. Earlier reservations remain intact.

## Reproduction and evidence limits

```bash
pnpm exec tsx --test tests/terminal-mcp.test.ts tests/terminal-mcp-qa.test.ts
pnpm accept:terminal-pair --authorize-synthetic-pty
```

The MCP fixture runs two actual Node stdio relay children with disposable Unix
endpoints, native signatures and a synthetic MCP client. It checks role/target/
byte/single-use enforcement, correlated return, timeout/lost ownership, private
files, bad-secret denial and absence of the generated secret from stdio/argv.
This is functional transport evidence, not two actual provider agents, delivery to
an idle CLI, human modal/accessibility acceptance or inferred model success.

Final native acceptance remains qualified: an earlier two-window transport run
passed, while the repeated final Electron run stopped at the real native-focus
precondition before any CLI start. The gate was retained; no focus mock, process
retry or provider run was introduced to replace that refusal. Independent Node,
Unix-socket and stdio fixtures do not establish human/native focus acceptance.

### Reviewed next adapter contracts — 2026-11-03

The [official Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
and [MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) were reopened.
They describe stdio command/args/environment, tool timeouts and per-server enable
controls. Native tables merge: adding an ORQST server does not disable inherited
servers. The offline official `rust-v0.162.1` source was also inspected at commit
`092d3acd6bec3e3a14bdc7e7a2810ab628ab759d` for foreground TUI selection. No provider
was executed to perform this review. Shared session writes require their distinct
manifest acknowledgment; prompt-history suppression is not session isolation.

The [Claude Code MCP guide](https://code.claude.com/docs/en/mcp) documents local
stdio servers, runtime-specific retry/timeout behavior and channels. The
[OpenCode MCP guide](https://opencode.ai/docs/mcp-servers/) documents local command
arrays, environment and merged configuration. These official mechanisms justify
further adapter work; they do not establish installed-version compatibility,
native identity preservation or idle-worker delivery. No Claude/OpenCode factory,
preview channel or headless fallback is enabled by this delivery.

The next concrete provider/MCP gate is a specifically authorized native Codex
no-task TUI/stdio handshake on an unlocked console with a fresh disposable project,
then separately authorized inference/delegation. The Desktop still has no wired
per-instance MCP grant/relay composition. An ordinary human TUI start cannot count
as A-to-B-to-A acceptance. Existing reservations/quarantines remain unchanged.
