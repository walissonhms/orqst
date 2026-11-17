# Rust managed-terminal pilot (`ORQST_RUST_TERMINALS=1`) — reference research

Date: 2026-11-06. Read-only research (AGENTS.md §13). No repository file was edited.
ORQST tree inspected: `/Users/walissonhmsouza/developer/orqst-frontend-768`, branch
`feat/frontend-768`, HEAD `d15cf0a2ccda147fafe439e74649586f2d8f6b97`.
Disk at start: 17 GiB free (92 % used) — keep Rust builds serial, reuse the coordinated Cargo target.
No Rust toolchain is on PATH (`cargo`/`rustc` not found); nothing below was compiled or executed.
Everything is from reading source.

## 0. Key finding first

The PTY is **not** owned by `tauri-terminal-host.ts`. Today's chain is four processes:

```
Tauri Rust (terminal.rs)  --stdin/stdout NDJSON-->  orqst-node: core/tauri-terminal-host.cjs
  (apps/desktop/src/tauri-terminal-host.ts: layout, features, i18n, terminal HTML, ed25519 signer,
   TauriTerminalService/NativeBroker, CLI policy store)
    --fork IPC (json)-->  managed-terminal-core.cjs  (packages/core/src/terminal/host.ts:
                          TerminalAuthority, ManagedTerminalPair/TerminalSupervisor, SQLite journal,
                          admission marker, MCP sockets/hub)
      --fork IPC + fd 4-->  managed-terminal-host.cjs  (built from packages/core/src/terminal/pty-host.ts,
                            scripts/build-tauri-resources.mjs:65) -> node-pty 1.1.0 -> CLI
```

There is no `apps/desktop/src/managed-terminal-host.ts`; the "managed-terminal-host" artifact is
`pty-host.ts`. The PTY leaf is ~120 lines; everything else (supervisor, authority, journal, admission,
receipts, MCP, layout, features, HTML) is Node Core. AGENTS.md §4 says "Rust is for native
integration, not a rewrite of the Core" and §3 forbids replacing `node:sqlite`. A Rust port of the
supervisor/journal would collide with both; the owner's 2026-11-06 pilot approval should be read
against them explicitly (see §5 recommendation).

## 1. Reference repositories

| Repo   | Clone                            | SHA (pinned)                               | Commit date | License                                |
| ------ | -------------------------------- | ------------------------------------------ | ----------- | -------------------------------------- |
| Anywh  | `orqst-reference-753/anywh-753`  | `0866169043ce162c4c1ba140ca2167549f8d72d4` | 2026-11-06  | Apache-2.0 (`LICENSE`), no NOTICE file |
| Tucano | `orqst-reference-753/tucano-753` | `c321b30789bf0c399db9a7703f56c0fc8e3e336b` | 2026-11-06  | Apache-2.0 (`LICENSE`), no NOTICE file |

### 1.1 Anywh — PTY is Node, not Rust

- `relay/src/host/terminalSession.ts` `spawnTerminal()` (l.87–120): `pty.spawn(TMUX_BIN, ["-L", socket,
"-f", "/dev/null", "new-session", "-A", "-s", name, ...])`, `name: "xterm-256color"`. node-pty
  `^1.1.0` (`relay/package.json:28`). Persistence = tmux; closing WS sends SIGHUP = tmux detach.
  `killTerminal()` (l.141) = `tmux kill-session`; `killAllTerminalsForSession()` (l.183).
- Process-group cleanup for agents (non-PTY, stream-json): `relay/src/agentHost/claudeProcess.ts`
  `spawn(..., {detached: true})` (l.161); stop = SIGTERM pid + `-pid`, grace, SIGKILL `-pid` (l.228–261).
  `relay/src/agentHost/processTree.ts` header (l.1–22): documents that Claude's Bash tool puts commands
  in their _own_ session, so `kill -- -pgid` misses them; Anywh adds an env mark
  `ANYWH_AGENT_MARK` and sweeps `/proc/<pid>/environ` — **Linux only** (`agentProcessMap`, l.86–89
  returns empty on non-Linux). On macOS only the group is covered.
