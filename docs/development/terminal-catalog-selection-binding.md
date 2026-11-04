# Codex catalogue false invalidation — 2026-11-04

The newly reported failure is `catalog / catalog_changed / not_started` during
**+Terminal → Codex CLI → gpt-6.1-sol → Open**. It precedes this attempt's file/runtime
effects. See [exact reproduction, source research and selection invariants](../research/terminal-catalog-selection-binding.md).

Catalogue revalidation now checks context and the actual selected evidence rather
than a digest of all provider lists. Cache refreshes cannot renew the original
selected deadline; relevant model/configuration/executable/context changes continue
to refuse. No provider is opened automatically, and no failed mutation is retried.

## Validation

All commands use the existing Node 24.22.2 / pnpm 10.34.9 toolchain. No installation,
Node copy or application build was performed.

| Check                                                                                                                                                                               | Actual result                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original source + `--test-name-pattern='catalog regression isolated field:'`                                                                                                        | Exit 1 as expected: all 3 isolated tests reproduce `catalog / catalog_changed / not_started`. The corrected sources were restored immediately after the comparison. |
| `pnpm exec tsx --test tests/terminal-model-selection.test.ts tests/terminal-selected-preparation.test.ts tests/terminal-creation.test.ts tests/tauri-studio-preparation-ui.test.ts` | Exit 0: 97 passed, 0 failed/skipped/cancelled. Synthetic files/profiles and static EN/PT renderer only; no provider/session.                                        |
| `pnpm exec tsc --noEmit`                                                                                                                                                            | Exit 0 against the complete repository TypeScript configuration.                                                                                                    |
| ESLint on the four changed TypeScript files                                                                                                                                         | Exit 0.                                                                                                                                                             |
| Prettier on changed source/docs; `git diff --check`                                                                                                                                 | Exit 0.                                                                                                                                                             |
| Disk                                                                                                                                                                                | 27 GiB initially, 26 GiB after focused checks (rounded `df -h` values). No cleanup of external artifacts was attempted.                                             |

An initial corrected test run failed the existing invalid-cache error assertion
because the new parser exposed its schema error internally; normalizing it back to
the existing fixed catalogue-change message corrected the failure. An initial
worktree typecheck failed to resolve package-scoped dependencies; linking the
checkout's already installed dependencies allowed the full typecheck to pass,
without installing/upgrading anything. Those temporary links are removed before
handoff. No check was weakened and no captured content or config was printed.

No app, CLI, Core process or PTY session was started. Build/resources/Cargo/install,
full repository tests and local ingestion validation are outside this source-only
check. Native/provider acceptance remains open. The requested isolated worktree
is retained for integration, with no main commit, push or tag.

## Main integration and package freeze

Main fast-forwarded from `df0da2cf02c0a7ae046281b978740a423bb9535b` to the original
candidate `4eeeea2c9dfce4aade719c24d3e7cb4e2f866823`. This retains the shared-document
Electron type closure and every earlier feature; no older base was substituted.
The same four focused files were run together exactly once after integration:
**97 passed, zero failed/skipped/cancelled**. Full `pnpm lint` (ESLint and Prettier),
`pnpm typecheck` and `git diff --check` passed with Node 24.22.2 / pnpm 10.34.9.

The existing policy/notification package remains prior evidence: 20 distinct pure
Node tests, the same 59 Rust tests in default and custom-protocol configurations,
and Clippy. These were not rerun or added to the 97-case total. This fix changes no
Rust source, dependency or lockfile. Full Node tests, ingestion validation, browser,
Core/PTY/provider execution and native acceptance were not run.

The next package is restricted to `dist/native-preview-codex-catalog-fix/ORQST Preview.app`.
Its generated manifest must record a published source freeze before the filtered
dashboard/resources/custom-protocol native build and bundle, exact resource and
Node integrity, outer ad-hoc signing without deep re-signing, and deep/strict
verification. All earlier Preview trees and target691 Coexistence698 are preserved.
Each heavy step requires at least 4 GiB free. No application is launched by this
delivery; actual opening and effective model remain a separate human acceptance.
