# Google Antigravity (`agy`) Integration Research and Contract — 2026-11-18

Baseline: `ed2d230b02c78d73533545f31fd76a90d45a39e2` (`feat/frontend-768`).
Owner decision (2026-11-18): add Google Antigravity (`agy`) as a fourth supported agent provider in
ORQST alongside Codex, Claude Code, and OpenCode.

Scope of this document: primary binary, protocol, configuration, storage, and Terms-of-Service
evidence for Antigravity CLI `1.5.10`; mandatory reference repository audit (Overclock, Anywh, T3
Code, Tucano) with pinned commit SHAs; comparison against ORQST's existing integration surfaces;
path-by-path integration decisions; and the exact normative contract for parallel implementation
workers. No user credentials, tokens, or authentication files were read during this audit; all CLI
and PTY probes used disposable temporary `HOME` directories and issued zero model prompts.

---

## 1. Primary Evidence: Installed `agy` Binary and Distribution

### 1.1 Binary Identity and Code Signature

| Property             | Measured Value                                                                                                                                                                      | Evidence Source                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Launcher path        | `/Users/walissonhmsouza/.local/bin/agy`                                                                                                                                             | `ls -la`, `lstat` (regular file, not symlink) |
| Canonical path       | `/Users/walissonhmsouza/.local/bin/agy`                                                                                                                                             | `realpath`                                    |
| Permissions & owner  | `-rwxr-xr-x` (`0755`), `walissonhmsouza:staff`, `224,809,248` bytes                                                                                                                 | `ls -la`                                      |
| File format          | `Mach-O 64-bit executable arm64` (thin Mach-O, magic `0xcffaedfe`)                                                                                                                  | `file`, Mach-O header                         |
| Exact version        | `1.5.10`                                                                                                                                                                            | `agy --version` in disposable `HOME`          |
| Exact SHA-256        | `780ee763a9938a37b45c7f9d6ae31747d7c574358fd10c64d3a1cdc36faf2798`                                                                                                                  | `shasum -a 256`                               |
| Go toolchain         | `ego1.28-20261102-RC01 cl/1012564305 +298f53e483 X:fieldtrack,boringcrypto,simd,nogolistexportnewformat`                                                                            | Embedded `\xff Go buildinf:`                  |
| macOS code signature | `Developer ID Application: Google LLC (EQHXZ8M8AV)`, `Identifier=cli`, `Runtime Version=27.0.0`, `CDHash=2c04e7f025647cfed14f88f916faffc60ce6e9c5`, timestamp `2026-11-17 00:11:54` | `codesign -dvvv`                              |
| Linked frameworks    | `Security.framework`, `CoreFoundation`, `Foundation`, `CoreServices`, `IOKit`, `AVFoundation`, `AudioToolbox`, `CoreAudio`, `libresolv.9`, `libc++.1`, `libSystem.B`                | `otool -L`                                    |

### 1.2 Install Layout and Self-Updater Behavior

- **Bootstrap installer (`https://antigravity.google/cli/install.sh`)**: queries platform manifest
  `https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/darwin_arm64.json`.
  At inspection time (2026-11-18), the live manifest resolved to version `"1.5.10"`, archive
  `https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.10-5253791805734912/darwin-arm/cli_mac_arm64.tar.gz`,
  SHA-512 `f192adfc6ca61bc8f0be93b8503c1a0a4e0314f127c9a13fb7e25228343dfbba09ae1a1be083851d9e79a703e535cc19242db44675e40cf7f9a4eaa8cb9b272f`.
  The archive extracts a single standalone native binary named `antigravity` into
  `$HOME/.cache/antigravity/staging/antigravity` and copies it directly to `$HOME/.local/bin/agy`
  (within ORQST's existing `512 MiB` `terminalExecutableMaximumBytes` limit and existing
  `~/.local/bin` fallback directory in `local-cli-path.ts`).
- **First-run unpacking (`$HOME/.gemini/`)**: `agy` resolves all persistent configuration and state
  relative to `HOME` (ignoring `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`,
  `XDG_CACHE_HOME`, and `GEMINI_HOME`; `GEMINI_HOME` has `0` occurrences in the `1.5.10` binary).
  On startup in a disposable `HOME`, `agy` creates:
  - `~/.gemini/config/` (`0755`): `.migrated` (`0644`), `config.json` (`0600`), `mcp_config.json`
    (`0644` when empty; `0600` when saved with entries), `projects/default-cli-project.json`
    (`0644`).
  - `~/.gemini/antigravity-cli/` (`0755`): `builtin/` (`skills/` and `plugins/swarm/`),
    `conversation_summaries.db` (`0644`, SQLite `WAL`), `conversations/` (`0755`), `brain/`
    (`0755`), `crashes/` (`0755`), `cache/default_project_id.txt` (`0644`), `installation_id`
    (`0644`), `jetski_state.pbtxt` (`0600`), `last_check.timestamp` (`0644`), `log/cli-*.log`
    (`0644`) with symlink `cli.log`, and `updater/` (`0755`).
  - In an active user home, `~/.gemini/` also holds shared cross-surface state (`antigravity/`,
    `antigravity-ide/`, `google_accounts.json`, `oauth_creds.json` [`0600`], `state.json` [`0600`],
    `trustedFolders.json` [`0600`], `projects.json`, `settings.json`, `skills/`) and
    `~/.gemini/antigravity-cli/` additionally holds `history.jsonl` [`0600`], `settings.json`
    [`0600`], `mcp_config.json` [`0600`], `mcp/`, `agents/`, `annotations/`, `implicit/*.pb`,
    `jetbox_summaries_proto.pb` [`0600`], `presence/*.lock` [`0600`], and `bin/agentapi` [`0755`].
- **Critical background self-update discovery**: by default, `agy` spawns a background self-updater
  (`auto_updater.go:334] Spawned background update process`) that replaces `~/.local/bin/agy` in
  place, which would invalidate ORQST's exact SHA-256 binary pin across runs.
  - Empirically verified in disposable PTY launches:
    - Setting `AGY_CLI_DISABLE_AUTO_UPDATE="1"` **does NOT disable** the updater (`auto_updater.go`
      still spawns the background update process and creates `updater/update.lock` and
      `updater/update_status.json`).
    - Setting `AGY_CLI_DISABLE_AUTO_UPDATE="true"` (exact lowercase `"true"`) **disables** the
      updater completely: `updater/` is not created, and the CLI log records verbatim:
      `auto_updater.go:247] Auto-update disabled via environment variable AGY_CLI_DISABLE_AUTO_UPDATE`.

---

## 2. Licensing and Terms-of-Service Audit

### 2.1 License Classification (`AGENTS.md §8`)

