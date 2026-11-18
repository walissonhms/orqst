# Structured Claude Studio pilot — 2026-11-18

The **Structured agents** panel in native Studio includes a **Claude** entry
alongside [Codex](structured-codex-pilot.md) and
[OpenCode](structured-opencode-pilot.md) under `ORQST_STRUCTURED_AGENTS=1`.
Core implements the complete `claude -p --input-format stream-json
--output-format stream-json` session, permission routing, response-ID
deduplicated cumulative token accounting, Feature-scoped peer context, and
one-use `orqst_delegate_task` delegation in
`packages/core/src/structured-agents/claude-{process,session}.ts`.

Because Anthropic's current documentation restricts third-party Agent SDK and
`claude -p` products from offering consumer `claude.ai` subscription logins
without prior approval and requires Commercial Terms acceptance for hosted
Claude Code execution, the live Tauri sidecar verifies the reviewed `2.1.318`
executable digest and **stops with `provider_terms_unapproved` before wiring or
launching a real user login**.

## Terms and authentication review (2026-11-18)

Primary Anthropic documents opened on **2026-11-18**:

| Primary source                                                                                                                                                                                  | Relevant terms and technical statements                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Impact on ORQST                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)                                                                                                                    | Under _Can customers offer Claude Code in their products?_, running Claude Code in a product requires agreeing to the [Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms), keeping the `claude` binary unmodified, not removing, disabling, or restricting any built-in authentication method (including Claude account sign-in or a user's API key), and not reselling or intermediating usage. Under _Authentication and credential use_, OAuth is intended for subscription plans in Claude Code and native Anthropic apps; developers building products or services, including with the Agent SDK, _"should use API key authentication"_ and _"Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users"_, while adding: _"Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under Can customers offer Claude Code in their products? above."_ | Creates a direct tension between hosting an unmodified interactive binary under Commercial Terms (with all built-in auth methods preserved) and driving `claude -p` behind a third-party app UI with a minimal environment that strips `ANTHROPIC_API_KEY`. |
| [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) and [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)                                       | `headless` defines `claude -p` as _"using the Agent SDK via the CLI (`claude -p`)"_ and states that `--bare` (which never reads OAuth credentials or the system Keychain and requires `ANTHROPIC_API_KEY`, `apiKeyHelper`, or cloud credentials) _"will become the default for `-p` in a future release"_. `agent-sdk/overview` states: _"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."_ Package license is Commercial Terms of Service, not Apache-2.0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Do **not** bundle `@anthropic-ai/claude-agent-sdk` or its proprietary binary. Do **not** wire live consumer subscription login to `claude -p` in Studio without explicit owner legal/commercial approval or an API-key (`--bare`) authentication contract.  |
| [Consumer Terms of Service](https://www.anthropic.com/legal/consumer-terms) and [Usage Policy](https://www.anthropic.com/legal/aup)                                                             | Consumer Terms (governing Free, Pro, Max, and Ultra plans) prohibit accessing Services _"through automated or non-human means, whether through a bot, script, or otherwise"_ except via an Anthropic API Key or explicit permission. AUP prohibits routing requests through consumer subscriptions or misrepresenting the client.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Multi-agent `A → B → A` orchestration over consumer subscription OAuth in a third-party desktop app lacks explicit authorization unless confirmed with Anthropic or run with API-key / commercial credentials.                                              |
| Branding rules in [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview#branding-guidelines) and [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) | Within an Agents dropdown, `"Claude"` (or `"Claude Agent"`) is permitted; `"Claude Code"` and `"Claude Code Agent"` are not permitted as third-party feature or menu names. Plain-text factual documentation may state that ORQST runs the installed Claude Code CLI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Studio's provider selector uses `"Claude"` (`structuredAgents.provider_claude`) in both `en-US` and `pt-BR`.                                                                                                                                                |

### Blocker and owner options

1. **Current state in `tauri-structured-agents-host.ts`:** selecting **Claude**
   in Studio passively inspects `PATH` and `~/.local/bin/claude` against the
   reviewed `2.1.318` SHA-256 (`677a2ea7bf576cedd20e191d973914ed8a41796f53a63b1923381ddc4d5b5e7d`).
   Missing, unreadable, or unreviewed binaries return `executable_not_found`,
   `executable_inspection_failed`, or `executable_unreviewed`. When the exact
   reviewed binary is present, the sidecar stops before spawning `claude` or
   exposing any subscription login and returns
   `{ status: 'unavailable', reason: 'provider_terms_unapproved' }`.
2. **Unblocking paths for an owner decision:**
   - **API-key / cloud-provider `--bare` path:** launch with `--bare` (which
     never reads macOS Keychain or `~/.claude/.credentials.json` OAuth tokens)
     and supply an explicitly user-configured API key helper or enterprise
     gateway/cloud configuration.
   - **Confirmed unmodified-binary path:** owner acceptance of Anthropic's
     Commercial Terms of Service and written confirmation from Anthropic Sales
     covering local `claude -p --input-format stream-json` invocation with the
     user's existing CLI login while preserving built-in authentication methods.

## Reference research and provenance (§13)

| Candidate                 | Pinned source, files, and license                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Contract comparison and decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code CLI `2.1.318` | Local canonical Mach-O `/Users/walissonhmsouza/.local/share/claude/versions/2.1.318` (`sha256: 677a2ea7bf576cedd20e191d973914ed8a41796f53a63b1923381ddc4d5b5e7d`), [release tag `v2.1.318`](https://github.com/anthropics/claude-code/releases/tag/v2.1.318), [pinned changelog](https://github.com/anthropics/claude-code/blob/646b74189c735abbccf78ef5cb7ddd38a07a36eb/CHANGELOG.md), [CLI reference](https://code.claude.com/docs/en/cli-reference), [permission modes](https://code.claude.com/docs/en/permission-modes), [MCP](https://code.claude.com/docs/en/mcp), [sessions](https://code.claude.com/docs/en/sessions), [cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking). Governed by Anthropic Consumer/Commercial Terms; proprietary. | Implement against the documented wire contract (`control_request`, `control_response`, `control_cancel_request`, `initialize` with `sdkMcpServers`, `mcp_message`, `can_use_tool`, `interrupt`, `system/init`, `stream_event`, `assistant`, `user`, `result`). Zero binary or SDK code incorporated.                                                                                                                                                                                                                                                          |
| Anywh, Apache-2.0         | [Pinned tree `4f8aef7b5f0dc9cf0832e457c224dc09a9792a21`](https://github.com/anywh-sh/anywh/tree/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21), [LICENSE](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/LICENSE) (Apache-2.0, no root NOTICE). Inspected `relay/src/agentHost/claudeProcess.ts` (`ClaudeProcess`), `relay/src/runtimes/defs/claude/persistent.ts` (`buildPersistentArgs`, `encodeUserMessage`, `encodeInterrupt`), `relay/src/runtimes/defs/claude/session.ts` (`isToolResultOnly`, `isMainThreadEvent`, `CLAUDE_AGENT_WORKER_ENV`), `relay/src/runtimes/defs/claude/mcpSpawnConfig.ts`, `relay/src/runtimes/streams/claudeStreamJson.ts` (`mapClaudeEvent`), and `relay/tests/fixtures/fake-claude-persistent.mjs`.       | Adapt the persistent `-p --input-format stream-json --output-format stream-json --verbose --include-partial-messages` turn lifecycle, filtering of subagent (`parent_tool_use_id`) and `[Request interrupted...]` markers, and non-tool-result `user` filtering. Do not adopt Anywh's selectable `bypassPermissions` mode, detached host daemon, or external HTTP MCP permission server; ORQST uses `--permission-prompt-tool stdio` and an in-process `sdkMcpServers` control channel over the owned stdio pipes. No upstream source or dependencies copied. |
| T3 Code, MIT              | [Pinned tree `b8b5affac42a8fd55d89214996c28afdb3c54ab1`](https://github.com/pingdotgg/t3code/tree/b8b5affac42a8fd55d89214996c28afdb3c54ab1), [LICENSE](https://github.com/pingdotgg/t3code/blob/b8b5affac42a8fd55d89214996c28afdb3c54ab1/LICENSE) (MIT, no root NOTICE). Inspected `apps/server/src/provider/Drivers/{ClaudeDriver.ts,ClaudeHome.ts,ClaudeExecutable.ts}`, `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`, `apps/server/src/provider/ClaudeTurnTokenUsage.ts`, `docs/user/providers-claude.md`, and `apps/server/package.json`.                                                                                                                                                                                                         | T3 Code depends on `@anthropic-ai/claude-agent-sdk` (`^0.3.321`), which is proprietary under Anthropic's Commercial Terms and incompatible with ORQST's Apache-2.0 repository rule (§8). Adapt the `CLAUDE_HOST_SESSION_VARIABLES` / `ELECTRON_RUN_AS_NODE` environment hygiene and `managed-mcp.json` check (`hasClaudeManagedMcpConfig`) in an independent implementation without Effect or SDK dependencies.                                                                                                                                               |
| Tucano, Apache-2.0        | [Pinned tree `0501956d127699300209902e889f3e69a0948766`](https://github.com/eduwxyz/tucano/tree/0501956d127699300209902e889f3e69a0948766), [LICENSE](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE) (Apache-2.0, no NOTICE). `src/core/engines/claude.ts` and `src/core/router.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Keep ORQST's persistent owned session, native one-use grant, and correlated tool-result receipt rather than per-turn ephemeral CLI spawns and router-model speaker selection.                                                                                                                                                                                                                                                                                                                                                                                 |
| ORQST                     | `packages/core/src/structured-agents/{service,session,usage,codex-process,codex-session,opencode-process,opencode-session}.ts`, `packages/core/src/terminal/{interactive-profile,claude-transcript-usage}.ts`, and `packages/core/src/managed-codex/{dynamic-tools,line-splitter}.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Reuse `processTransport`, `BoundedLineSplitter`, `StructuredProjection`, `delegationTool` (`orqst_delegate_task`), `reviewedClaudeTuiBinary` (`2.1.318`), and the response-ID deduplication invariants from `claudeTranscriptUsage`.                                                                                                                                                                                                                                                                                                                          |

No third-party source files, binary assets, or npm dependencies were added.

## Wire protocol, permissions, MCP, resume, and usage

### 1. Launch contract and environment allowlist (`claude-process.ts`)

- **Binary pin:** `2.1.318`, SHA-256
  `677a2ea7bf576cedd20e191d973914ed8a41796f53a63b1923381ddc4d5b5e7d`
  (satisfying the `>= 2.1.259` requirement for `--permission-prompts` and
  `>= 2.1.268` `pending_permission_requests` on `initialize`).
- **Arguments (`structuredClaudeArgs`):**
  `-p --input-format stream-json --output-format stream-json --verbose
--include-partial-messages --setting-sources user --session-id <uuid>
--no-session-persistence --permission-mode default --permission-prompt-tool
stdio --permission-prompts host --strict-mcp-config --settings
'{"disableAllHooks":true,"permissions":{"defaultMode":"default","ask":["Bash","Edit","Write","NotebookEdit","WebFetch","WebSearch"]}}'
--allowedTools mcp__orqst__orqst_delegate_task --disallowedTools
Agent,AskUserQuestion --disable-slash-commands --no-chrome` (with `--bare`
  replacing `--setting-sources user` in the credential-free smoke check).
- **Minimal environment (`structuredClaudeEnvironment`):** forwards only
  canonical `HOME`, bounded `PATH`, `LANG`/`LC_ALL`/`LC_CTYPE`, and optional
  absolute `TMPDIR` and `CLAUDE_CONFIG_DIR`, plus `DISABLE_AUTOUPDATER=1`,
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_TELEMETRY=1`,
  `DISABLE_ERROR_REPORTING=1`, `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1`, and
  `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1`. Parent `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_BASE_URL`,
  `ANTHROPIC_PROFILE`, `CLAUDECODE`, `CLAUDE_CODE_*` host-session variables,
  `ELECTRON_RUN_AS_NODE`, and `OTEL_*` variables are never forwarded.
- **Enterprise policy guard (`verifyClaudeManagedConfigAbsent`):** refuses
  startup if `/Library/Application Support/ClaudeCode`,
  `/Library/Managed Preferences/com.anthropic.claudecode.plist`, per-user
  Managed Preferences, or `/etc/claude-code` exists, because enterprise managed
  settings outrank `--settings` and forbid `--strict-mcp-config`.

### 2. Permission mode and native confirmation (`claude-session.ts`)

- **Why `default` + `permissions.ask` instead of `plan` or `bypassPermissions`:**
  In Claude Code `2.1.302+`, `default` (Manual) mode auto-allows only workspace
  reads while routing edits, commands, and network actions to the permission
  host. By contrast, `plan` mode categorically blocks MCP tools (preventing
  `mcp__orqst__orqst_delegate_task`), and user `permissions.allow` lists merge
  across settings files (`settings.md`). Because Claude Code evaluates
  `permissions.ask` rules at **step 3** before permission modes (step 4) and
  allow rules (step 5), supplying `ask` rules for `Bash`, `Edit`, `Write`,
  `NotebookEdit`, `WebFetch`, and `WebSearch` guarantees every mutating or
  network tool call emits `control_request` (`subtype: "can_use_tool"`) over
  stdio even if `~/.claude/settings.json` contains saved allow rules.
  `bypassPermissions` and `--dangerously-skip-permissions` are never used, and
  `system/init` rejects any session reporting a mode outside `default`/`plan`.
- **One-shot native decisions:** `Bash` maps to `command`
  (`accept` / `decline` / `cancel`), `Edit`/`Write`/`NotebookEdit` to
  `file_change` (`accept` / `decline` / `cancel`), and bounded `Read`/`Glob`/`Grep`
  prompts to `permission` (`accept` / `decline`) only when the serialized review
  is `<= 2000` characters and unchanged by `redact()`. `AskUserQuestion`,
  `requires_user_interaction: true`, web tools, oversized diffs, and secret-bearing
  inputs degrade to `unsupported` (`decline` only). `accept` echoes the exact
  original `input` without `updatedPermissions` so no session-wide or persistent
  rule is ever written; `cancel` sends `{ behavior: "deny", interrupt: true }`;
  `control_cancel_request` marks pending approvals `unavailable`.

### 3. `--mcp-config`, `--strict-mcp-config`, and `A → B → A` delegation

- `--strict-mcp-config` and `--setting-sources user` prevent `.mcp.json`,
  `~/.claude.json`, plugins, and claude.ai connectors from auto-connecting in
  `-p` mode (where workspace trust dialogs do not appear).
- During `initialize`, Core registers the in-process SDK MCP server
  `sdkMcpServers: ["orqst"]` over the existing stdio control channel
  (`subtype: "mcp_message"`), exposing `orqst_delegate_task` without opening any
  socket or writing temporary MCP files.
- A human turn with an active 5-minute one-use grant receives the exact target
  and task instructions alongside the fresh Feature-scoped peer roster. Core
  verifies the scope, expiry, target readiness, and exact arguments, consumes
  the grant once, blocks nested delegation on delegated turns, and requires the
  main-thread `user` `tool_result` receipt for `mcp__orqst__orqst_delegate_task`
  before marking the delegation `returned`.

### 4. Session lifecycle, resume, interrupt, and EOF cleanup

- Each session generates a fresh UUID (`--session-id`) with
  `--no-session-persistence`, keeping multi-turn context in the owned subprocess
  without writing or resuming `~/.claude/projects/` transcripts. `--resume` and
  `--continue` are intentionally omitted so external sessions are never adopted.
- **Interrupt** sends `control_request` (`subtype: "interrupt"`) and waits for
  the correlated `result` (`terminal_reason: "aborted_tools"` / `"interrupted"`)
  before reporting `interrupted`, leaving the process alive for later turns.
- **Stop / EOF cleanup** gives an active turn up to 1 second to settle after
  interrupt, closes `stdin` with a 1.2-second EOF grace so an idle `claude -p`
  exits cleanly with `{ code: 0, signal: null }`, and escalates `SIGTERM` then
  `SIGKILL` to the owned POSIX process group (`-pid`). Unexpected EOF or mid-turn
  exit marks unsettled turns and unreceipted delegations `unknown`.

### 5. Cumulative usage and cost accounting (§5)

- `ClaudeUsageTracker` in `packages/core/src/structured-agents/usage.ts` counts
  each main-thread API response ID (`message.id`, `parent_tool_use_id == null`,
  excluding `isSidechain`, `isApiErrorMessage`, `<synthetic>`, and foreign
  `session_id` frames) **at most once**, so parallel tool-use `assistant`
  chunks sharing one `message.id` never inflate totals.
- Per Anthropic's Messages rate-limit and Agent SDK cost-tracking contracts,
  `input = input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
  and `cached = cache_read_input_tokens` (`cached <= input`, never added twice).
- Placeholder step `output_tokens` values are monotonically updated from
  `stream_event` (`message_delta`) and reconciled against the turn's
  `result.usage.output_tokens` without double-counting. Positive finite
  `total_cost_usd` values are labeled `{ currency: 'USD', source: 'claude_estimate' }`;
  zero is omitted because unpriced and zero-cost runs both emit `0`.

## Verification and native acceptance steps

```sh
pnpm exec tsx --test packages/core/test/structured-claude.test.ts tests/structured-usage.test.ts
ORQST_STRUCTURED_REAL_CLAUDE=/Users/walissonhmsouza/.local/share/claude/versions/2.1.318 \
  pnpm exec tsx --test packages/core/test/structured-claude.test.ts
```

- **Synthetic suite:** covers reviewed digest and managed-config checks,
  `HOME`/`CLAUDE_CONFIG_DIR`/`TMPDIR` allowlisting and secret/OTLP stripping,
  file preservation on stop and spawn failure, one-shot `command`/`file_change`/
  `permission`/`unsupported`/`cancel` approvals and `control_cancel_request`
  withdrawal, ANSI/bidi sanitization, subagent exclusion, response-ID
  deduplicated usage and `claude_estimate` USD labeling, turn interrupt vs
  process exit, descendant process-group reaping (`ESRCH`), mid-turn crash
  `unknown` retention, Feature-scoped peer rosters, Claude `A → B → A` grant and
  receipt enforcement, and bidirectional mixed routes across Claude, Codex, and
  OpenCode.
- **Optional real binary smoke (`ORQST_STRUCTURED_REAL_CLAUDE`):** verifies the
  pinned `2.1.318` SHA-256, spawns `claude` with `--bare` in a disposable `/tmp`
  project, `HOME`, and `TMPDIR` (never reading macOS Keychain or `~/.claude`
  subscription credentials and submitting no model prompt), completes the live
  `initialize` and `orqst` SDK MCP control handshake, and verifies clean EOF
  exit (`{ code: 0, signal: null }`) and PID teardown (`ESRCH`).

### Native Studio acceptance checklist (isolated Tauri preview)

1. Launch an isolated Apple Silicon Tauri preview with `ORQST_STRUCTURED_AGENTS=1`
   and open **Structured agents** inside an active Feature in both `en-US` and
   `pt-BR`.
2. Confirm the provider dropdown lists **Codex**, **OpenCode**, and **Claude**
   (labeled `Claude`, never `Claude Code`).
3. Select **Claude**, enter a session name, and click **Start session**:
   - With the reviewed `2.1.318` binary installed, confirm Studio refuses
     startup before any native launch or login access and displays the localized
     `reason_provider_terms_unapproved` message.
   - With no `claude` on `PATH`/`~/.local/bin` or a different binary digest,
     confirm Studio displays `reason_executable_not_found` or
     `reason_executable_unreviewed`.
4. Confirm existing **Codex** and **OpenCode** structured sessions and
   Feature switching continue to behave unchanged.
