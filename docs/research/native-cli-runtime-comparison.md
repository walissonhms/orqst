# Native CLI runtime comparison — 2026-11-03

## Evidence and scope

This follow-up inspects actual Git blobs, not product screenshots. Pins remain
Anywh `546f189c04415c3c5af5f40e3931a0a90b9aba31` and Tucano
`0501956d127699300209902e889f3e69a0948766`, as recorded in the
[reuse ledger](reuse-first-audit.md). Both root LICENSE blobs were rehashed to
SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.
No upstream code, dependency script or application was executed. The preserved
historical Tucano audit remains unchanged.

**Observed** below means source inspected at those pins or the named local check.
It does not establish that an upstream application ran successfully on this machine.
The local baseline is `3b2cbfa`: Node 24.22.2, pnpm 10.34.9, Electron 45.2.1,
strict TypeScript 6.0.3, node-pty 1.1.0 and xterm 6.0.0. No dependency upgrade,
parallel runtime, database or credential store is introduced.

## Source comparison and decisions

| Concern                      | Anywh observed code                                                                                                                                                                                                                                                                                                                                                                                                                 | Tucano observed code                                                                                                                                                                                                                                                                                                                                                                                                                           | ORQST decision / remaining limit                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery                    | [`executables.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/executables.ts), `resolveAgentBin`: PATH then `.local/bin`, `.claude/local`, Homebrew and `/usr/local/bin`; unresolved names remain bare. `EXTRA_PATH_DIRS` includes the resolved agent directory.                                                                                                            | [`detect.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/detect.ts), `adoptLoginShellPath` runs the user's shell with `-ilc`; [`platform.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/platform.ts), `withInstallDirs` adds installer directories.                                                                                       | **ADAPT behavior, retain local admission.** One passive directory policy now serves discovery and reviewed child PATHs. No login shell, executable probe or bare-name provider dispatch. Native launch still requires canonical absolute path and SHA-256.                                                                   |
| Environment / authentication | [`childEnv.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/host/childEnv.ts), `buildChildEnv`, copies process.env, removes host configuration and invokes credential stripping. [`executables.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/executables.ts) strips three billed credential names.                          | [`codex.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/codex.ts), `codexEnv`, changes HOME/CODEX_HOME for a separate login; `userCodexProvider` reads native configuration. [`claude.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/claude.ts), `userProvider`, reads settings and forwards provider environment/helper choices. | **KEEP-EXISTING whitelist/native identity.** Copying the broad environment or configuration extraction would change credential exposure. New PATH support does not inherit API keys, loaders, shell profiles or arbitrary environment variables. Native credentials remain exclusively provider-owned.                       |
| PTY / terminal transport     | [`terminalSession.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/host/terminalSession.ts), `spawnTerminal`, uses node-pty to start a tmux session, with a separate socket and `-f /dev/null`; [`ws/terminal.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/ws/terminal.ts) forwards data/input/resize and detaches on socket close. | [`cli.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/cli.ts), `runCli`, uses ordinary stdin/stdout/stderr pipes and a JSONL parser. These inspected engines are a chat execution path, not a PTY TUI.                                                                                                                                                                                   | **KEEP-EXISTING** private pinned Node host, node-pty and bounded IPC. Electron does not load the native PTY addon. No tmux/service dependency or wholesale replacement is needed to correct PATH.                                                                                                                            |
| UI integration               | [`TerminalView.tsx`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/terminal/TerminalView.tsx) owns xterm/FitAddon/WebSocket, reconnect and resize debounce. Terminal tabs are separate from structured agent turns.                                                                                                                                                         | [`Conversation.tsx`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/renderer/src/components/Conversation.tsx) renders messages/run steps and `stopRun`.                                                                                                                                                                                                                                                   | **KEEP-EXISTING** main-window WebContentsView A/B panels, layout controls and sender/focus leases. No copied renderer, remote transport or parallel screen. The current Create wizard still selects executables with native file choosers; the new developer discovery output is not an automatic graphical CLI picker.      |
| Lifecycle / recovery         | tmux provides a distinct surviving process owner and supports explicit terminal close. Claude's [`session.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/claude/session.ts) uses a process per turn and `--resume` for native continuity. Those are different mechanisms.                                                                                             | `runCli` races process errors/close through its wrapper, supports abort and bounded TERM/KILL; the app rebuilds per-turn context. [`opencode-v2.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/opencode-v2.ts) owns a private server and stops it separately.                                                                                                                           | **KEEP-EXISTING** ownership identities, launch attempts, journal fencing and uncertain outcomes. Hiding a UI is not stop; PTY creation is not login/task readiness. No process adoption, PTY resurrection or automatic replay is added. Existing sticky reservations/recovery restrictions remain.                           |
| Codex compatibility          | [`codexDriver.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/codexDriver.ts) implements app-server turns and RPC.                                                                                                                                                                                                                                                     | `codexArgs` uses `exec --json --ephemeral`, a separate home and explicit isolation/gateway flags.                                                                                                                                                                                                                                                                                                                                              | **KEEP-EXISTING** native-login PTY and separate structured app-server adapter. Neither upstream route establishes ORQST's installed-version acceptance. PATH support applies to both local Codex environments when a reviewed `toolPath` exists.                                                                             |
| Claude compatibility         | Native Claude `-p` stream driver with resume, permission/MCP bridges and its own worker/transcript handling.                                                                                                                                                                                                                                                                                                                        | `claudeArgs` / `claudeEngine` use `-p --output-format stream-json`, provider settings and gateway tools.                                                                                                                                                                                                                                                                                                                                       | **KEEP-EXISTING** reviewed 2.1.178 native TUI, new UUID and optional strict per-instance MCP. Hash/version pin, shared configuration/session disclosure and native start grant remain mandatory. PATH does not validate login or protocol/model support.                                                                     |
| OpenCode compatibility       | No OpenCode-specific runtime definition was found under `relay/src/runtimes/defs` at this pin. Generic terminals can run a manually selected executable; that is not a structured OpenCode adapter acceptance result.                                                                                                                                                                                                               | [`opencode-v2.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/opencode-v2.ts) explicitly preserves the person's data directory for database credentials, isolates config/state, starts `serve`, waits for MCP and invokes `run --server`. This is a real distinct V2 path; it is not the older auth.json-linking V1 path.                                                                | **KEEP-EXISTING blocked opt-in.** ORQST's 2.2.5 standalone TUI profile keeps native identity and acknowledges writable SQLite, possible migration/startup activity and unvalidated descendants. No server startup or migration is authorized by a PATH fix. The V2 source is newly inspected here, not imported or executed. |

**Actual reuse retained:** the previously audited Anywh `BufferLineSplitter` code
in `packages/core/src/managed-codex/line-splitter.ts`, with NOTICE and modification
attribution. This increment adds no copied upstream implementation. The small local
PATH policy adapts the observed installer-fallback behavior to ORQST's signed
manifests and environment whitelist; upstream resolvers, shell startup, broad
environment copying, probes, PTY hosts and UI are not imported. Replacing the existing
bounded PTY/IPC/journal with them would discard already-tested local contracts.

## Concrete correction and security review

`local-cli-path.ts` preserves absolute environment PATH order, appends
`~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin` and
`~/.opencode/bin`, then any explicitly selected native host/provider executable
directories. These additional fallbacks permit sibling tools and the selected Node
host to be found even under a minimal GUI PATH, without overriding existing PATH
priority. The policy canonicalizes existing directories and deduplicates by device/inode.
Empty, relative and NUL-containing entries are ignored. Canonical targets containing
the PATH delimiter cannot be represented and are excluded. Directories must belong
to root/current uid, have no group/world write bits, and have trusted ancestors
(the existing sticky-parent exception applies). Missing directories are ordinary;
metadata errors or more than 128 unique input directories produce limited coverage.
Input and canonical output each have a 32 KiB budget. No shell, process, network,
provider data, keyring or credential/configuration read occurs in this policy.

Discovery reports each candidate's `origin: env | fallback` and excluded unsafe
directories. Exclusions make discovery coverage limited; explicit creation may use
the complete, safely filtered list. Unknown metadata or budget truncation blocks
creation. New Desktop manifests carry the exact reviewed `toolPath`; the native
creation review shows this common value once, and both private manifests persist it.
Directory identities are rechecked before provisioning. Reading a new manifest and
constructing the child environment revalidate its canonical path and permissions.
Old manifests without the optional field retain `/usr/bin:/bin:/usr/sbin:/sbin`;
they are not silently upgraded. Create/review a fresh pair to use the new policy.
Legacy developer setup scripts retain their prior environment policy.

This expands which local tools an authorized CLI/MCP can resolve, including tools
in trusted per-user install directories. Those subordinate tools are **not hashed**
or hard-contained; existing same-user trust applies and native hooks/MCP may execute
them. PATH support cannot promise that a particular `node`, `npx`, `git` or model is
installed or compatible. Provider executables and the private Node host remain
absolute/hash-pinned. No arbitrary environment variable inheritance, permission
bypass, new task, API/control endpoint, HTTP/WS/cookie change or new delegation
mechanism is introduced. Existing MCP task grants remain separate from PTY input.

## Passive local evidence and acceptance status

With a simulated GUI PATH `/usr/bin:/bin:/usr/sbin:/sbin`, filesystem-only discovery
and bounded native executable hashing found all three native candidates. Their
hashes match the existing reviewed contracts for Codex 0.162.1, Claude 2.1.178 and
OpenCode 2.2.5. These version labels come from the prior reviewed hash contracts;
`--version` was **not run**. Discovery itself still returns `version:null`, unknown
authentication and no execution authority. `/opt/homebrew/bin` on this machine has
mode 0775 and was reported/excluded; no chmod or installation was performed.
No provider, login, inference, native database, credential file or session history
was opened. All three real native TUI/MCP acceptance results remain **not run**.

| CLI      | Implemented path now                                                                                                                   | Still required before claiming functional acceptance                                                                                                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex    | Existing native HOME/CODEX_HOME; opt-in interactive PTY; reviewed tool PATH in new Desktop manifests; existing structured runtime/MCP. | Authorized native start with shared writes/config; verify login/readiness and input/focus, then separately authorized harmless model task and A→B→A through existing MCP. Earlier structured startup failure is not resolved by this patch.                                                    |
| Claude   | Native HOME/optional CLAUDE_CONFIG_DIR/Keychain identity; exact reviewed pin; UUID TUI; same reviewed tool PATH; optional strict MCP.  | Native trust/startup prompts, login, focus, MCP and model task/round trip. A new CLI build requires a new pin audit; PATH cannot bypass that gate.                                                                                                                                             |
| OpenCode | Existing native identity; exact reviewed 2.2.5 standalone profile; same reviewed tool PATH; inline MCP composition.                    | Specific consent for writable shared SQLite, possible pending migrations, credential refresh and automatic startup activity; then validate new session, concurrent DB effects, native/descendant exit, login, focus and MCP. Inference needs separate consent. Blocked manifests stay blocked. |

## Team/recovery specification coverage

The in-app reviewed A/B creation and proved pre-admission retry path already exist;
stable internal terminal identities, distinct ownership/process/task/delivery states,
partial/uncertain effect retention and scoped MCP primitives are preserved. This
change does not turn OS spawn evidence into native readiness or completed tasks.

Still pending: a general 1..N/mixed-provider team wizard, independent model/role/name
selection and defaults, durable team metadata/UI restoration, safe per-member retry
after uncertain effects, native session resume where supported, supported busy-pane
delivery, and real two-CLI A→B processing/result return. Existing pair manifests are
still one provider per selection. Do not label the overall team milestone done.

For the next real test, use the existing optional manifest MCP composition and
native **Authorize MCP task** flow. Start only explicitly consented new owned slots,
separately authorize the exact harmless task and record accepted, processing and
matching returned result separately. Do not inject deferred text into a busy TUI or
automatically replay an uncertain result. No second MCP mechanism is needed.

Rollback is a revert of this code/docs increment after preserving any new private
manifests; no migration or data deletion is needed. Older code rejects manifests with
the additional field, so review fresh compatible manifests rather than editing or
erasing active state or reclaiming unknown reservations.

## Validation of this increment

Executed in the isolated worktree with Node 24.22.2 / pnpm 10.34.9:

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: passed. The existing Vite
  chunk-size advisory remains; build output is ignored.
- `pnpm exec tsx --test --test-concurrency=1 tests/*.test.ts`: **515 passed**,
  zero failures/cancellations/skips on the final source. Default-concurrency
  scheduling was not rerun. An earlier iterative full run built an intermediate
  creation module and failed its root-owned tool-directory checks; it is not
  reported as green. The final run uses the corrected root/current-owner policy.
- Focused discovery/PATH/profile/creation run: **30 passed**. It includes actual
  disposable Node child/tool resolution with the reviewed PATH for each provider
  environment, plus unchanged legacy PATH, GUI-minimal discovery, unsafe aliases,
  budgets, whitelist and directory-replacement rejection. This is synthetic spawn
  evidence, not provider or model acceptance.
- `pnpm exec tsx scripts/accept-terminal-creation.ts --authorize-synthetic-creation`:
  passed for the three synthetic CLI pins; reservations preserved. Native dialogs
  and focus were intercepted. QA528 independently reported 30/30 focused tests and
  the same Electron acceptance passed, with GO for this patch. Opus supplied
  consultative review only.

No provider/inference/login/model command, credential/configuration/native-database
read, migration or user-session mutation was performed. Full browser/PTy/real-provider
acceptance and ingestion `validate:local`/`validate:live` were not run for this change.
The observer reader is unchanged. Existing live Desktop documents are not hot-upgraded
by a build; safe integration/restart must preserve any active owned processes.
Private specifications and agent instruction files are not part of this change.
