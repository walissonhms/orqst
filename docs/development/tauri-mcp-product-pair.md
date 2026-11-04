# Explicit Codex/OpenCode communication pair — source increment

This increment connects the Tauri product picker to the existing experimental
interactive MCP pair. It does not validate real-provider communication or replace
the Workspace → Feature → TerminalPane → AgentSession architecture with a pair
limit. The currently tested Preview in `dist/native-preview-terminal-fixes` is
unchanged; source changes do not update an already packaged application.

## Product workflow

1. In a fresh initial terminal selection, choose the existing workspace/Feature,
   source CLI (Codex or OpenCode) and its catalog model. Normal **Open** stays
   unchanged and does not enable ORQST MCP.
2. Explicitly select **Prepare an experimental Codex/OpenCode communication pair**.
   Choose the opposite CLI's worker model from its existing catalog. Refreshing,
   switching CLI or changing scope clears this option and both stale choices.
   The option is unavailable for append to a live Core.
3. **Review and open communication pair** reviews every complete native page:
   exact source/worker terminal UUIDs, separate models, executable pins, workspace,
   shared native state, MCP and OpenCode migration/startup acknowledgments.
   Cancelling before commit creates nothing. Possible writes remain preserved.
4. The existing owned runtime opens both panes. Separately confirm each native
   **Open** (signed startup/output/keyboard). Both must actually reach owned running
   state before the native **Managed Terminal → Authorize one MCP task A → B → A**
   action can authorize communication. A/source is the chosen provider; B/worker
   is the opposite provider, regardless of focus.
5. Review the exact separate one-use grant and expiration. In the native CLI,
   instruct the worker to call `wait_task` and return through `submit_result` with
   the returned `taskId`; instruct the source to call `delegate_task` once with the
   bounded task. These instructions are user actions, not automatic PTY injection.
   The existing relay advertises source/worker tools. Opening or authorizing alone
   sends no task and does not wake an idle provider.
6. A matching worker result returns to that source `delegate_task`. Preserve actual
   MCP/task IDs and distinguish broker admission/receipt/result from provider
   processing or verified output. Unknown outcomes receive no automatic retry.
   The existing broker permits one exchange per pair, not repeated tasks.

Native/provider compatibility, authentication, effective model/variant, tool
negotiation, worker behavior and completed real exchange remain unaccepted.
The historical Codex opening refusal has no newly established cause. OpenCode
still uses full native `--standalone`; model/MCP configuration uses the existing
merged inline configuration without invented CLI flags or model substitution.

## Verification in this delivery

Only source-level checks, disposable passive provisioning, pure signed-broker
contracts and intercepted renderer facades are allowed. The focused tests never
start a provider, CLI probe, Core host, PTY or native application. Temporary
synthetic configurations contain no user auth database or sessions. No build,
resource staging, install, Node copy, Cargo target or native acceptance is run.

Current command results are recorded below before commit. Disk was approximately
27 GiB available before the worktree and remained approximately 27 GiB during
source/test work. All user apps, fixtures, reservations and uncertain attempts
are preserved. Main integration/publication is delegated to the coordinating pane.

On Node 24.22.2 / pnpm 10.34.9 / macOS ARM64:

| Check                                                                                                                                                                                                  | Result                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec tsx --test --test-name-pattern='product MCP\|product independent' tests/terminal-selected-preparation.test.ts`                                                                              | 15 passed; fresh per-member model/MCP configuration, both directions, complete native-page cancellation, drift/expiry/focus refusal and normal non-MCP opening. No sessions.        |
| `pnpm exec tsx --test tests/terminal-mcp-pair-contract.test.ts tests/terminal-creation.test.ts tests/tauri-studio.test.ts tests/tauri-studio-preparation-ui.test.ts tests/provider-mcp-config.test.ts` | 30 passed; passive factory/configuration, facade and pure signed-broker contracts. No Core host/socket/PTY/provider.                                                                |
| `pnpm exec tsx scripts/accept-studio-preparation.ts --authorize-synthetic-studio-ui` with `ORQST_STUDIO_CSS_DIR` pointing read-only at the existing dashboard CSS                                      | EN/PT passed: default opt-out, independent model/direction choices, live-append denial, no mutation resend, keyboard and 320px overflow. Intercepted Chromium renderer facade only. |
| `pnpm lint`, `pnpm typecheck`                                                                                                                                                                          | Passed.                                                                                                                                                                             |
| Existing isolated `rustfmt --edition 2021 --check apps/tauri/src-tauri/src/terminal_creation.rs`                                                                                                       | Passed; new native validator test is source-only, not executed or type-checked by Rust compilation.                                                                                 |
| `git diff --check`, local documentation links, existing locale-value comparison                                                                                                                        | Passed; every pre-existing EN/PT value is unchanged, additions stay in `studio.tauri` / `tauriPreparation`.                                                                         |

The first lint run found an unused test binding; the first renderer run expected
`Codex` instead of the actual translated `Codex CLI` label. Both fixture issues
were corrected and those checks passed again. The default PATH had no rustfmt;
the already installed isolated formatter was used without installation or Cargo.
Full `pnpm test`, build, native compilation, native/provider acceptance and
ingestion validation were not run under this source-only authorization.

## Checklist / integration fragments

- [x] Explicit bilateral preparation in the existing product picker; unchecked by
      default; separate real catalog/model selection for each provider and either
      source direction.
- [x] Complete native configuration review, catalog/model revalidation, private
      atomic pair publication, Feature assignment and existing signed Open/MCP flow.
- [x] No new Core runtime, session manager, server, transport or queue; native
      `main.rs`, `sidecar.rs` and `desktop.rs` unchanged.
- [ ] Native compilation/package and human UI acceptance on the final integrated
      artifact; old Preview packages do not acquire this source automatically.
- [ ] One separately authorized real Codex/OpenCode exchange with matched task ID,
      verified effective models and actual provider/tool evidence.
- [ ] Historical Codex cause and final native Quit/provider acceptance.
- [ ] Feature permissions/mentions, N-member MCP, append, busy-provider dispatch,
      durable queue/reconnect and cross-Feature routing; Feature Delegate remains
      disabled. Saved Feature metadata grants no communication authority.

README/ROADMAP/CHANGELOG/V6 tracker integration fragment: **Explicit experimental
Codex/OpenCode pair preparation is implemented in source, with per-member catalog
models, native bilateral review and the existing separate one-task Core/MCP grant.
Normal Open remains MCP-disabled. Real CLI/native acceptance and Feature/N-member
communication remain pending.** This fragment supersedes only the statement that
product/native preparation has no explicit MCP composition; retain older dated
acceptance evidence and all remaining gates.

See [API and security](../api/tauri-mcp-product-pair.md) and
[pinned source/license decisions](../research/tauri-mcp-product-pair.md).
