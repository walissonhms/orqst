# Interactive CLIs and per-instance MCP

Current increment: [OpenCode Desktop opt-in](opencode-desktop-terminal.md) supersedes earlier no-factory/absolute launch-refusal statements below. A blocked-by-default review manifest, exact-binary factory and signed Desktop lifecycle are implemented with synthetic evidence only. Native startup/database effects, descendant exit and provider acceptance remain unvalidated.

The subsequent [OpenCode standalone review](opencode-standalone-review.md) adds
an exact-version passive launch candidate and exercises generated Claude/OpenCode
relay commands in both source/worker orders. OpenCode launch remains blocked by
unauthorized native shared-database startup writes and possible pending migrations;
`--standalone` resolves shared-service selection but does not isolate credentials.

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
Existing structured manifests remain PTY-blocked. The new
[Claude native launch opt-in](claude-interactive-terminal.md) adds an exact-version
factory and optional strict MCP selection. OpenCode has no executable factory.
Discovery reports these integration limits separately from executable availability.
Version metadata in a manifest remains owner-supplied, not an inspected protocol
or evidence of native login, model access or provider acceptance.

The Core MCP library and Node stdio relay implement a synthetic-only A -> B -> A
path. An explicit Desktop Codex/Claude PTY opt-in now composes the transport with owned
starts, a native menu grant and per-invocation configuration. The Bridge, renderer
IPC and normal observer startup do not expose MCP authority. Building stages
`orqst-mcp-relay.cjs`; building alone opens no socket or provider.

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

Further provider work requires exact binary/hash/version and offline flag/schema evidence
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

The next concrete provider/MCP acceptance gate is a specifically authorized native Codex
no-task TUI/stdio handshake on an unlocked console with a fresh disposable project,
then separately authorized inference/delegation. Desktop composition now exists
behind the explicit opt-in below. An ordinary human TUI start cannot count
as A-to-B-to-A acceptance. Existing reservations/quarantines remain unchanged.

### Desktop composition opt-in — 2026-11-03

Add `--interactive-mcp` to **each** existing-login `terminal:setup` invocation,
along with `--interactive`, both shared-native acknowledgments and the exact
`--executable-version 0.162.1` label. Both new manifests must select the same
canonical project and separate private state. Start Desktop with the existing two
`--terminal-config=PATH` arguments. This does not provision Claude/OpenCode or
validate the owner-supplied version label against a native protocol.

One Node Core creates one disposable hub per **pair**, with distinct source/worker
endpoints and capabilities. No task grant exists at that point. Each signed start
manifest includes its random `orqst_<32hex>` server name, pinned Node/relay and
endpoint paths. The fixed Codex `-c` override adds this server **alongside** native
MCPs; it does not disable inherited servers or write native configuration. Socket
and capability-file paths appear in the TUI argv; the generated secret does not.
The same-user threat boundary still applies.

`required=true` deliberately fails closed: an ORQST MCP startup failure can block
the interactive terminal's startup. The server uses a 10-second startup timeout
and a 125-second tool timeout around the Core's maximum 120-second grant. There
is no fallback to a TUI without the opted-in transport or to PTY task injection.

After separately confirming both starts, focus a Terminal and select **Authorize
one MCP task A → B → A** from the native menu. Core binds the source and target
to actual dispatched instance UUIDs, workspace and epoch, and requires both to
remain owned and running. The native dialog separately confirms exact grant
metadata. No renderer request can select either identity or supply a proof.
An authenticated relay can initialize/list its fixed tools before this grant;
task calls are denied until authorization. There is one task/result exchange,
without automatic retries, rebinds or new grants on the same pair.

The user/model must explicitly call the source `delegate_task` and worker
`wait_task`/`submit_result` tools after authorization. No initial worker prompt,
idle-worker wakeup, preview channel or provider-tool approval is synthesized.
Exit/loss/disposal of either owned handle invalidates the channel; MCP disconnect
leaves both process lifetimes untouched. Hiding a view only revokes input;
document closure/reload, retirement and Core disconnect invalidate MCP authority.
Completed broker results remain completed; undispatched/uncertain work is never
reported as success. Transport files are disposable; old reservations and external
session files are never adopted, deleted or reconciled.

