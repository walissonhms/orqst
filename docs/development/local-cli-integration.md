# Existing local CLI integration — 2026-11-03

ORQST should use the owner's installed Codex, Claude Code and OpenCode CLIs and
their existing native authentication when available. It must not require duplicate
installation or login by default. This is product direction, not a claim that all
three managed adapters or credential reuse are implemented.

## Implemented passive preflight

With the repository's Node 24/pnpm 10 toolchain, run:

```bash
pnpm terminal:discover
```

This developer command inspects only executable filesystem metadata in the current
process's PATH. It resolves symlink launchers to canonical files, preserves PATH
priority and deduplicates targets. It ignores empty/relative PATH entries and never
searches project files, session roots, credentials, shell profiles or the Keychain.
It does not execute even `--version`, authentication-status or help commands, install
anything, create homes, start a server, or connect to an existing process.

The JSON report contains up to 16 candidate launchers/targets per provider, null
version, unknown authentication and no execution authority. Scanning is capped at
128 unique absolute directories and 32 KiB of PATH. Truncation/errors produce limited
inspection; oversized input fails before inspection. `not_found` means not found in
this bounded PATH inspection, not absent from the machine. Finder-launched Desktop
may have a different PATH; this command does not source a login shell to repair it.
Windows launcher discovery is not implemented.

A candidate can be a shim, incompatible binary or untrusted file. Metadata is not
native-binary admission, authentication, model access, provider readiness or a new
adapter capability. Multiple canonical candidates require explicit selection. The
existing setup still hashes and validates the selected native binary before writing
private state. Nothing in the report may be passed as a grant to execute it.

Each provider also receives a fail-closed integration plan: `reuse_existing`, no
automatic install/login, provider-owned credentials and explicit blockers. The plan
is informational and contains no executable command, environment or token. It has
no Bridge, dashboard, IPC or provider-dispatch endpoint.

## Official mechanisms and remaining boundary

The following primary sources were opened on 2026-11-03. They describe upstream
mechanisms, not support established against the installed versions.