- Tauri side (`client/src-tauri/Cargo.toml`): no PTY crate; `tokio` with `process`. Sidecar lifecycle
  `client/src-tauri/src/tailnet_sidecar.rs` `kill_all()` (l.318) on `RunEvent::Exit` (already cited by
  ORQST `apps/tauri/src-tauri/src/sidecar.rs:2`).
- MCP: `relay/src/bridges/mcpBridge.ts` (l.212–333) — hand-rolled minimal MCP **Streamable HTTP**
  (`initialize` → `notifications/initialized` → `tools/list` → `tools/call`) mounted on the relay's own
  HTTP server at `/mcp/:token`, passed to Claude by `--mcp-config` (`runtimes/defs/claude/session.ts:444`).
  No MCP SDK dependency.
- **Decision:** PTY — _do not use_ (Node + tmux; no Rust PTY to reuse; tmux persistence contradicts
  ORQST's owned-handle/no-adoption model). Process-group stop sequence — _adapt the idea_ (SIGTERM
  pid+group → grace → SIGKILL group) but note the macOS gap; the `/proc` sweep is not portable.
  MCP — _keep ORQST_ (ORQST already has a reviewed stdio relay + private Unix socket + capability file;
  Anywh's HTTP route would need a loopback HTTP listener and token routing, a security-model change).

### 1.2 Tucano — Electron, no PTY at all

- `package.json`: `electron ^44.8.0`, `@modelcontextprotocol/sdk ^1.32.1`; no node-pty.
- CLIs are pipes: `src/core/engines/cli.ts` `spawn(..., stdio: ['pipe','pipe','pipe'])` (l.24, l.81).
- Kill: `src/core/platform.ts` `killTree()` (l.193) = `process.kill(-pid, signal)` with `detached: !isWin`
  at spawn (`src/core/mac.ts:131,279`); `mac.ts:230–238` SIGTERM group → SIGKILL.
- MCP: `src/core/gateway.ts` uses the SDK `Server` + `StreamableHTTPServerTransport`;
  `src/core/connectors.ts` uses SDK clients. `src/core/harness-mcp.ts` only reads existing harness configs.
- **Decision:** _do not use_ for PTY (none). Group-kill pattern same as Anywh. MCP SDK — _do not use_
  (HTTP gateway, different trust model).

Conclusion: neither reference owns a PTY in Rust. There is nothing to reuse directly for the Rust PTY;
the closest proven implementation remains ORQST's own `pty-host.ts` + node-pty.

## 2. Rust crates (crates.io API, 2026-11-06; sources downloaded to `orqst-reference-753/crates-753`)

| Crate              | Version                                                                | License                                             | Last publish            | Apache-2.0 compatible                | Decision                                                               |
| ------------------ | ---------------------------------------------------------------------- | --------------------------------------------------- | ----------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| portable-pty       | 0.9.0 (vcs `f8921727a11b9f8b073e8c24821d72fd41283500`, wezterm `pty/`) | MIT                                                 | 2025-02-11 (~21 months) | yes (MIT; keep its copyright notice) | **adapt with care** — see pitfalls                                     |
| ed25519-dalek      | 3.0.0 (MSRV 1.85)                                                      | BSD-3-Clause                                        | 2026-07-06              | yes                                  | use only if Rust must sign/verify Core challenges                      |
| rmcp               | 3.9.0 (vcs `5596a8a0bba2a1ec5519cc855cdadf23e4dcecdc`, MSRV 1.88)      | Apache-2.0                                          | 2026-11-05              | yes                                  | **do not use** for pilot                                               |
| serde / serde_json | 1.0.229 / 1.0.154                                                      | MIT OR Apache-2.0                                   | 2026                    | yes                                  | use (serde_json already a dep)                                         |
| tokio              | 1.54.1                                                                 | MIT                                                 | 2026-10-21              | yes                                  | already a dep (`sync`,`time`); add `process`,`io-util`,`net` as needed |
| libc               | 0.2.191                                                                | MIT OR Apache-2.0                                   | 2026-10-16              | yes                                  | use for `kill`/`killpg`/`waitpid`                                      |
| nix                | 0.31.3                                                                 | MIT                                                 | 2026-05-11              | yes                                  | optional; portable-pty pins `nix 0.28` (duplicate version)             |
| rustix             | 1.1.6                                                                  | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | 2026-10-27              | yes                                  | alternative to libc                                                    |

### portable-pty 0.9.0 — verified behaviour (macOS/unix, `src/unix.rs`, `src/lib.rs`, `src/cmdbuilder.rs`)

- `openpty()` (unix.rs:22) via `libc::openpty`; master+slave set `FD_CLOEXEC` (unix.rs:63–65, 316).
- `spawn_command` (unix.rs:228–296) `pre_exec`: resets SIGCHLD/HUP/INT/QUIT/TERM/ALRM to default,
  clears the signal mask, **`setsid()`**, **`ioctl(0, TIOCSCTTY)`** when `controlling_tty` (default
  true; the code comment notes SIGWINCH depends on it), `close_random_fds()` (unix.rs:152), optional umask.
  Equivalent outcome to node-pty 1.1.0 on macOS, which uses `posix_spawn` + `POSIX_SPAWN_SETSID`
  through `spawn-helper` (`node-pty/src/unix/pty.cc:706`).
- Resize (unix.rs:180–197): `ioctl(TIOCSWINSZ)` on master; kernel delivers SIGWINCH to the
  foreground group. Same as node-pty `pty.resize` (`pty.cc:522`).
- `process_group_leader()` = `tcgetpgrp(master)` (unix.rs:374) — useful for diagnostics only.
- Pitfalls (all verified in source):
  1. **`ChildKiller::kill` is not SIGTERM/SIGKILL.** Unix impl (lib.rs:340–370) sends **SIGHUP**,
     polls `try_wait` 5×50 ms (blocking `thread::sleep`), then SIGKILL — **to the pid only**. ORQST's
     contract is exact `SIGTERM | SIGKILL` (`pty-channel.ts`, `rpc.ts`). Use `libc::kill(pid, sig)`
     directly; never call `ChildKiller::kill`.
  2. **Exit status loses the signal number.** `From<std::process::ExitStatus>` (lib.rs:208–233) maps a
     signal to `strsignal()` _text_ and forces `code = 1`. ORQST needs numeric `exitCode` + `signal`
     (`managedTerminalEventSchema`) and receipt `signal: "SIGTERM"` (`lifecycle-receipt.ts` regex
     `^SIG[A-Z0-9]{1,29}$`). Own `waitpid` (downcast `Box<dyn Child>` to `std::process::Child`
     — `impl_downcast!(Child)` lib.rs:147 — and use `ExitStatusExt::signal()`), mapping numbers to
     names with a fixed table. node-pty reported `exitCode`/`signal` separately.
  3. **cwd silently falls back to `$HOME`** if the path is not a directory (cmdbuilder.rs:501–507).
     ORQST must pre-verify `profile.cwd` (realpath/no-symlink) and refuse, never fall back.
  4. **`SHELL` is always injected** into the child env, even after `env_clear()` (cmdbuilder.rs:528–529).
     This changes the reviewed environment profiles (`interactiveTerminalEnvironment`). node-pty only
     sets `TERM` from `name` (`unixTerminal.js:61–62`). Either accept and document a profile change
     (would alter `cliAuthorizationScope`/permission text) or bypass `CommandBuilder` (custom
     `openpty` + `std::process::Command` + `pre_exec`, ~60 lines, keeping the same setsid/TIOCSCTTY).
  5. `wait()`/reader are blocking — one OS thread per PTY for read and one for wait (or
     `tokio::task::spawn_blocking`). Bound output chunks (pty-host splits at 16 KiB code units).
  6. `args[0]` is resolved through `search_path` (cmdbuilder.rs:514); pass the absolute reviewed
     executable path so no PATH lookup happens.
  7. Stale upstream release (Feb 2025) and pinned `nix 0.28` duplicate.
- Recommendation: copying ~150 lines of `openpty`/`pre_exec` logic with MIT attribution (adapt) is
  smaller and fixes pitfalls 1–4; or depend on the crate and only use `openpty` + `MasterPty` (resize,
  reader/writer) while spawning with our own `Command`. Either needs a NOTICE/provenance entry.

### Process-group cleanup on macOS (both node-pty and portable-pty)

- The CLI is a session + group leader (setsid). Signalling `-pid` reaches the group; tools that call
  `setsid` themselves escape (documented by Anywh `processTree.ts:1–22`). ORQST's own permission text
  already says "no descendant containment" (`interactive-profile.ts` claude profile). A Rust port must
  not claim more. Current ORQST signals the **pid only** (`pty-host.ts` → `child.kill(signal)` →
  node-pty `process.kill(this.pid, signal)`, `unixTerminal.js:228`); switching to group signalling is a
  behaviour change that needs its own decision and tests.
- The 30-minute owned-process deadline (SIGTERM → 5 s → SIGKILL, `pty-host.ts` `lifetime`) must be
  carried over.
- App quit: today Rust kills the Node host via `tauri-plugin-shell` child (`sidecar.rs:284`) and Node
  `owned-shutdown.ts` does SIGTERM through signed `stop`. If Rust owns PTYs, quit must run the same
  owned-shutdown inventory/exit-pending path, otherwise the reservation is left uncertain.

### MCP: rmcp vs plain JSON-RPC

- Current ORQST MCP: CLI launches `orqst-mcp-relay.cjs` (`mcp-relay.ts`) as a **stdio** MCP server
  (hand-written JSON-RPC 2.0; protocol versions `2025-06-18`, `2025-11-25`; `initialize`,
  `notifications/initialized`, `tools/list`, `tools/call`), which connects to a private **Unix socket**
  - 0600 capability file opened by Core (`mcp-socket.ts` l.97–203, `mcp-hub-socket.ts`
    `openHubEndpoint`). Launch shape `terminalMcpLaunchSchema` (`mcp-launch.ts`): `serverName
orqst_<32hex>`, `socketPath`, `capabilityFile`, `relay {path, sha256}`; the relay sha256 is part of the
    reviewed profile (`interactive-profile.ts` "MCP relay changed").
- rmcp 3.9.0 default features `base64, macros, server`; pulls `schemars`, `chrono`, `rmcp-macros`;
  MSRV 1.88. It would only replace the stdio relay _or_ the socket server, each already small and
  reviewed. The relay is a separate binary whose sha256 is pinned in profiles; rewriting it changes
  every MCP `cliAuthorizationScope` review. **Decision: do not use for the pilot; keep the Node relay
  and the existing socket protocol.** If the hub moves to Rust later, a plain newline JSON over
  `tokio::net::UnixListener` matching `mcp-socket.ts` framing is simpler than rmcp.

## 3. Current Node implementation map

### packages/core/src/terminal

Stage 1 (one PTY spawn/write/resize/stop to existing xterm):

- `pty-host.ts` — the leaf: node-pty spawn, 16 KiB chunks, backpressure (`pause/resume`), receipt
  `armed→started|spawn_failed→exit`, 30-min deadline. **Primary port target.**
- `pty-channel.ts` — private IPC schemas (`write` ≤4096, `resize` 20–300×5–100, `signal`
  SIGTERM|SIGKILL; events `started`, `data` ≤64 KiB, `exit{exitCode,signal?}`).
- `pty-backend.ts` `managedTerminalBackend()` — revalidates profile/config digest, creates receipt
  (fd passed as fd 4), forks pty-host, maps events, `lost()` = uncertainty (never exit).
- `../managed-codex/lifecycle-receipt.ts` — receipt file format (see §4).
- `supervisor.ts` `TerminalSupervisor` — policy (limits, leases, rates, replay 1 MiB), state machine,
  `TerminalBackend`/`OwnedTerminalHandle` interface. `output.ts` `TerminalOutput` — byte ring + cursor.
- `authority.ts` — challenge bytes `["orqst.terminal",version,epoch,clientId,challengeId,expiresAt,
operation,target,digest]`, ed25519 verify (Node `crypto.verify`).
- `rpc.ts` — Core pair RPC (`terminalRPCSchema`, `terminalPairRPCSchema`, `terminalPairReadySchema`).
- `host.ts` — Core child entry (stores, admission, pair, MCP endpoints). `managed-pair.ts`,
  `native-broker.ts` (`TerminalNativeBroker`), `identity.ts`, `managed-files.ts`, `startup-failure.ts`.

Stage 2 (profiles, CLI policy, launch argv/env, MCP):

- `interactive-profile.ts` `interactiveTerminalProfiles()` / `interactiveTerminalEnvironment()` (Claude
  v2 inline; dispatch to Codex v1 / OpenCode v3), `readInteractiveTerminalConfig()`.
- `codex-profile.ts` (`managedCodexConfigSchema`, `terminalFile`, `terminalExecutableSha256`),
  `opencode-profile.ts`, `opencode-launch-plan.ts`, `interactive-adapters.ts`, `model-selection.ts`,
  `local-cli.ts`, `local-cli-path.ts` (`terminalToolPath`), `provider-mcp-config.ts`
  (reviewed binaries; Claude/OpenCode MCP argv), `owned-claude-session.ts`, `owned-claude-hooks.ts`.
- `cli-authorization.ts` `TerminalCliPolicyStore.authorizeCli(profile, review, reviewExpansion)`
  (l.129–165): file `cli-authorizations/<sha256(executable)>.json` (0600, nlink 1, ≤4096 B, schema
  `{version:1, scope:'owned-local-terminal-v1', executable, executableSha256, authorizationEpoch,
permissionScope, state}`); `permissionScope = sha256(JSON[environmentProfile, cliAuthorizationScope])`;
  scope change on an allowed record = **expansion** → requires `reviewExpansion` (native sheet
  `terminalNative.cliScopeExpansion`, `tauri-terminal-service.ts:178`); revoked stays revoked.
- MCP: `mcp-launch.ts`, `mcp-relay.ts`, `mcp-socket.ts`, `mcp-hub.ts`, `mcp-hub-socket.ts`,
  `mcp-hub-journal.ts`, `mcp-task.ts`, `mcp-communication.ts`, `interactive-mcp.ts`.
- Not needed for stages 1–2: `offline-*`, `exit-pending.ts`, `owned-shutdown.ts`, `layout-database.ts`,
  `team-database.ts`, `feature-configuration.ts`, `composer-mentions.ts`, `account-limits*`,
  `owned-turn-*`, `enrollment-files.ts` (stage 3+: they must interoperate, see §4).

### apps/desktop/src (_terminal_)

- `tauri-terminal-host.ts` — Rust-facing host process (args: files JSON, admission dir, operationalOpen,
  startupId, names); builds ed25519 keypair, Core, service, layout, features; emits `ready`.
- `tauri-terminal-service.ts` — `tauriTerminalMessageSchema` handler, native confirmations, CLI policy,
  retirement, owned shutdown. `managed-terminal-core.ts` `connectManagedTerminalCore()` — forks Core.
- Layout/visual: `tauri-terminal-layout.ts`, `terminal-layout*.ts`, `terminal-panels.ts`,
  `terminal-document.ts` (pane HTML), `terminal-fence.ts`. Preparation/creation:
  `tauri-terminal-preparation*.ts`, `terminal-creation.ts`, `terminal-catalog.ts`,
  `terminal-discovery.ts`, `terminal-selection.ts`. Retirement: `tauri-terminal-retirement.ts`.
  Batch: `tauri-terminal-batch.ts`. Renderer side: `managed-terminal.ts`, `managed-terminal-client.ts`,
  `terminal-client.ts`, `terminal-runtime.ts`, `terminal-preload.ts`, `terminal-sender.ts`,
  `terminal-confirmation.ts`, `terminal-lifecycle.ts`, `terminal-lab.ts`, `terminal-policy.ts`.

## 4. Private contract the Rust side must satisfy (webviews unchanged)

Webview → Rust (unchanged, must stay): Tauri command `terminal_request(window, request)`
(`terminal.rs:1110`), validated against `terminalNativeRequestSchema`
(`packages/protocol/src/terminal-native.ts:10–33`): `open|start{profileId}`, `attach|input{instance}`,
`write{sequence,text≤4096}`, `paste{sequence,text≤16384}`, `resize{columns 20–300, rows 5–100}`,
`read{cursor}`, `snapshot`, `detach`, `stop{signal SIGTERM|SIGKILL}`. Reply
`terminalNativeReplySchema` (l.36–73): `{status: denied|cancelled|busy|focus_required,
authorization?: blocked|revoked}` or `{status:'ok', instanceId, opening?: ready|incomplete,
snapshot?{instanceId,epoch,state,lifecycle?{startedAt,exitedAt?},exit?{exitCode,signal?}},
output?{bytes:number[]≤65536, nextCursor, gap}}`. **Output is pull (`read` with cursor) from a 1 MiB
byte ring**, not push events — the Rust store must keep identical cursor/gap semantics
(`output.ts`). Also `terminal_open_prepared`, `terminal_restore`, `terminal_view` commands.

Rust ↔ Node host pipe (NDJSON over child stdin/stdout, ≤512 KiB/line):

- Rust → host (`tauriTerminalMessageSchema`, `tauri-terminal-service.ts:26–46`): `request{id,slot 0–7,
request,focused,openingAuthorized?}` (built by `native_request_message`, `terminal.rs:1301`),
  `retire`, `shutdownOwned|retireOwned|closePreservedOwned{id}`, `revoke|suspend-input|close{slot}`,
  `confirm{id,accepted}`, `authorizeMcp{id,slot,focused}`; plus visual (`layout-action|suspend|
generation|focus|open|resize`), `enroll`, `enrollment-present`, `feature-request`,
  `feature-permission-request`, `owned-notification-focus` (host l.200–260).
- Host → Rust: `ready{id=startupId, epoch, admissionOwner, initialFiles(=paths), panes[],
pendingOwnedExits?, capacity, layout, i18n strings, mcpEnabled}` (host l.506–550; Rust check
  `terminal.rs:3286`), `reply{id,value}`, `confirm{id,...}` (native sheet request), `retirement`,
  `owned-shutdown`, `owned-shutdown-closed`, `layout|layout-v2`, `feature-state|feature-reply`,
  `enrollment-reply|enrollment-presented`, `owned-turn-alert` (dispatch `terminal.rs:3543–3667`).
- Core ↔ PTY leaf: `pty-channel.ts` schemas + receipt fd 4 (§3).

Implication: under the flag, the cheapest seam that leaves every webview and the Rust↔host pipe
unchanged is the **leaf** (`TerminalBackend.start` → `OwnedTerminalHandle`). Node's IPC channel to a
non-Node child is line-delimited JSON on the inherited fd (Node `child_process` docs), so a small
Rust `orqst-pty-host` executable could speak `pty-channel.ts` unchanged (verify on Node 24 before
relying on it — not verified here). Moving the PTY _into the Tauri process_ instead means Rust must
also serve `write/resize/read/stop` for `request` messages it currently forwards, i.e. reimplement
supervisor leases/rates/ring/journal, which is the Core.

## 5. Risks — formats that must stay byte-compatible

1. **Lifecycle receipt** `<config.state>/lifecycle-<instanceId>.jsonl` (`lifecycle-receipt.ts`):
   `O_CREAT|O_EXCL|O_APPEND|O_NOFOLLOW`, 0600, owner uid, nlink 1, ≤4096 B, fsync file+dir; lines
   `{"type":"prepared","version":1,"binding":{instanceId,epoch,manifestDigest,configDigest},"at"}`,
   then `armed`, `started|spawn_failed`, `exit{code|null, signal "SIGxxx"|null}` in strict order,
   monotonic `at`. Created by Core _before_ dispatch; the leaf only appends via inherited fd and checks
   `configDigest`. `readLifecycleReceipt` validates order. Never delete/reuse.
2. **Reservation marker** `managed-agents/active-pair.json` (`desktop-admission.ts`):
   `{"version":1,"owner":uuid,"manifests":[...],"epoch"?}\n`, `wx` 0600 + dir fsync; byte-exact
   `assertOwner`; companions `enrollment-<owner>-<opId>.json`, `.receipt.json`,
   `retired-<owner>-<uuid>.json`, `exit-pending-<owner>.json` (`exit-pending.ts`, status
   `leader_exited_retirement_pending`), `offline-recovery-operation.lock`,
   `recovered-<op>.marker.json`, `operation-<boot>.lock`. Owner override memory: move only after reboot.
3. **Offline recovery** (`offline-recovery.ts`, `offline-recovery-files.ts`): snapshots hash these
   files _and the directory listing of each journal's state dir_ (`stateNames`, `-shm` identity,
   `assertHeldRecoverySnapshot` l.120–170). **Any new file a Rust runtime writes in `config.state` or
   `managed-agents/` (sockets, logs, receipts with a new name) breaks held recovery comparisons.**
