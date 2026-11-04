# Tauri interactive terminal MCP — 2026-11-04

Prepared interactive terminals can now use the existing Core MCP transport in the
Tauri preview. Electron remains available. This is separate from the two-Codex
structured **Managed agents** window and from native provider-tool approvals.

## Workflow

1. Prepare two **fresh**, same-workspace MCP-opted-in manifests through the existing
   [interactive setup](interactive-cli-mcp.md#desktop-composition-opt-in--2026-11-03).
   Keep the existing provider version/hash pins, shared-native-state and strict/merged
   MCP acknowledgments. Selection retains its existing same-provider or reviewed
   Codex/OpenCode pair boundary. Codex/Claude mixed pairs are not newly admitted.
2. Launch the preview with `ORQST_TAURI_TERMINALS` containing those two absolute
   manifest paths. Never select profiles owned by Electron or previous journals.
   Native preparation still creates profiles with MCP disabled; this increment
   ports consent for explicitly prepared MCP manifests.
3. Show and separately approve each signed terminal start. Both instances must
   reach actual owned `running` state. Opening a pane or configuring a relay alone
   grants no task authority.
4. Focus either terminal and choose **Authorize one MCP task A → B → A** in the
   native **Managed Terminal** menu. Review the complete source/target UUIDs,
   workspace, epoch, one-use grant, expiration and byte limits. Cancel is default.
   A is always selected slot 0/source; B is slot 1/worker, regardless of focus.
5. Explicit source `delegate_task` and worker `wait_task`/`submit_result` calls use
   the existing Unix/stdio relay. Authorization sends no prompt, keyboard input,
   provider approval or idle-worker wakeup. One correlated exchange is permitted;
   delivery does not prove model processing.

Blur, layout changes, hiding and shutdown cancel a pending review. Reload/document
destruction invalidates the shared MCP channel. Unknown or interrupted exchanges
are not automatically retried; MCP loss does not fabricate provider exit. Hiding a
retained pane preserves the owned process and an already authorized task channel.
The deadline remains at most 120 seconds; tasks/results remain memory-only.

The previous `ownership_lost` reservation stays quarantined. This feature does not
inspect, reconcile, delete, release or reuse it. Synthetic checks use new private
temporary admission directories and assert their reservation markers remain intact.

## Reproduction

Use the repository's Node 24 / pnpm 10 toolchain:

```sh
pnpm exec tsx --test tests/tauri-terminal-mcp.test.ts tests/tauri-terminal-service.test.ts tests/interactive-mcp.test.ts tests/terminal-mcp.test.ts tests/terminal-mcp-qa.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# As in the Tauri guide, set ORQST_NODE_LICENSE from this exact Node distribution.
pnpm build:tauri-resources
pnpm accept:tauri-terminal-mcp --authorize-synthetic
```

The opt-in acceptance copies staged resources and Node outside the checkout,
compiles the small existing C PTY fixture, starts two synthetic owned PTYs and two
actual Node stdio relays, denies calls before grant, confirms native-consent doubles,
checks the exact UUID-bound exchange and replay denial, and preserves its synthetic
admission marker. The `0.162.1` manifest version is a required contract label on
this C fixture, not a measured provider version or compatibility claim. No installed
provider, login, inference, native credentials or observed session is used.

## Verification and limits

Native menu selection, first-responder focus, native IPC and modal interaction are
not accepted by Node/stdio tests. Rust compilation, Cargo test/Clippy and native
bundle generation are deliberately not run in this increment because only about
2.7 GiB was available. `rustfmt` checks parsing/formatting, not Rust type correctness
or a runnable native application. Existing Tauri binaries are not hot-upgraded.

Real Codex/Claude/OpenCode authentication, MCP protocol negotiation, provider tools,
idle-worker delivery and A-to-B-to-A inference remain pending. Also pending: native
retirement/reselection, durable reconnect, more than two MCP participants, broader
mixed teams, Windows/Linux/Intel acceptance and signed distribution. No ingestion
changed; `validate:local`/`validate:live` and the full browser suite are not run.

Current change results on Node 24.22.2 / pnpm 10.34.9 / macOS ARM64:

| Check                                                                 | Observed result                                                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Existing-suite run after worktree setup                               | 637 passed                                                                                                                          |
| `pnpm test` with the new consent tests                                | 646 passed after rebase; no failures, cancellations or skips                                                                        |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`                           | Passed; existing Vite chunk-size warning remains                                                                                    |
| `pnpm build:tauri-resources`                                          | Passed; Core, dashboard and 18 dependency notices staged                                                                            |
| `pnpm accept:tauri-terminal-mcp --authorize-synthetic`                | Passed; two actual synthetic PTYs and stdio relays, grant/return/replay checks, unchanged synthetic reservation and clean host exit |
| `rustfmt --edition 2021 --check apps/tauri/src-tauri/src/terminal.rs` | Passed; no Cargo/Rust compilation performed                                                                                         |

The first worktree test/typecheck attempts failed because workspace dependency
links had not been created; reusing the existing installed package trees fixed
that setup. The first new fixture used a profile ID refused by the actual private
RPC enum; it was corrected to the existing Codex terminal ID. The timer fixture
was also corrected to install its clock before scheduling consent. No production
guard, timeout or provider pin was weakened. Packaging acceptance was tightened to
separately approve synthetic stops and assert clean host exit, rather than merely
observing an exit after its deadline.

Pinned implementation/license/security decisions are in the
[component review](../research/tauri-interactive-mcp.md).