| Provider    | Native authentication evidence                                                                                                                                                                                                                                                           | Isolation consequence / ORQST status                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | [Authentication](https://learn.chatgpt.com/docs/auth?surface=cli) describes cached file/OS-store credentials and automatic refresh. [Environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables) places auth, config, logs and sessions under `CODEX_HOME`. | Changing homes cannot be assumed to reuse login. Sharing the existing home cannot be called physically isolated or immutable. `CODEX_SQLITE_HOME` moves SQLite state only. The structured library can explicitly reuse the existing native home with new ephemeral threads and private SQLite/log/temp paths. This shares native config/auth and is not physical isolation. PTY reuse now has a separate explicit synthetic-only opt-in acknowledging shared native session writes. |
| Claude Code | [Authentication](https://code.claude.com/docs/en/authentication) describes reuse of earlier sign-in and macOS Keychain/file fallback; `CLAUDE_CONFIG_DIR` also selects credential identity.                                                                                              | Do not silently replace HOME/config directory or query the Keychain. Managed integration and per-instance isolation remain unimplemented.                                                                                                                                                                                                                                                                                                                                           |
| OpenCode    | [CLI authentication](https://opencode.ai/docs/cli/#auth) describes native credential loading and additional environment/project `.env` sources.                                                                                                                                          | Discovery must not enumerate authenticated providers, read credential files or inherit secret environment variables. Version-specific separation of native auth and session/data state remains unverified; managed integration is absent.                                                                                                                                                                                                                                           |

ORQST never copies/symlinks authentication files, exports secrets, injects inherited
tokens, calls logout, refreshes credentials itself or adopts/resumes external sessions.
An eventual approved native CLI may itself refresh its own credentials; do not promise
that its existing auth store remains byte-for-byte unchanged. Existing native login is
not evidence of entitlement to a model or permission to redistribute a provider SDK
login experience. Provider product/SDK terms need a separate review before that path.

## Structured Codex reuse

`terminal:setup` keeps `reuse-existing` as its default policy. Provisioning now
requires `--acknowledge-shared-native-config` for that path, along with an exact
binary/version/project/new state. Without acknowledgment it still writes nothing.
`--user-home` and `--codex-home` select existing canonical directories; defaults are
the OS user home and the current `CODEX_HOME` (or `~/.codex`). ORQST validates only
these directories, never authentication files or Keychain entries.

Each new slot retains a private manifest/journal, SQLite/log directory and temporary
directory. The structured host starts its own admitted executable over stdio, keeps
the native user HOME/CODEX_HOME and does not override the credential backend. It
forwards no inherited environment tokens, loader variables or SSH agent. The native
CLI alone resolves and may refresh its login. After initialization, `account/read`
with `refreshToken:false` must report a supported native `chatgpt` or `apiKey`
account before thread creation; ORQST retains only a status, dropping identity/plan
fields. Missing/unsupported authentication fails without a login attempt or task.
This reports native login availability, not model entitlement or a fresh provider
validation.

Each instance requests a **new ephemeral thread** and requires the native response
to confirm it. Model fallback is disabled and the exact returned model is checked.
No list/resume/fork/adoption operation is exposed. Each instance owns a new process
and retains distinct instance, pane, slot and thread identities. No existing session is rewritten.

Native overrides request private SQLite/log paths, no history, hooks, remote plugin catalog, shell snapshots,
memories, native multi-agent tools, analytics, feedback, tracing or update checks.
Shell subprocesses inherit no environment by default. These controls are native
configuration, not a filesystem/network sandbox or a promise of zero shared writes.
The native auth/config/skills/cache/requirements roots remain shared and native
startup or refresh can write there. Same-user access and provider restrictions still
apply. MCPs configured in native user configuration can start and remain in that
trusted native configuration boundary. **An empty `mcp_servers={}` override does not
disable inherited MCPs**, and `mcpServerStatus/list` can itself start them. ORQST
uses neither as a safe discovery/isolation mechanism and does not inspect full
configuration responses that may contain secrets. The acknowledgment binds this
shared-state consequence into the inspectable signed manifest; it must not be
presented as an isolated credential store.

Reuse manifests are rejected by the legacy PTY profile builder. They are only for
the explicit structured path (including the native-confirmed
[Desktop client](managed-agents-client.md)), never automatic Desktop/Bridge startup.
`--authentication separate-login` keeps the earlier opt-in experiment unchanged;
it is not the default requirement. No pending login state is replaced or deleted.

The installed native Codex `0.162.1` version/help and generated protocol declarations
were inspected offline on 2026-11-03. A disposable no-credential native probe confirmed
new ephemeral thread responses and the inherited MCP behavior above. That probe
started no inference. Runtime tests still use synthetic transports. The single authorized native run
subsequently failed before first-thread readiness and before task submission;
real login, model access and A-to-B-to-A acceptance remain blocked. See the
[two-agent command](codex-two-agent-acceptance.md), including `--prepare-only`.

## Next acceptance with the installed CLI

1. Review the passive candidate paths locally, then approve the exact canonical
   binary/hash/version and offline compatibility operations. Paths/version strings
   alone cannot prove the installed protocol. Keep evidence outside Git.
2. Establish a provider-specific official contract that retains native authentication
   and creates two distinct owned identities without resuming external sessions.
   Review the disclosed shared config/MCP/refresh/cache effects and the native
   overrides; the implemented reuse contract does not offer complete physical
   separation. Do not replace it with token copying.
3. Fixture-test that contract, then approve the exact native start, model, cost scope
   and owned cleanup. No status/login/provider call is authorized by discovery.
4. Verify two process/thread identities, scoped A-to-B dispatch, B completion and
   correlated automatic return to A; verify exit/uncertainty and preservation of
   external processes/sessions. The Desktop two-terminal composition now exists;
   real-provider acceptance of that surface remains pending.

The tests cover synthetic filesystem lookup, aliases, duplicates, incomplete scans,
ambiguous candidates, inaccessible synthetic credentials, no CLI execution and the
default setup's absence of writes without the shared-config acknowledgment. Additional
fixtures cover unavailable/unsupported native login, ephemeral confirmation,
identity-field exclusion, private state paths and denial of the legacy PTY path.
They do not validate any real authentication or two-agent provider workflow. The observer, its ingestion and provider descriptors
are unchanged.

The private `<state>/codex/config.toml` is an admission canary in reuse mode,
not the native user's active configuration. The host argv and confirmed thread
response establish the requested defaults; the canary does not select a credential
backend for reuse. Disabling `features.remote_plugin` disables the remote catalog,
not every installed plugin. Shell snapshots are separately disabled. Native config
drift is not hashed or inspected. A same-user read-only process can still read
credentials and MCP tools are outside the command sandbox; prompt prohibitions
and observed item checks are evidence gates, not prevention of credential reads.
No credential file is hashed to prove immutability, since that would read it.

## Interactive pair boundary

The native Desktop now supports up to two identified xterm/PTY windows through one
Node Core, separate per-slot journals and a shared sticky reservation with structured
Managed agents. This is implemented and synthetic-fixture validated for the explicit
legacy Codex separate-login path and the [explicit native-login PTY opt-in](managed-codex-terminal.md#explicit-native-login-pty-opt-in--2026-11-03). Existing structured manifests open blocked
PTY views without Core/journals or automatic login unless that additional opt-in is present. Claude/OpenCode remain unavailable.
See [pair admission and receipts](managed-codex-terminal.md#two-interactive-windows-and-shared-admission).
PTY interaction and a future per-instance MCP task/result channel are distinct:
MCP does not create a TUI or prove that an idle CLI will accept/execute a task. No
terminal output parser or programmatic task text injection is used for delegation.
