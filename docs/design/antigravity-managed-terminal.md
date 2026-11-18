# Antigravity managed terminal provider — 2026-11-18

Owner decision (2026-11-18): Google Antigravity (`agy`) is supported as an
owned managed PTY terminal provider (`'antigravity'`, manifest `version: 4`,
profile `antigravity-terminal-v1`) alongside Codex, Claude Code and OpenCode in
both the Node 24 Core and the Rust terminal Core (`ORQST_RUST_TERMINALS=1`).

## Reuse-first audit (§13)

| Candidate                    | Reference / Commit SHA                                                                                                        | Inspected modules                                                                                                                                          | License                                        | Decision                                                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anywh                        | [`546f189c04415c3c5af5f40e3931a0a90b9aba31`](https://github.com/anywh-sh/anywh/tree/546f189c04415c3c5af5f40e3931a0a90b9aba31) | `relay/src/runtimes/`, `docs/architecture.md`, `docs/agent-host.md`                                                                                        | MIT (per `docs/research/reuse-first-audit.md`) | **Do not use for Antigravity driver:** upstream defines Codex/Claude runtimes only and has no `agy` adapter or Mach-O digest pin.                                                                                                  |
| Tucano                       | [`0501956d127699300209902e889f3e69a0948766`](https://github.com/eduwxyz/tucano/tree/0501956d127699300209902e889f3e69a0948766) | Agent channel/mention routing (`docs/research/reuse-first-audit.md`)                                                                                       | Inspected in prior audit                       | **Do not use for Antigravity PTY:** no `agy` CLI lifecycle or session-scoped MCP client contract exists upstream.                                                                                                                  |
| ORQST managed terminal stack | [`ed2d230b02c78d73533545f31fd76a90d45a39e2`](../../packages/core/src/terminal)                                                | `opencode-launch-plan.ts`, `opencode-profile.ts`, `interactive-profile.ts`, `local-cli.ts`, `model-selection.ts`, `apps/tauri/terminal-core/src/profiles/` | Apache-2.0                                     | **Reuse directly and adapt narrowly:** add `antigravity-launch-plan.ts`, `antigravity-profile.ts` and `profiles/antigravity.rs` on the existing Mach-O digest, supervisor, journal, offline-recovery and Studio catalog contracts. |

## Reviewed binary pin and refusal contract

- Provider ID: `antigravity`
- Executable name: `agy` (discovered passively across reviewed `PATH` directories and `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`)
- Reviewed installation on macOS arm64:
  - Canonical path: `/Users/walissonhmsouza/.local/bin/agy` (Mach-O 64-bit arm64 executable, `224,809,248` bytes)
  - Version: `1.5.10`
  - SHA-256: `780ee763a9938a37b45c7f9d6ae31747d7c574358fd10c64d3a1cdc36faf2798`
- Unreviewed or missing `agy` installations are refused before provisioning or launch with localized EN/PT catalog and dialog reasons (`executable_unreviewed`, `executable_not_found`, `executable_inspection_failed`).

## Ownership, environment allowlist and model selection

- **Existing login reuse (`reuse-existing`):** Antigravity resolves its user state under `HOME` (`~/.gemini/config`, `~/.gemini/antigravity-cli`, extensions, hooks, plugins and conversation logs). ORQST never reads, copies or logs user credentials, tokens or Keychain entries.
- **State separation:** Each terminal gets a private `0700` state directory (`terminal.json` at `0600` + private `tmp/`). `validateAntigravitySelection` rejects any state path inside the project, containing `HOME`, or overlapping `~/.gemini`.
- **Minimal environment allowlist:** Only `HOME`, `PATH` (reviewed `terminalToolPath`), `LANG` (`en_US.UTF-8`), `LC_ALL` (`en_US.UTF-8`), `TERM` (`xterm-256color`) and `TMPDIR` (`<state>/tmp`) are passed to the PTY child. Parent shell secrets and API keys are excluded.
- **Model selection (`--model`):** `agy --help` documents `--model <model>` (`Model for the current CLI session`). Passive catalog discovery reads `~/.gemini/antigravity-cli/settings.json` (`model` string) and offers `CLI default` (`argv: []`), recording the source file SHA-256 so drift before launch is refused. Dynamic `agy models` is intentionally not invoked because probing under a disposable `HOME` confirmed it requires interactive sign-in and mutates `~/.gemini` state.

## Why ORQST per-session MCP is unavailable for Antigravity

Probing `agy --help`, `agy mcp --help` and `agy plugin --help` on `agy 1.5.10` under a disposable `HOME` established that:

1. `agy` exposes no `--mcp-config`, `--strict-mcp-config`, `--plugin-dir`, or environment variable to inject a session-scoped MCP client configuration file.
2. `--settings <file>` loads CLI settings keys (`settings.json`), whereas Antigravity MCP servers are read only from global `~/.gemini/config/mcp_config.json`, global `~/.gemini/config/plugins/*/mcp_config.json`, or workspace `<project>/.agents/plugins/*/mcp_config.json`.
3. `agy mcp add` mutates the user's global `~/.gemini/config/mcp_config.json`.

Because ORQST must never mutate the user's global `~/.gemini/config` or project `.agents` files to wire a transient per-terminal relay, per-session MCP is marked **unavailable** for Antigravity (`perInstanceMcp: 'unavailable'`, `mcpConfiguration: 'unavailable_global_or_workspace_only'`):

- `antigravityTerminalProfiles` and `antigravityTerminalEnvironment` throw if any `TerminalMcpLaunch` is supplied.
- `terminalMcpPairRequestSchema` and the Studio MCP communication pair opt-in exclude `antigravity` and display a localized explanation (`studio.tauri.mcpUnavailableAntigravity`).
- In Studio Feature Cores, an Antigravity terminal (`version: 4`, `hub: false`) can coexist in the same Core and Feature alongside hub-enabled Codex, Claude Code and OpenCode terminals without faking hub membership or opening an unused relay binding.

## Rust Core parity (`ORQST_RUST_TERMINALS=1`)

`apps/tauri/terminal-core` implements full manifest `version: 4` parity:

- `profiles/antigravity.rs`, `profiles/config.rs`, `profiles/interactive.rs`, `profiles/local_cli.rs`, `profiles/adapters.rs`, `profiles/model.rs`, `profiles/managed_files.rs`
- RPC profile allowlist (`antigravity-terminal-v1`), enrollment member schema (`pair.rs`, `recovery/schema.rs`), startup manifest key ordering and Studio hub coexistence (`startup.rs`), and byte-equal synthetic golden cases (`tests/golden/profiles.json`).

## Native acceptance checklist (human verification on macOS)

Source and synthetic tests are verified in this increment; native UI and live provider acceptance remain separate human checks:

1. Launch the packaged ORQST Desktop app on macOS with `/Users/walissonhmsouza/.local/bin/agy` (`1.5.10`) installed, open a Workspace and Feature, and click **New terminal**.
2. Confirm **Antigravity** appears in the CLI picker with its passive model option (from `~/.gemini/antigravity-cli/settings.json` when configured, plus **CLI default**), and that **Advanced** disables MCP pair creation with the localized explanation in both `en-US` and `pt-BR`.
3. Confirm native review displays `agy 1.5.10`, SHA-256 `780ee763a9938a37b45c7f9d6ae31747d7c574358fd10c64d3a1cdc36faf2798`, minimal environment allowlist, and shared `~/.gemini` disclosure, then approve **Open** and verify the interactive `agy` TUI renders, resizes and accepts keyboard input only while focused.
4. Enroll a Codex or Claude Code terminal into the same Feature and verify both panes coexist, hide/restore independently, and close cleanly with journal receipts, both under the default Node Core and with `ORQST_RUST_TERMINALS=1`.
5. Temporarily point `PATH` at an unreviewed binary named `agy` (in a disposable directory) and confirm the Studio catalog marks Antigravity **Unavailable** with the localized unreviewed-checksum reason and refuses creation.