Synthetic tests compose actual `ManagedTerminalPair`, metadata journals, signatures
and Unix socket clients. Independent tests run two actual stdio relay children.
They cover A → B → A, grant replay/role/correlation/byte limits, loss/disconnection,
no PTY writes and relay/version drift. They do not prove that Codex 0.162.1
negotiates the relay's exact MCP revision, displays tools, reuses login successfully
or completes a task. No installed provider, inference or credentials were used.
Human modal/focus acceptance remains pending an unlocked macOS session.

This composition increment passed `pnpm lint`, `pnpm typecheck`, all 468 Node
tests and `pnpm build` on Node24.22.2/pnpm10.34.9. Independent critical QA passed
29 focused tests and found no security blocker. The existing dashboard chunk-size
warning remains. Native Electron/focus acceptance, full Chromium and
`validate:local` were not run for this slice; observer ingestion did not change.

### Claude/OpenCode configuration builders — 2026-11-03

Core's `terminal/provider-mcp-config.ts` now produces reviewable, non-executable
configuration candidates for the exact passively inspected local binary hashes
of [Claude 2.1.178](../adapters/claude.md#version-scoped-interactive-mcp-configuration--2026-11-03)
and [OpenCode 2.2.5](../adapters/opencode.md#version-scoped-interactive-mcp-configuration--2026-11-03).
Both return blocked execution/not-run acceptance; the interactive factory still
rejects them and observation descriptors stay false. Discovery reports the existence
of a configuration builder separately from installed-version compatibility, which
remains unvalidated. It does not execute either provider or infer its version.

Claude's candidate uses embedded-help-evidenced strict inline MCP and session UUID
flags; its native identity selectors are untouched. OpenCode's candidate uses only
a runtime inline environment document, preserving native HOME/XDG selection and
documenting configuration merges. No initial worker task, tool approval, native
configuration write, new login, inherited secret environment or automatic retry is
added. Exact-version gates and synthetic negative tests reject version/hash drift,
credential/identity/argv injection and unexpected launch descriptor fields.

An input version/hash is a caller claim, not a fresh executable measurement or
execution grant. Native composition must revalidate it at dispatch, bind owned
instances and explicit shared-state acknowledgments, then validate actual
authentication, permissions, protocol, timeout and tool behavior. Those gates
remain open; no new terminal setup command or real-provider support is advertised.

The configuration-builder increment passed `pnpm lint`, `pnpm typecheck`, all
471 Node tests and `pnpm build` on Node24.22.2/pnpm10.34.9. Independent critical QA
approved the pure builders with the strict-MCP/session-ID/launch-gate disclosures
above. No provider, native login/inference, quarantine or existing reservation was
used or changed. Native focus acceptance, full Chromium and `validate:local` were
not run; the unchanged dashboard build retains its existing chunk-size warning.

### Native Claude factory and installed OpenCode schema correction — 2026-11-03

The [native Claude increment](claude-interactive-terminal.md) supersedes the earlier
Claude no-factory and session-collision gates with a hash-pinned, single-dispatch
Desktop manifest and installed-code collision evidence. It also records the corrected
OpenCode 2.2.5 local-MCP schema and the unresolved native TUI/server ownership gate.
OpenCode remains unavailable. Real login, MCP negotiation/tool behavior, positive
native focus and inference/delegation acceptance remain pending for all new paths.

## Native creation is configuration only — 2026-11-03

The Desktop [A/B creation wizard](cli-team-recovery.md) can prepare per-slot MCP
opt-ins without manual manifests. Codex keeps native definitions, Claude strict
selection excludes them, OpenCode merges them and remains startup-blocked. Existing
short private socket roots and timeout/environment builders are unchanged; sockets
are not placed under the long user-data pair path. The wizard dispatches no message
and grants no task authority. Native protocol negotiation, idle/busy delivery and
real A-to-B-to-A processing/return remain unvalidated.