- **Antigravity CLI (`agy`)**: **proprietary Google software**, distributed as a signed closed-source
  native binary under the [Google Terms of Service](https://policies.google.com/terms) and the
  [Google Antigravity Additional Terms of Service](https://antigravity.google/terms).
  - **ORQST Apache-2.0 compatibility**: compatible **only** as an external, user-installed local
    tool discovered on the host filesystem and invoked at runtime after explicit native user consent
    (the exact same boundary ORQST uses for proprietary Claude Code). ORQST must **never** bundle,
    vendor, redistribute, patch, decompile, or wrap the `agy` binary or its extracted `builtin/`
    assets inside the ORQST repository or application packages.
- **Antigravity Python SDK (`https://github.com/google-antigravity/antigravity-sdk-python`)**: the
  Python wrapper source is licensed under **Apache-2.0**, but its PyPI wheels (`pip install
google-antigravity`) bundle a platform-specific compiled runtime binary (`antigravity_guide`
  skill `references/sdk.md`). Do not add Python or PyPI wheel dependencies to ORQST.

### 2.2 Third-Party Launch Authority under Google Antigravity Terms

Primary policy sources inspected on 2026-11-18:

1. **Google Antigravity Additional Terms of Service (`https://antigravity.google/terms`)**:
   > "You must not abuse, harm, interfere with, or disrupt the Service. This includes, but is not
   > limited to, using the Service in connection with products not provided by us. Using third party
   > software, tools, or services to access the Service (e.g. using OpenClaw with Antigravity OAuth)
   > is a breach of this Agreement. Such actions may be grounds for suspension or termination of
   > your Antigravity and/or Gemini CLI accounts."
   >
   > "If you are accessing the Service through Gemini Enterprise (Google Cloud), Gemini Enterprise
   > for Business or a Google Workspace subscription on the Google Cloud Pre-GA Offering Terms, or
   > with an API Key in Gemini for business, then you are subject to the terms of use accepted or
   > signed by your administrator applicable to such service..."
2. **Official Antigravity FAQ (`https://antigravity.google/docs/faq.md`)**:
   - _"Why can't I use third-party software (such as Claude Code, OpenClaw, or OpenCode) with my
     Antigravity login? Using third-party software, tools, or services to access Antigravity is a
     violation of our Terms of Service... To use a third-party coding agent with Gemini, we
     recommend using a Gemini Enterprise or Google AI Studio API key."_
   - _"Can I use Antigravity CLI headless mode in third-party coding agents or automate account
     switching? Antigravity CLI headless mode (`agy -p`) is intended for direct scripting and CI
     workflows. Wrapping `agy` inside third-party coding agents or applications, or automating
     account rotation, is not supported under consumer plans."_
3. **Official ACP Guide (`https://antigravity.google/docs/ide/extensions/acp.md`)**:
   - _"Any ACP client can launch Antigravity CLI. Configure it to run this command with the project
     directory as the working directory: `agy acp`. The server speaks ACP protocol version 1 over
     `stdio` and identifies itself as `Antigravity ACP Server`."_
   - _"Gemini models are available in every client. Third-party models are only offered to JetBrains
     IDEs (including JetBrains Air), Android Studio, Android Performance Analyzer, Zed, and Xcode."_
4. **Google AI Developer Forum clarifications (`https://discuss.ai.google.dev/t/192027`,
   `https://discuss.ai.google.dev/t/198889`, `https://discuss.ai.google.dev/t/199753`)**:
   - Single-user interactive developer clients launching the unmodified `agy` / `agy acp` binary
     with native authentication (`oauth-personal`, `oauth-business`, `gemini-api-key`,
     `agent-platform`) where a human directly drives the session are permitted.
   - Prohibited on consumer `oauth-personal` plans: (a) wrapping `agy -p` inside third-party agent
     loops, (b) extracting, proxying, or refreshing internal OAuth tokens outside `agy`,
     (c) generating wrapper scripts around `agy` or intercepting `127.0.0.1` OAuth callbacks,
     (d) driving harness tools with `--dangerously-skip-permissions`, and (e) wrapping `agy` / `agy
acp` as an automated sub-agent or generic model provider inside another coding agent harness.

**Resulting compliance boundary for ORQST**:

- **Passive Read-Only Observer**: **Permitted** (reads local JSONL files only; never touches OAuth
  tokens, processes, or network endpoints).
- **Managed Interactive PTY Terminal (`agy`)**: **Permitted** (runs the unmodified user-installed
  `agy` binary inside an interactive terminal pane; user authenticates and interacts directly in
  `agy`'s own TUI; ORQST never reads credentials, never wraps `agy` in shims, and never injects
  prompts into observed sessions).
- **Headless Print / Stream-JSON (`agy -p` / `--input-format stream-json`)**: **Prohibited** for
  ORQST consumer integration (explicitly disallowed by the official FAQ).
- **Structured ACP (`agy acp`)**: **Conditionally permitted for single-user human-initiated turns
  only** using the unmodified `agy acp` binary and native authentication, **without** automated
  cross-agent sub-agent delegation on consumer `oauth-personal` logins, token extraction, callback
  interception, or `--dangerously-skip-permissions`.

---

## 3. CLI Surface, Modes, MCP, Permissions, and Disk Storage

### 3.1 Root Flags and Subcommands (`agy 1.5.10`)

Measured directly from `agy --help` and `<subcommand> --help` in an isolated `HOME`:

- **Root flags**:
  - `--add-dir`: repeatable additional workspace directory (default `[]`).
  - `--agent`: custom/built-in agent name for the session.
  - `-c`, `--continue`: continue most recent workspace conversation.
  - `--conversation <id>`: resume specific conversation UUID.
  - `--dangerously-skip-permissions`: auto-approve all tool permission requests (**forbidden in
    ORQST**).
  - `--disable-slash-commands`: disable slash-command and skill expansion in print mode.
  - `--effort <level>`: reasoning effort (`low|medium|high|xhigh|max`).
  - `-i`, `--prompt-interactive <prompt>`: run an initial prompt interactively and continue.
  - `--input-format <fmt>`: print-mode input (`text`, `stream-json`; `stream-json` requires
    `--output-format stream-json`).
  - `--json-schema <schema-or-path>`: enforce structured output schema in print mode.
  - `--log-file <path>`: override CLI log file path.
  - `--mode <mode>`: session execution mode (`accept-edits`, `auto`, `plan`; note `--mode` does not
    accept `"default"` or `""` on the command line — default mode is selected via `--settings
'{"agentMode":""}'`).
  - `--model <slug-or-label>`: model slug or saved display label for the session.
  - `--new-project` / `--project <id-or-name>`: project scoping flags.
  - `--output-format <fmt>`: print-mode output (`text`, `json`, `stream-json`).
  - `-p`, `--print`, `--prompt <text>`: non-interactive single-prompt execution.
  - `--print-timeout <duration>`: time limit for print mode (`0s` default = wait until completion).
  - `--remote-agent`, `--remote-control`: remote execution / remote-control connection flags.
  - `--sandbox`: enable OS terminal sandbox (`sandbox-exec` Seatbelt on macOS, namespaces on Linux,
    AppContainer on Windows 11 24H2+).
  - `--settings <json-or-path>`: _"Settings for this session only, never saved: a JSON object of
    settings.json keys, inline or as a file path."_ Verified empirically: applies settings in memory
    for the session and writes nothing to `~/.gemini/antigravity-cli/settings.json`.
- **Subcommands**:
  - `acp`: start Agent Client Protocol v1 stdio JSON-RPC server (`--stdio` [default], `--add-dir`,
    `--agent`, `--app-data-dir` [joined beneath `--gemini-dir`, default `antigravity-cli`],
    `--gemini-dir` [default `.gemini`], `--disable-telemetry`, `--sandbox`, `--log-file`,
    `--login` [interactive terminal OAuth paste-code flow], `--process-per-session`,
    `--ide-mcp-port` [requires `nc` in `PATH`], `--include-default-customizations`,
    `--dangerously-skip-permissions`).
  - `agent` / `agents`: list available agents (exits `0` with empty stdout when unauthenticated and
    no custom agents exist).
  - `models`: list available models as `<slug>\t<label>` lines (**requires active sign-in and
    network**; exits `1` when signed out with `Error: Please sign in to view available models`).
  - `mcp <add|remove|list|enable|disable>`: mutate/inspect global `~/.gemini/config/mcp_config.json`
    (`agy mcp add [-t stdio|http] [-e KEY=val] [-H "Header: Val"] <name> <commandOrUrl> [args...]`).
  - `plugin` / `plugins <list|import|install|uninstall|enable|disable|validate|link|help>`: manage
    plugins.
  - `remote-control <start|status|stop>`, `mic-serve [--addr 127.0.0.1:4713]`, `install`,
    `changelog`, `update`, `help`.

### 3.2 Interactive TUI Behavior in a PTY

Measured in a `30x100` Python `pty.openpty()` harness with `TERM=xterm-256color` and disposable
`HOME`:

- **Startup terminal queries**: emits `\x1b[?2026$p` (synchronized output DECRQM), `\x1b[?2027$p`
  (grapheme clustering DECRQM), `\x1b]11;?\x07` (OSC 11 background color query), `\x1b]7501;?\x07`
  (Antigravity custom OSC 7501 capability probe), `\x1b[>4m` / `\x1b[>4;2m` (`modifyOtherKeys`),
  `\x1b[?2004h` (bracketed paste), and `\x1b[>5u\x1b[?u` (Kitty keyboard protocol push/query).
  xterm.js 6 in ORQST handles unknown CSI/OSC queries safely without stalling `agy`.
- **Buffer modes (`altScreenMode`)**: `"default"` renders conversation turns inline in terminal
  scrollback (`clearScrollbackOnResize: true` by default) and switches to `?1049h` alternate screen
  for full-screen panels (login selector, `/diff`, `/artifact`, `/help`, `/swarm board`); `"always"`
  runs the entire TUI in `?1049h`; `"never"` stays inline.
- **Unauthenticated prompt**: renders cleanly inside the PTY (`Welcome to the Antigravity CLI. You
are currently not signed in. Select login method: 1. Google OAuth / 2. Use a Google Cloud
project`) without hanging or auto-launching a browser until the user presses `Enter`.
- **Clean exit**: `Ctrl+D` on an empty prompt (`cli.exit`), double `Ctrl+C` when idle
  (`cli.escape`), or `/exit` / `/quit` restores terminal state and exits with code `0`.

### 3.3 Structured Protocols (`stream-json` vs `agy acp`)

1. **Print / `stream-json` (`agy --input-format stream-json --output-format stream-json`)**:
   - Reads `{"event":"user","message":{"content":"..."}}` NDJSON lines on `stdin` (text blocks only;
     no image blocks, no `/model` or `/usage` slash commands, no `control_request`).
   - Emits `{"event":"init",...}` once, per-step `{"event":"step_update",...}` (`ACTIVE` / `DONE`),
     and per-turn `{"event":"result","result":{"conversation_id":...,"status":"SUCCESS"|...,"usage":...}}`.
   - **Disqualifiers**: (a) prohibited by Antigravity FAQ inside third-party apps on consumer plans;
     (b) has **no interactive permission callback** — tools requiring approval in `request-review`
     mode are soft-denied on `stderr`.
2. **Agent Client Protocol (`agy acp`)**:
   - Measured live `initialize` handshake response in disposable `HOME`:
     - `protocolVersion: 1`, `agentInfo: {"name": "Antigravity ACP Server", "version": "1.5.10"}`.
     - `agentCapabilities`: `loadSession: true`, `promptCapabilities: {image: true, audio: false,
embeddedContext: true}`, `sessionCapabilities: {resume: {}, close: {}, load: {}, list: {},
additionalDirectories: {}}`, `auth: {logout: {}}`,
       `_meta.antigravity: {tier: true, systemPrompt: {append: true}}`.
     - `authMethods`: `oauth-personal`, `oauth-business`, `gemini-api-key`, `agent-platform`.
   - Unauthenticated `session/new` deterministically returns JSON-RPC error `{"code": -32000,
"message": "Authentication required"}`; closing `stdin` exits cleanly with code `0`.
   - Supports live interactive tool approvals via `session/request_permission` (`Allow` / `Deny` /
     cancellation), per-session `mcpServers` in `session/new` and `session/resume`, model and
     `thought_level` `configOptions` via `session/set_config_option`, and cancellation via
     `session/cancel`.

### 3.4 MCP Client Support and Configuration

- **Transports (`https://antigravity.google/docs/mcp.md`)**:
  - Local `stdio`: `{"command": "...", "args": [...], "env": {...}, "cwd": "..."}`.
  - Remote Streamable HTTP (MCP 2025-03-26): `{"serverUrl": "https://...", "headers": {...}}` (`url`
    also accepted; legacy HTTP+SSE is unsupported).
  - Optional server fields: `disabled`, `enabledTools`, `disabledTools`, `timeoutSeconds` (default
    `300s` connect / `180s` per tool call), `authProviderType` (`"google_credentials"`), `oauth`,
    `tools.<toolName>.eager` (default `false` = lazy-loaded via cached schema files under
    `~/.gemini/antigravity-cli/mcp/<serverName>/<toolName>.json` + `call_mcp_tool`; `true` = eager
    declaration `mcp_<serverName>_<toolName>`).
- **Discovery paths for interactive `agy` TUI**:
  1. Global: `~/.gemini/config/mcp_config.json` (shared across CLI, App, and IDE; also mirrored at
     `~/.gemini/antigravity-cli/mcp_config.json` on migrated setups).
  2. Workspace: `<workspace>/.agents/mcp_config.json` (and `.agent/`, `_agents/`, `_agent/`).
  3. Enabled plugins: `plugins/<plugin>/mcp_config.json`.
- **Absence of per-invocation TUI MCP flag**: verified via `agy --help`,
  `https://antigravity.google/schemas/v1/settings.json`, and binary symbol scan — `agy 1.5.10` has
  **no** `--mcp-config` flag, **no** `--strict-mcp-config` flag, and **no** inline MCP environment
  variable (`--settings` only accepts `settings.json` properties, not `mcpServers`). Injecting a
  per-pane MCP relay into a shared-`HOME` TUI would mutate either global
  `~/.gemini/config/mcp_config.json` or workspace `.agents/mcp_config.json`.

### 3.5 Model Selection, Permission Presets, and Sandbox / Read-Only Controls

- **Model selection**:
  - Accepts either slug (`gemini-4-carbon-medium`, `gemini-3.8-flash-medium`) or display label
    (`Gemini 4 Carbon (Medium)`) via `--model <value>`, paired optionally with `--effort
<low|medium|high|xhigh|max>`.
  - Persistent user choice is saved in `~/.gemini/antigravity-cli/settings.json` under `"model"` **by
    display label** (containing spaces and parentheses, e.g. `"Gemini 4 Carbon (Medium)"`).
  - Interactive TUI falls back to the account default model with a warning if `--model` or saved
    `"model"` is unavailable (unlike `-p`, which exits `1`).
  - Authentication modes (`https://antigravity.google/docs/install.md`): native OS Keychain / browser
    OAuth (`oauth-personal` or `oauth-business`), Google AI Studio API key (`"modelProvider":
"gemini"` in settings **plus** `GEMINI_API_KEY` env var; `GEMINI_API_KEY` alone is ignored by
    TUI), or Google Cloud ADC (`AGY_ADC_AUTH=true`).
- **Execution modes, permissions, and sandbox (`https://antigravity.google/docs/permissions.md`,
  `https://antigravity.google/docs/sandbox.md`)**:
  - **Important default change in `v1.5.7+`**: when `agentMode` is omitted on macOS/Linux personal
    accounts, `agy` starts in **`auto` mode** (automatically approving workspace file writes and
    sandboxed/safe shell commands).
  - **Safe supervised override for ORQST PTY**: passing `--sandbox` and `--settings
'{"agentMode":"","toolPermission":"request-review","enableTerminalSandbox":true,"allowNonWorkspaceAccess":false}'`
    forces `default` (`request-review`) mode at session start without touching the user's saved
    `settings.json`: every file edit/create pauses for interactive diff review, non-workspace access
    is off, and agent shell commands run under macOS `sandbox-exec` Seatbelt (no network by default)
    while still prompting under `request-review`.
  - **Fine-grained rule precedence**: `permissions.deny > permissions.ask > permissions.allow` using
    `action(target)` syntax (`read_file`, `write_file`, `read_url`, `execute_url`, `command`, `mcp`,
    and enterprise-only `unsandboxed`). A session-only read-only policy can be expressed via
    `--settings '{"agentMode":"plan","toolPermission":"strict","enableTerminalSandbox":true,"allowNonWorkspaceAccess":false,"permissions":{"deny":["write_file(*)","command(*)"]}}'`,
    noting two honest limits: (1) `search_web` has no `permissions` action key of its own, and
    (2) in an interactive TUI the human operator can still change session modes via `Shift+Tab` or
    `/permissions` (though `deny` rules in `--settings` override `auto`/`accept-edits`). The `agy`
    process itself runs as the native macOS user; `sandbox-exec` wraps only child commands spawned
    by `agy`.
- **Lifecycle hooks (`https://antigravity.google/docs/hooks.md`)**: loaded from
  `~/.gemini/config/hooks.json`, `<workspace>/.agents/hooks.json`, and enabled plugins
  (`SessionStart`, `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`). Hooks in
  `settings.json` / `--settings` are deprecated and **not loaded** by `agy`, so ORQST cannot inject
  per-terminal owned hooks via `--settings` the way `owned-claude-hooks.ts` does for Claude Code.

### 3.6 Session Transcripts, SQLite Databases, Token Usage, and Quota Evidence on Disk

Measured from `~/.gemini/antigravity-cli/` directory listings, read-only SQLite `.schema`
inspection, Go protobuf descriptors in `agy`, and this session's own `transcript.jsonl`
(`a5a9386f-b069-4bfc-9310-7422a424c410`):

1. **Primary plain-text transcripts (`~/.gemini/antigravity-cli/brain/<conversation-id>/.system_generated/logs/`)**:
   - `transcript.jsonl` (`0644`, compact; truncates large `content` / `thinking` / `tool_calls`
     fields and adds `"truncated_fields": [...]`) and `transcript_full.jsonl` (`0644`, untruncated),
     backed by `102,400`-byte (`100 KiB`) page files in `chunks/transcript/00000000.jsonl...` and
     `chunks/transcript_full/00000000.jsonl...`.
   - Observed JSONL step record types and keys:
     - `USER_INPUT`: `step_index`, `type`, `source` (`"USER_EXPLICIT"`), `status` (`"DONE"`),
       `created_at` (ISO-8601), `content`, optional `media` (`[{mime_type, uri}]`).
     - `PLANNER_RESPONSE`: `step_index`, `type`, `source` (`"MODEL"`), `status` (`"RUNNING"` |
       `"DONE"` | `"ERROR"`), `created_at`, `model` (slug, e.g. `"gemini-4-carbon-medium"`),
       optional `content`, optional `thinking`, optional `tool_calls` (`[{name, args}]`),
       `input_tokens`, `output_tokens`, `cache_read_tokens`, optional `truncated_fields`.
     - `GENERIC` (tool execution results and step errors): `step_index`, `type`, `source`
       (`"MODEL"` | `"SYSTEM"`), `status` (`"RUNNING"` | `"DONE"` | `"ERROR"`), `created_at`,
       optional `content`, optional `error`, optional `truncated_fields`.
     - `SYSTEM_MESSAGE`: `step_index`, `type`, `source` (`"SYSTEM"`), `status` (`"DONE"`),
       `created_at`, `content`.
   - **Critical in-place tail-mutation behavior**: verified empirically across consecutive steps on
     `transcript.jsonl` (`dev:ino = 16777233:178263657`). `step_index` values are unique and
     strictly monotonic (`0..N`, one line per step), **and `agy` keeps the same inode while
     rewriting the trailing in-flight step line in place** when its `status` transitions from
     `"RUNNING"` to `"DONE"` or `"ERROR"` and appending subsequent steps. An observer reader
     therefore **must** verify a byte-content anchor at the previous checkpoint offset (resetting to
     offset `0` with deterministic event IDs when an in-place tail update rewrites bytes prior to
     `checkpoint.offset`) and **must not** advance its durable checkpoint past an unfinished
     `"RUNNING"` tail line.
2. **SQLite databases (`journal_mode = WAL`)**:
   - `~/.gemini/antigravity-cli/conversation_summaries.db` (`0644`, `WAL`): tables
     `conversation_summaries` (`conversation_id`, `title`, `preview`, `step_count`,
     `last_modified_time`, `workspace_uris` [JSON string array of `file://` URIs], `status`
     [`CASCADE_RUN_STATUS_RUNNING` | `CASCADE_RUN_STATUS_IDLE`], `source`, `project_id`,
     `agent_name`, `parent_conversation_id`, `nesting_depth`, `not_fully_idle`, `killed`,
     `last_user_input_time`, `app_data_dir`, `raw_summary` blob, `group_id`),
     `conversation_parents (conversation_id, parent_id)`, and `conversations_fts` (FTS5).
   - `~/.gemini/antigravity-cli/conversations/<conversation-id>.db` (`0600`, `WAL` with active
     `.db-wal` and `.db-shm`): binary `.exa.codeium_common_pb` protobuf blobs in `trajectory_meta`,
     `steps`, `gen_metadata`, `executor_metadata`, `parent_references`, `trajectory_metadata_blob`,
     and `battle_mode_infos`.
   - **Read-only boundary hazard (`AGENTS.md §1, §7`)**: opening a live SQLite `WAL` database
     in-place inside `~/.gemini/antigravity-cli/` with `node:sqlite` can create/modify `-shm` sidecar
     files or contend with `agy` writers. Observer code **must never** open `conversations/*.db` at
     all, and **must never** open `conversation_summaries.db` in place inside `~/.gemini/`. If
     summary metadata (`workspace_uris`, `title`, `parent_conversation_id`, `agent_name`) is read,
     the observer must copy `conversation_summaries.db` (and `conversation_summaries.db-wal` if
     present) via `O_RDONLY | O_NOFOLLOW` with a bounded byte budget into an ORQST-owned `0700`
     temporary directory and open only that disposable copy.
3. **Token accounting semantics (`AGENTS.md §5`)**:
   - Mathematical proof from live `transcript.jsonl` (`step_index` 1 → 6 → 11 → 16 → 19):
     - Step 1: `input_tokens: 14354, cache_read_tokens: 0, output_tokens: 701`
     - Step 6: `input_tokens: 5756, cache_read_tokens: 14355, output_tokens: 543` (`14355 > 5756`)
     - Step 19: `input_tokens: 5810, cache_read_tokens: 40977, output_tokens: 1268` (`40977 > 5810`)
     - Cross-checked against `headless.md` multi-turn `stream-json` (`input_tokens: 278,
cache_read_tokens: 30214, output_tokens: 4, total_tokens: 282`) and `agy`'s embedded workflow
       accounting (`tot_tok = in_tok + out_tok + cache_tok`).
   - **Fact**: in `agy`'s `transcript.jsonl`, `input_tokens` is **disjoint uncached input tokens
     only** (`cache_read_tokens` is **not** a subset of `input_tokens`), and each `PLANNER_RESPONSE`
     carries **per-step incremental** counts. `thinking_tokens` and `cache_write_tokens` exist in
     internal protobuf `ModelUsageStats` and headless `stream-json`, but are **omitted** from
     `transcript.jsonl`.
   - **Normalization into ORQST canonical `Usage`** (where `cached <= input` and `total === input +
output`, per `AGENTS.md §5` and `packages/adapters/codex/src/normalize.ts`):
     - `canonicalInput = input_tokens + cache_read_tokens`
     - `canonicalCached = cache_read_tokens`
     - `canonicalOutput = output_tokens`
     - `canonicalTotal = canonicalInput + canonicalOutput`
4. **Plan and quota evidence on disk**:
   - **Not persisted in passive session files**. Both `/usage` (`5h` and `weekly` model-group quota
     windows) and `/credits` (`AI Credits` balance) query Google's backend live when invoked
     (`docs/cli/commands/usage.md`, `docs/cli/credits.md`). Only quota-exhaustion turn errors leave
     local error text (`QUOTA_EXHAUSTED`, `RESOURCE_EXHAUSTED`, `quotaResetTimeStamp`,
     `quotaResetDelay`, `retryDelay`). ORQST must report Antigravity plan/quota limits as
     `unavailable` rather than scraping OAuth tokens or calling undocumented Google endpoints.

---

## 4. Reference Repository Audit (`AGENTS.md §13`)

| Repository & Pinned Source                                                                                                                                       | Inspected Files / Functions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | License & NOTICE Evidence                                                                                                                                                                                                                                    | Observed Antigravity / Gemini Mechanism & Differences                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ORQST Decision                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overclock** (`https://overclock.sh`; local bundle `/Applications/Overclock.app` `1.5.0+7`, `@overclock-app/sidecar` `0.1.0`)                                   | `/Applications/Overclock.app/Contents/Info.plist`; `Contents/Resources/sidecar/package.json` (`"private": true`, `bytenode` V8 bytecode `dist/index.jsc`); `Contents/Resources/sidecar/arms-mcp/discovery.d.ts` (`SidecarDescriptor`, `paneHomeDescriptor`, `isPaneHome`); observed runtime footprint in `~/.gemini/*/mcp_config.json` and `~/.gemini/antigravity-cli/agents/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **Proprietary / closed-source** desktop bundle (`THIRD-PARTY-LICENSES.html` covers bundled third-party packages only; no open-source license on `@overclock-app/*`). Per `AGENTS.md §8, §13`: **no source or asset reuse permitted**.                        | Launches `agy` inside managed PTY panes (`OVERCLOCK_PANE_ID`, `OVERCLOCK_ARMS_DESCRIPTOR`) and registers its `overclock` MCP server (`handoff_submit`, `pane_*`) by writing global `~/.gemini/config/mcp_config.json` (and sibling `~/.gemini/antigravity*/mcp_config.json`) plus custom agent files in `~/.gemini/antigravity-cli/agents/`. Mutating global `~/.gemini` MCP/agent files violates ORQST's non-mutation and per-Feature isolation rules.                                                                                                                                                                                                                           | **DO NOT USE** code/assets (closed license) and **do not adopt** global `mcp_config.json` mutation. Keep ORQST's native PTY layout and visual identity.                                                                                                                                                             |
| **Anywh** — [`4f8aef7b5f0dc9cf0832e457c224dc09a9792a21`](https://github.com/anywh-sh/anywh/tree/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21) (2026-11-17)           | [`relay/src/runtimes/defs/acp.ts`](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/relay/src/runtimes/defs/acp.ts) (`acpInitialize`, `acpThreadStart`, `acpThreadResume`, `acpTurnStart`, `acpInterrupt`, `acpConfigOptions`, `answerAcpApproval`); [`relay/src/runtimes/defs/acpDriver.ts`](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/relay/src/runtimes/defs/acpDriver.ts); [`relay/src/runtimes/defs/kimi.ts`](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/relay/src/runtimes/defs/kimi.ts); [`relay/src/runtimes/registry.ts`](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/relay/src/runtimes/registry.ts) (`assertCoherent`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [`LICENSE`](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/LICENSE): **Apache-2.0** (SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`); no root `NOTICE`; zero external runtime deps in `acp.ts`. | Case-insensitive `git grep` across `4f8aef7b` confirms **no `antigravity` or `agy` runtime definition** exists (`gemini` appears only in negative/mock plan-usage tests). However, `defs/acp.ts` + `acpDriver.ts` implement a clean, pure JSON-RPC ACP v1 client (`clientCapabilities: {fs: false, terminal: false}`, `session/new`, `session/resume`, `session/prompt`, `session/cancel`, `session/request_permission`).                                                                                                                                                                                                                                                         | **KEEP EXISTING** ORQST PTY/observer contracts for Phase 1. **ADAPT** `defs/acp.ts` request/permission mapping (with Apache-2.0 attribution) if/when Phase 2 structured `agy acp` is authorized.                                                                                                                    |
| **T3 Code** — [`b8b5affac42a8fd55d89214996c28afdb3c54ab1`](https://github.com/pingdotgg/t3code/tree/b8b5affac42a8fd55d89214996c28afdb3c54ab1) (2026-11-17)       | [`AntigravityProvider.ts`](https://github.com/pingdotgg/t3code/blob/b8b5affac42a8fd55d89214996c28afdb3c54ab1/apps/server/src/provider/AntigravityProvider.ts); [`AntigravityInstallation.ts`](https://github.com/pingdotgg/t3code/blob/b8b5affac42a8fd55d89214996c28afdb3c54ab1/apps/server/src/provider/AntigravityInstallation.ts); [`antigravityAuthSupport.ts`](https://github.com/pingdotgg/t3code/blob/b8b5affac42a8fd55d89214996c28afdb3c54ab1/apps/server/src/provider/antigravityAuthSupport.ts) (`buildAntigravityAcpSpawnInput`, `removedEnvironmentKeys`); [`AntigravityAcpSupport.ts`](https://github.com/pingdotgg/t3code/blob/b8b5affac42a8fd55d89214996c28afdb3c54ab1/apps/server/src/provider/acp/AntigravityAcpSupport.ts) (`antigravityCliSessionMode`); [`AntigravityAdapterV2.ts`](https://github.com/pingdotgg/t3code/blob/b8b5affac42a8fd55d89214996c28afdb3c54ab1/apps/server/src/orchestration-v2/Adapters/AntigravityAdapterV2.ts); [`AntigravityTurnOutcome.ts`](https://github.com/pingdotgg/t3code/blob/b8b5affac42a8fd55d89214996c28afdb3c54ab1/apps/server/src/provider/acp/AntigravityTurnOutcome.ts); [`antigravityUsageReader.ts`](https://github.com/pingdotgg/t3code/blob/b8b5affac42a8fd55d89214996c28afdb3c54ab1/apps/server/src/provider/Drivers/antigravityUsageReader.ts); [`antigravityUsageLimits.ts`](https://github.com/pingdotgg/t3code/blob/b8b5affac42a8fd55d89214996c28afdb3c54ab1/apps/server/src/provider/antigravityUsageLimits.ts) | [`LICENSE`](https://github.com/pingdotgg/t3code/blob/b8b5affac42a8fd55d89214996c28afdb3c54ab1/LICENSE): **MIT** (`Copyright (c) 2026 T3 Tools Inc.`); heavy `effect` + `effect-acp` dependency graph (incompatible with ORQST's zero-Effect Node/Rust Core). | Drives `agy acp --gemini-dir <profile> --app-data-dir antigravity-acp` in an isolated profile dir; intercepts `BROWSER` OAuth URLs and forwards `127.0.0.1` callbacks; `antigravityUsageLimits.ts` reads `acp_token.json` (`refresh_token`), refreshes Google OAuth tokens directly, and queries `daily-cloudcode-pa.googleapis.com` with a custom `antigravity/hub` `User-Agent`; `antigravityUsageReader.ts` decodes raw `.db` protobuf varints. Direct OAuth token reading/refreshing, callback interception, auto-downloading binaries, and in-place SQLite WAL reads violate ORQST `AGENTS.md §1, §6, §7` and Google ToS §6.                                                 | **DO NOT USE** code/dependencies (`effect`, OAuth token reader, protobuf `.db` scraper, auto-installer). **RECORD PROTOCOL FACTS** verified in its source (`agy acp` rejects `yolo`/`auto_edit` modes; `--app-data-dir` joins beneath `--gemini-dir`; `1.5.1+` opens ACP model list without `clientInfo` spoofing). |
| **Tucano** — [`4522704ecdcb2d51d7ad4ea002375dcfe8d447be`](https://github.com/eduwxyz/tucano/tree/4522704ecdcb2d51d7ad4ea002375dcfe8d447be) (2026-11-17, v0.2.37) | [`src/core/engines/antigravity.ts`](https://github.com/eduwxyz/tucano/blob/4522704ecdcb2d51d7ad4ea002375dcfe8d447be/src/core/engines/antigravity.ts) (`antigravityParser`, `antigravityArgs`, `antigravitySettings`, `antigravityTurnDirs`, `parseAntigravityModels`); [`src/core/engines/detect.ts`](https://github.com/eduwxyz/tucano/blob/4522704ecdcb2d51d7ad4ea002375dcfe8d447be/src/core/engines/detect.ts) (`detectAntigravity`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [`LICENSE`](https://github.com/eduwxyz/tucano/blob/4522704ecdcb2d51d7ad4ea002375dcfe8d447be/LICENSE): **Apache-2.0**; no `NOTICE` file.                                                                                                                      | Runs headless `agy --output-format stream-json --input-format stream-json --disable-slash-commands --model <m>` per turn inside a disposable `HOME` with `~/Library/Keychains` (or `.gemini/antigravity-cli/antigravity-oauth-token`) symlinked in, writes disposable `settings.json` + `mcp_config.json`, and runs `agy models` during detection. Note also a bug in `antigravity.ts` line 48: its comment assumes `input_tokens` includes `cache_read_tokens`, undercounting cached prompt context. Headless wrapping, Keychain/token symlinking, and running `agy models` during passive discovery violate Google's consumer FAQ and ORQST's passive-discovery/security rules. | **DO NOT USE** headless `stream-json` wrapper, Keychain/token symlinking, or active `agy models` probing. Retain ORQST's passive canonical discovery and native-identity PTY contract.                                                                                                                              |

---

## 5. Comparison with Existing ORQST Integration Points

| ORQST Surface                                                                                    | Codex (`0.169.0`)                                                                                  | Claude Code (`2.1.318`)                                                                                                | OpenCode (`2.2.5`)                                                                                        | Antigravity (`1.5.10`) Fit & Required Delta                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/terminal/local-cli.ts` & `apps/tauri/terminal-core/src/profiles/local_cli.rs` | `provider = 'codex'`, launcher basename `'codex'`                                                  | `provider = 'claude'`, launcher basename `'claude'`                                                                    | `provider = 'opencode'`, launcher basename `'opencode'`                                                   | **Delta required**: canonical provider ID is `'antigravity'`, but installed binary basename is **`'agy'`** (`~/.local/bin/agy`, already covered by `localCliFallbackDirectories(home)` in `local-cli-path.ts`). Map `'antigravity' -> 'agy'` in both TS and Rust discovery!            |
| `packages/core/src/terminal/*-profile.ts` & `interactive-profile.ts` & Rust `profiles/`          | `version: 1`, `codex-profile.ts` (`--no-daemon --sandbox read-only --ask-for-approval on-request`) | `version: 2`, `interactive-profile.ts` (`--session-id <uuid>`, optional `--settings <hooks>`, `DISABLE_AUTOUPDATER=1`) | `version: 3`, `opencode-profile.ts` (`--standalone`, `OPENCODE_CONFIG_CONTENT`, SQLite migration consent) | Add `version: 4`, `provider: 'antigravity'` (`antigravity-profile.ts` + `profiles/antigravity.rs`), pinned to `1.5.10` / SHA-256 `780ee763...`, passing `--sandbox` + inline `--settings` (`request-review` + `enableTerminalSandbox: true`) and `AGY_CLI_DISABLE_AUTO_UPDATE='true'`. |
| `packages/core/src/terminal/model-selection.ts` & Rust `profiles/model.rs`                       | Reads `config.toml` + `models_cache.json`; passes `--model <slug>`                                 | Static aliases (`sonnet`, `opus`, `haiku`) + `settings.json`; passes `--model <v>`                                     | Reads `opencode.json(c)` + `model.json` state; sets `OPENCODE_CONFIG_CONTENT.model`                       | Read `~/.gemini/antigravity-cli/settings.json` (`"model"` saved as display label with spaces/parentheses, plus `customModelsConfig.customModels` keys when `modelProvider === 'gemini'`); pass `['--model', value]`. Do **not** run `agy models`.                                      |
| `packages/core/src/terminal/provider-mcp-config.ts` & Rust `profiles/mcp.rs`                     | `-c mcp_servers.<name>...` per-invocation override                                                 | `--strict-mcp-config --mcp-config <json>` per-invocation                                                               | `OPENCODE_CONFIG_CONTENT` merged inline JSON per-invocation                                               | **No per-invocation TUI MCP flag/env exists** in `agy 1.5.10`. Keep `mcp` disabled/unsupported for `'antigravity'` PTY manifests in Phase 1 rather than mutating shared `~/.gemini/config/mcp_config.json` or `.agents/mcp_config.json`.                                               |
| `packages/core/src/structured-agents/`                                                           | `codex app-server` stdio JSON-RPC                                                                  | None                                                                                                                   | `opencode serve` HTTP/SSE                                                                                 | `agy acp` stdio JSON-RPC is structurally compatible, **deferred to Phase 2** behind consumer-ToS delegation guardrails (`origin === 'human'` only on `oauth-personal`). Never use `agy -p`.                                                                                            |
| `packages/adapters/*` & `packages/protocol/src/index.ts`                                         | `CodexObserver` (`~/.codex/sessions/**/*.jsonl`), `implemented: true`                              | `claudeDescriptor` (`implemented: false`)                                                                              | `opencodeDescriptor` (`implemented: false`)                                                               | Extend `eventSchema.shape.adapter` with `'antigravity'`; add `packages/adapters/antigravity` reading `~/.gemini/antigravity-cli/brain/<uuid>/.system_generated/logs/transcript.jsonl` with tail-rewrite anchor reset and disjoint-cache token normalization.                           |

---

## 6. Decisions by Integration Path

### 6.1 Managed PTY Terminal (`agy` Interactive TUI)

- **Decision**: **IMPLEMENT NOW (Phase 1 Managed Terminal Provider)**.
- **Rationale**: Runs the unmodified, Google-signed `agy 1.5.10` binary directly inside an ORQST
  native PTY pane with human interaction, exact SHA-256 verification, native consent review,
  session-scoped `--sandbox` + `--settings` overrides (preventing `v1.5.7+` silent `auto` mode
  startup without modifying `~/.gemini/antigravity-cli/settings.json`), and
  `AGY_CLI_DISABLE_AUTO_UPDATE="true"` (preventing background binary mutation). Fully compliant with
  Google Antigravity ToS §6 and ORQST `AGENTS.md §1, §4, §6`.

### 6.2 Structured Pilot (`packages/core/src/structured-agents/`)

- **Decision**:
  - **`agy -p` / `--input-format stream-json`**: **REJECT PERMANENTLY** (violates Antigravity
    consumer FAQ and lacks interactive tool-permission callbacks).
  - **Python SDK (`google-antigravity`)**: **REJECT PERMANENTLY** (violates ORQST Node/Rust
    toolchain boundary, bundles separate binary wheel, lacks personal OAuth).
  - **`agy acp` (Agent Client Protocol v1 over stdio JSON-RPC)**: **DEFER TO PHASE 2** (do not
    block Phase 1 PTY + Observer). If/when scheduled by the owner, implement as an `OwnedAcp`
    transport (`agy acp --sandbox --disable-telemetry`) adapting Anywh's Apache-2.0 `defs/acp.ts`
    framing, keeping session mode `"default"` so `session/request_permission` maps to ORQST's native
    approval review, and **hard-blocking automated peer delegation (`origin === 'delegation'`)**
    unless authenticated via non-consumer API-key / Enterprise credentials (`gemini-api-key` or
    `agent-platform`).

### 6.3 Read-Only Observer Adapter (`packages/adapters/antigravity/`)

- **Decision**: **IMPLEMENT NOW (Phase 1 Read-Only JSONL Transcript Observer)**.
- **Rationale**: `~/.gemini/antigravity-cli/brain/<conversation-id>/.system_generated/logs/transcript.jsonl`
  provides structured, timestamped UTF-8 JSONL records for user prompts, model responses, model
  slugs, tool invocations/results, subagent spawns, step errors, and per-step token usage without
  touching credentials or live `conversations/*.db` protobuf WAL files.

### 6.4 MCP Integration (`provider-mcp-config.ts`, `terminalMcpPairRequestSchema`, Hub)

- **Decision**: **DO NOT ENABLE ORQST PER-TERMINAL MCP FOR `agy` PTY IN PHASE 1** (`interactive.mcp`
  and `interactive.hub` refused/omitted for `provider: 'antigravity'`; keep `terminalMcpPairMembers`
  restricted to `'codex' | 'opencode' | 'claude'`).
- **Rationale**: `agy 1.5.10` TUI offers no per-invocation CLI flag or environment variable for MCP
  injection, and mutating `~/.gemini/config/mcp_config.json` or `<project>/.agents/mcp_config.json`
  would alter global/workspace state outside the owned terminal lifecycle. Disclose in native launch
  consent that existing user-configured MCP servers in `~/.gemini/config/mcp_config.json` and
  `<project>/.agents/mcp_config.json` may start natively. Per-session non-mutating MCP remains
  available for a future Phase 2 `agy acp` integration via `session/new` `params.mcpServers`.

---

## 7. Normative Implementation Contract for Parallel Workers

### 7.1 Canonical Provider Identifier, Executable Discovery, and Binary Pin

- **Provider ID**: `'antigravity'` across `@orqst/protocol` (`terminalProviderSchema`,
  `eventSchema.shape.adapter`), `@orqst/core`, `apps/tauri/terminal-core`, `apps/bridge`, and
  `apps/dashboard` (`en-US.json` and `pt-BR.json` i18n keys required per `AGENTS.md §2`).
- **Launcher basename mapping**: in `packages/core/src/terminal/local-cli.ts` and
  `apps/tauri/terminal-core/src/profiles/local_cli.rs`, map provider `'antigravity'` to executable
  filename **`'agy'`** (never `'antigravity'`). Retain `~/.local/bin` in
  `localCliFallbackDirectories(home)`; no new installer directory is needed on macOS/Linux.
- **Exact reviewed binary pin**:
  ```ts
  export const reviewedAntigravityTuiBinary = Object.freeze({
    version: '1.5.10',
    sha256: '780ee763a9938a37b45c7f9d6ae31747d7c574358fd10c64d3a1cdc36faf2798',
  });
  ```
  - Enforce canonical `realpath`, `O_RDONLY | O_NOFOLLOW`, Mach-O magic check, owner (`uid === 0 ||
uid === getuid()`), mode (`!(mode & 0o022)` and `mode & 0o111`), ancestor non-writability, and
    bounded SHA-256 verification before preparation review and again before signed PTY spawn.
  - If multiple byte-equivalent `agy` paths match the exact pin, apply the same reviewed tool-PATH
    precedence rule established for OpenCode (`docs/research/opencode-executable-equivalence.md`).

### 7.2 Managed PTY Manifest, Flags, Settings Override, and Environment Allowlist

- **Manifest schema (`version: 4`, Node + Rust parity required)**:
  - `version: 4`, `provider: 'antigravity'`, `trust: 'native-same-user'`
  - `executable`: `{ path, sha256: '780ee763a9938a37b45c7f9d6ae31747d7c574358fd10c64d3a1cdc36faf2798' }`
  - `executableVersion: '1.5.10'`
  - `node`: `{ path, sha256 }` (retained for manifest/supervisor parity)
  - `toolPath`: `terminalToolPathSchema.optional()`
  - `identity`: `terminalIdentitySchema.optional()`
  - `project`: canonical project directory path
  - `state`: canonical private (`0700`) ORQST state directory path
  - `model`: `terminalModelSelectionSchema.optional()`
  - `preparation`: `terminalPreparationBindingSchema.optional()`
  - `authentication`:
    ```ts
    z.strictObject({
      mode: z.literal('reuse-existing'),
      home: path,
      sharedNativeConfiguration: z.literal(true),
    });
    ```
  - `interactive`:
    ```ts
    z.strictObject({
      sharedNativeSessions: z.literal(true),
      nativeStartupAuthorized: z.literal(true),
      nativeDatabaseWritesAcknowledged: z.literal(true),
    });
    ```
    (No `mcp` or `hub` fields in `version: 4` Phase 1.)
- **Disjoint directory invariants**: `config.state` must be strictly outside `config.project`,
  `config.authentication.home`, and every Antigravity native root (`~/.gemini`,
  `~/.gemini/antigravity-cli`, `~/.gemini/antigravity`, `~/.gemini/antigravity-ide`,
  `~/.gemini/config`). Never read, copy, or symlink `~/.gemini/oauth_creds.json`, `state.json`,
  `config.json`, `jetski_state.pbtxt`, or `~/Library/Keychains`.
- **Exact `argv` for `antigravity-terminal-v1`**:
  ```ts
  const sessionSettings = JSON.stringify({
    agentMode: '',
    toolPermission: 'request-review',
    enableTerminalSandbox: true,
    allowNonWorkspaceAccess: false,
    showTips: false,
    showFeedbackSurvey: false,
    notifications: false,
  });
  const argv = [
    '--sandbox',
    '--settings',
    sessionSettings,
    ...antigravityModelArguments(config.model), // ['--model', value] when selected
  ];
  ```
  - Forbidden flags in managed PTY profiles: `--dangerously-skip-permissions`, `-p`, `--print`,
    `--prompt`, `--input-format`, `--output-format`, `-c`, `--continue`, `--conversation`,
    `-i`, `--prompt-interactive`, `--remote-control`, `--remote-agent`.
- **Passive model discovery (`model-selection.ts` & Rust `model.rs`)**:
  - Inspect `~/.gemini/antigravity-cli/settings.json` passively via `terminalFile` (`O_RDONLY |
O_NOFOLLOW`, `2 MiB` max; `ENOENT` -> `null`). Never execute `agy models`.
  - Offer `'CLI default'` (`value: null, source: 'cli-default'`). If `settings.json` contains a
    valid string `"model"`, validate it with an Antigravity-scoped safe-label schema (`1..160`
    printable chars matching `/^[a-zA-Z0-9][a-zA-Z0-9 ._:/#@+()-]*$/`, no control/format chars, no
    leading `-`) so saved Antigravity labels such as `"Gemini 4 Carbon (Medium)"` as well as slugs
    such as `"gemini-4-carbon-medium"` are accepted and passed as discrete `['--model', value]`
    elements without shell evaluation. Disclose in consent text that `agy` TUI falls back to its
    account default if a configured model is unavailable.
- **Exact child environment allowlist (`antigravity-native-identity-no-inherited-credentials-v1`)**:
  ```ts
  {
    HOME: config.authentication.home,
    TMPDIR: join(config.state, 'tmp'),
    PATH: terminalToolPath(config.toolPath),
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    TERM: 'xterm-256color',
    AGY_CLI_DISABLE_AUTO_UPDATE: 'true', // MUST be exact 'true', NEVER '1'
  }
  ```
  - Zero inheritance from `process.env`. Never forward `GEMINI_API_KEY`, `GOOGLE_API_KEY`,
    `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, `AGY_ADC_AUTH`, `BROWSER`, or any
    `ANTIGRAVITY_*` / `OVERCLOCK_*` variable.
- **Required native consent disclosures**: state clearly that `agy` runs as a native same-user
  process (only agent-spawned shell commands use macOS `sandbox-exec`), shares `~/.gemini/` and OS
  Keychain identity, opens writable SQLite WAL databases (`conversation_summaries.db`,
  `conversations/*.db`) and `brain/` directories, may start user-configured hooks/plugins/MCP
  servers from `~/.gemini/config/` and `<project>/.agents/`, disables background self-updates via
  `AGY_CLI_DISABLE_AUTO_UPDATE=true`, starts in supervised `request-review` + `--sandbox` mode (which
  the human user can still change inside the TUI), and enforces ORQST's 30-minute owned-process
  deadline without descendant containment.

### 7.3 Read-Only Observer Contract (`packages/adapters/antigravity/`)

- **Default observed root**: `~/.gemini/antigravity-cli/brain` (overridable via explicit bridge
  configuration for isolated synthetic/disposable tests). Do **not** scan `~/.gemini/antigravity/`
  (Desktop App) or `~/.gemini/antigravity-ide/` unless explicitly configured.
- **Allowed files (strict allowlist + `O_RDONLY | O_NOFOLLOW` + `realpath` containment)**:
  1. `<brainRoot>/<conversationId>/.system_generated/logs/transcript.jsonl` (where
     `<conversationId>` matches strict UUID `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`).
  2. Optional line-targeted read of `<brainRoot>/<conversationId>/.system_generated/logs/transcript_full.jsonl`
     **only** when a record in `transcript.jsonl` carries non-empty `truncated_fields` and complete
     tool/message text within `MAX_LINE` (`2 MiB`) is required.
  3. Optional read-only **byte-copied** snapshot of `~/.gemini/antigravity-cli/conversation_summaries.db`
     (+ `conversation_summaries.db-wal` if present, bounded at `16 MiB`, copied via `O_RDONLY |
O_NOFOLLOW` into ORQST's private `0700` temp directory before opening with `node:sqlite`
     `{ readOnly: true }`) solely to resolve `workspace_uris` (`file://` -> canonical `cwd`),
     `title`, `agent_name`, and explicit `parent_conversation_id`. **Never open any SQLite file
     in-place inside `~/.gemini/`**, and **never open `conversations/*.db`, `oauth_creds.json`,
     `google_accounts.json`, `state.json`, `config.json`, `mcp_config.json`,
     `mcp_oauth_tokens.json`, `jetski_state.pbtxt`, or `history.jsonl`**. If
     `conversation_summaries.db` is absent or unreadable, fall back cleanly to `cwd = undefined`
     (`workspaceId = stableId('workspace', 'unknown:' + conversationId)`).
- **Reader, checkpoint, and recovery invariants (`AGENTS.md §5, §7`)**:
  - Enforce ORQST's `8 MiB` per-file scan budget and `2 MiB` `MAX_LINE` oversized-record discard
    path; never follow symlinks (`followSymlinks: false`, `entry.isSymbolicLink()` skip,
    `O_NOFOLLOW`, `realpath` prefix check).
  - Verify `dev:ino`, `checkpoint.offset <= stat.size`, and the 64-byte SHA-256 `anchor` immediately
    preceding `checkpoint.offset`; reset to byte `0` on mismatch (handling `agy`'s in-place
    `"RUNNING"` -> `"DONE"` tail rewrites, truncation, and rotation).
  - **Hold checkpoint before a trailing `"RUNNING"` record**: emit live `"RUNNING"` events if
    desired, or stage checkpoints only up to the byte offset of the last contiguous terminal
    (`"DONE"` / `"ERROR"`) line so the in-flight tail line is cleanly re-read once finalized.
  - Deterministic event IDs: `stableId('antigravity', machineId, conversationId, String(step_index),
recordType, statusPhase, eventType)` so full-file replay after tail rewrite is strictly
    idempotent.
- **Record-to-`eventSchema` normalization rules**:
  - First valid record of `<conversationId>`: emit `session.started` (`status: 'unknown'`,
    `parentSessionId` only from explicit `conversation_summaries.parent_conversation_id` or a
    verified parent `invoke_subagent` result, never inferred from prose or timing).
  - `USER_INPUT` (`status === 'DONE'`): emit `agent.message` (`role: 'user'`, `text:
safeText(content)`) and `agent.started` (`status: 'running'`, `turnId: "turn:" + step_index`).
  - `PLANNER_RESPONSE`:
    - Update `state.model = str(record.model) ?? state.model`.
    - When `status === 'DONE'` and `content` is non-empty: emit `agent.message` (`role:
'assistant'`, `text: safeText(content)`, `model: state.model`).
    - For each entry in `tool_calls`: if `name === 'ask_question'`, emit
      `agent.intervention.required` (`status: 'waiting_for_user'`, `name`, `text:
safeText(JSON.stringify(args))`); otherwise emit `agent.tool.started` (`name`, `callId:
"${conversationId}:${step_index}:${toolIndex}"`, `text: safeText(JSON.stringify(args))`).
    - When `status === 'DONE'` and integer `input_tokens`, `output_tokens` are present: compute
      `input = input_tokens + (cache_read_tokens ?? 0)`, `cached = cache_read_tokens ?? 0`,
      `output = output_tokens`, `total = input + output`; record per-step usage keyed by
      `step_index` in `state` (so replays never double-add!), update cumulative session totals, and
      emit `agent.tokens.updated` with `usage: cumulativeSessionUsage`, `usageKind:
'session_cumulative'`, `responseUsage: stepUsage`, `responseId:
"${conversationId}:step:${step_index}"`, `model: state.model`.
    - When `status === 'DONE'` and `tool_calls` is empty/absent: emit `agent.completed` (`status:
'completed'`, `result: safeText(content)`). (Per `AGENTS.md §5`, this means the latest
      observed turn completed, never that the `agy` process exited; inactivity never implies
      completion.)
    - When `status === 'ERROR'`: emit `agent.failed` (`status: 'failed'`, `text:
safeText(record.error) ?? safeText(content)`).
  - `GENERIC`:
    - When `status === 'DONE'` after a tool call: emit `agent.tool.completed` (`status: 'running'`,
      `role: 'tool'`, `text: safeText(content)`).
    - When `status === 'ERROR'`: emit `agent.failed` (`status: 'failed'`, `text:
safeText(record.error) ?? safeText(content)`).
  - Untrusted content rule (`AGENTS.md §2, §6`): never translate, render as HTML, or evaluate
    captured `content`, `thinking`, `tool_calls`, or `error` fields.

---

## 8. Explicit Unknowns and Remaining Validation Gates

Per `AGENTS.md §10, §11`, the following remain **UNKNOWN** or **NOT VALIDATED** in this research-only
increment and must not be advertised as verified until executed with owner authorization:

1. **Authenticated live TUI + model turn in ORQST Tauri Webview (`NOT RUN`)**: disposable PTY
   testing proved unauthenticated startup, terminal escape sequences, `--settings` memory-only
   application, `AGY_CLI_DISABLE_AUTO_UPDATE=true`, and clean `0` exit; authenticated Keychain
   unlock, model reply rendering, `Shift+Tab` mode cycling, and macOS `sandbox-exec` child behavior
   inside ORQST's Tauri PTY host require human native acceptance.
2. **Exact `agy` version/schema stability of `transcript.jsonl` across future self-updates
   (`UNKNOWN`)**: `transcript.jsonl` is documented inside `agy 1.5.10`'s own system prompt and
   `docs/hooks.md`, but carries no explicit schema-version field of its own. Unknown record types or
   missing fields must fail safe (skip or preserve partial evidence without crashing ingestion).
3. **`thinking_tokens` and `cache_write_tokens` in passive observer mode (`UNAVAILABLE` in
   `transcript.jsonl`)**: `agy 1.5.10` writes `input_tokens`, `output_tokens`, and
   `cache_read_tokens` to `transcript.jsonl`, omitting `thinking_tokens` and `cache_write_tokens`
   (which exist only in internal protobuf `conversations/*.db` blobs and headless `stream-json`).
   Document this counter-coverage gap honestly in `docs/adapters/` and
   `docs/research/token-and-plan-accounting.md`.
4. **Local passive model catalog & plan/quota limits (`UNAVAILABLE` passively)**: `agy` stores no
   offline model-list cache or quota snapshot on disk; `agy models`, `/usage`, and `/credits`
   require authenticated network calls.
5. **Windows and Linux `agy` binary hashes and sandbox parity (`UNKNOWN`)**: only macOS `arm64`
   `1.5.10` (`780ee763...`) was inspected on this machine.

---

## 9. Post-Integration Reconciliation Note — 2026-11-18

The original research evidence and normative proposal above are preserved intact. During parallel
integration into `feat/frontend-768`, the shipped Phase 1 increments chose narrower contracts in
three places:

1. **Managed PTY launch contract ([antigravity-managed-terminal.md](../design/antigravity-managed-terminal.md))**:
   - The implemented `version: 4` manifest (`antigravity-profile.ts` and Rust `profiles/antigravity.rs`)
     defines `interactive: { sharedNativeSessions: true }` (without `nativeStartupAuthorized` /
     `nativeDatabaseWritesAcknowledged`), passes `argv: ['--model', value]` (or `[]` for CLI
     default, without `--sandbox` or `--settings`), validates model slugs with
     `/^[a-zA-Z0-9][a-zA-Z0-9._:/#@+-]*$/`, and allows only `HOME`, `PATH`, `LANG`, `LC_ALL`,
     `TERM`, and `TMPDIR` in the child environment (`AGY_CLI_DISABLE_AUTO_UPDATE='true'`,
     `--sandbox` / `--settings` overrides, and display-label model strings with spaces/parentheses
     remain future hardening candidates, not active source behavior).
   - Under the 2026-11-18 _Always inside a Feature_ owner decision
     ([terminal-native.md](../api/terminal-native.md#always-inside-a-feature-and-sender_unassigned-refusal--2026-11-18)),
     every new Antigravity PTY terminal (`version: 4`, `hub: false`) is created inside the active
     Feature or the workspace's deterministic default Feature (`General` / `Geral`). Because
     Antigravity has no per-session MCP relay (`hub: false`), hub-connected peers do not list it and
     receive `unknown_terminal` if addressing its handle, while unassigned hub senders receive
     `sender_unassigned`.
2. **Read-only observer contract ([antigravity.md](../adapters/antigravity.md))**:
   - `@orqst/adapter-antigravity` prefers `transcript_full.jsonl` (falling back to
     `transcript.jsonl`), resolves workspace URIs from `cache/conversation_metadata.json` without
     copying or opening `conversation_summaries.db`, and keeps `tokenUsage: false` /
     `SessionView.usageRecorded: false` rather than summing per-step incremental counters into
     synthetic `session_cumulative` snapshots (`AGENTS.md §5`).
3. **Reference license alignment**:
   - Upstream Anywh at `4f8aef7b5f0dc9cf0832e457c224dc09a9792a21` is licensed under **Apache-2.0**
     (superseding the historical MIT citation copied into `antigravity-managed-terminal.md` from an
     older `reuse-first-audit.md` table). No Anywh code was copied into the Antigravity PTY or
     observer implementations.