4. **Kernel identity:** only `sysctl -n kern.bootsessionuuid` (`nativeKernelBootUUID`,
   offline-recovery.ts:22) plus per-boot lease files; no PID/start-time proof exists in Core source.
   A Rust runtime must not introduce PID-based adoption; process absence ≠ exit receipt (AGENTS §5).
5. **SQLite journal** `config.state/terminal.sqlite` via `@orqst/database` `terminalJournal`
   (`node:sqlite`). Rust cannot write it without a new SQLite binding (AGENTS §3); keep supervisor in Node.
6. **CLI policy** `cli-authorizations/*.json` + `permissionScope` digest: any change to env profile
   (e.g. portable-pty's injected `SHELL`) or relay sha changes the scope → forces expansion review.
7. **Signals/exit semantics:** exact SIGTERM/SIGKILL to pid (today), numeric exit, `lost()` ≠ exit,
   30-min deadline, backpressure; portable-pty defaults violate the first two.
8. **Platform gate:** host refuses non-darwin/arm64/root/non-Node-24 (`tauri-terminal-host.ts`
   l.42–48); the Rust path must keep equivalent refusals.

### Recommendation

- Stage 1: implement a Rust PTY **leaf** behind `ORQST_RUST_TERMINALS=1` that is a drop-in for
  `pty-host.ts` (same `pty-channel` messages, same receipt fd/format, same limits/deadline), using
  `openpty` (portable-pty or adapted ~150 lines, MIT attribution) + own `Command`/`pre_exec`
  (setsid, TIOCSCTTY), `libc::kill` for exact signals, own `waitpid` for numeric status. Supervisor,
  journal, authority, receipts creation, admission and MCP stay in Node; webviews and the
  Rust↔host pipe are untouched. Decide separately whether the leaf runs as a separate Rust binary
  (fits Core's fork/IPC) or inside Tauri (requires a new private channel from Core to Tauri).
- Stage 2: keep profile/argv/env/CLI-policy/MCP in TypeScript; Rust receives the already-validated
  profile (executable, argv, cwd, env) exactly as `pty-host.ts` does. Porting them would duplicate
  reviewed logic and change permission scopes.
- Not used: rmcp, Anywh tmux PTY, Tucano pipes/SDK gateway. ed25519-dalek only if a later stage moves
  signing/verification into Rust (bytes must equal `terminalChallengeBytes`).

Not verified: any compile/run of the crates; Node 24 IPC with a non-Node child; macOS SIGWINCH
delivery under portable-pty (inferred from TIOCSCTTY + TIOCSWINSZ code, not tested).
