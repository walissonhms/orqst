# OpenCode saved models and native review — 2026-11-04

Integration starts at clean published main `f056c3a`; candidate `6bfc53a` over
`4eeeea2` is retained on `feat/opencode-model-catalog-ux` and applied as `c98bfd3`.
The prior app remains frozen at `7bfdca3`. This delivery additionally closes the
candidate's missing distributed MIT notice and missing pre-write configuration review.

## Cause and bounded correction

OpenCode discovery previously read native configuration only. OpenCode 2.2.5 records
favorite/recent/variant choices in its native XDG state `opencode/model.json`.
The existing passive reader now offers those recorded references as `native-state`,
`availability:unverified`. These are saved choices, not a complete catalogue, account
entitlements or evidence of an effective model. Empty state can still mean CLI default
only. No dynamic CLI query, provider server or auth database is accessed.

The adapted decoder uses the pinned MIT source documented in the
[research audit](../research/opencode-model-catalog.md). Root NOTICE preserves all
previous attributions and adds upstream copyright plus the complete MIT license.
The existing resource script distributes NOTICE; dependencies and lockfiles are unchanged.

The reader retains canonical paths, O_NOFOLLOW, ownership/permissions and a 2 MiB
budget, now also enforced during reads if a native file grows after fstat. Arrays are
bounded to 64 entries each, variants to 128 keys, ids to 160 characters and the picker
to 128 total options. Only the selected semantic provider/model/variant binds state
evidence; unrelated preference/provider/cache changes stay irrelevant. Removing or
changing the selected reference refuses it. A review regression also fixes nested
model identifiers (`provider/org/model`) being displayed but failing revalidation.
Original Codex TTL/deadline and context/binary/grant/dispatch fences remain intact.

The large native sheet came from concatenating consent text and compact review JSON
(up to 4 KiB per page). The candidate removed all pre-write detail, which was not
sufficient informed consent. The integrated flow instead shows real project, CLI,
model and terminal identities, plus the existing effect disclosures. Pair summaries
identify the source and worker. **Full details…** exposes the complete same immutable
plan before any commit/write. Details cannot approve: Back returns to the summary,
and Cancel, expiry or stale context denies. This reuses the private confirm pipe and
existing parented native dialog buttons; no new IPC command, window, server or runtime.
Technical paths/hashes/configuration remain optional; no 4 KiB JSON is shown by default.
The separate exact native operational Open and its independent grants are unchanged.
Its native visual acceptance, and the legacy wizard's page presentation, remain pending.
Failure sheets retain the candidate's short localized outcome and reason.

## Verification scope

The integrated source passes 198 distinct synthetic/static Node cases across 18
selected model/preparation/profile/Studio/consent/MCP/locale suites (one combined final
run, no sum with prior runs). The 62 distinct Rust tests pass with `custom-protocol`,
including three new native review state-machine cases; Clippy all targets with
`-D warnings`, full typecheck, rustfmt and diff checks pass. Full lint/format pass; package results are recorded after their final runs. The full Node suite, root build,
ingestion validation and browser/native/provider acceptance are not run.

The first typecheck caught an unused import after the bounded-reader edit; the first
Clippy caught an unnecessary borrow. Both were fixed without relaxing checks.
An unused test-fixture parameter was also corrected before final lint.
The worker's 450 overlapping claimed cases are prior evidence, never added to current
counts. Tests use synthetic fixtures/facades and disposable files. No user app, CLI,
provider, probe, Core runtime, PTY or auth database is started or operated for acceptance.

Native visuals, real provider opening/entitlement/effective model, real communication,
Quit, packaging acceptance on other platforms and Electron retirement remain pending.
A dynamic OpenCode catalogue and the worker's parallel-server proposal are **not
approved or implemented**. No Tucano server/probe/stop code is incorporated.

## Packaging boundary

Only `dist/native-preview-opencode-models-ux/ORQST Preview.app` and its generated
`build-manifest.json`/short technical report may be created. Source must be committed,
atomically pushed and tagged before builds. Builds use the existing target691, one
job, debug/incremental disabled, locked offline Cargo and the existing Node license.
The filtered dashboard and existing resource script are used; root `pnpm build` is
not run. Original Node Developer ID bytes/license, every previous Preview tree and
Coexistence698 are compared. Only the outer app is ad-hoc signed, then deep/strict
verified. The app is not launched. Generated outputs and logs stay uncommitted.

## Frozen package verification

Published source freeze: `b78342fed677ea34f449b042bced6f0bf0fea20d`, annotated tag
`delivery/2026-11-04-opencode-models-ux-source` (includes integration `c98bfd3`
and the review corrections). The final package-report commit changes Markdown only.

Local artifacts: [ORQST Preview.app](../../dist/native-preview-opencode-models-ux/ORQST%20Preview.app),
[build-manifest.json](../../dist/native-preview-opencode-models-ux/build-manifest.json)
and [short technical report](../../dist/native-preview-opencode-models-ux/technical-report.md).
All generated artifacts/logs remain outside Git.

| Current check              | Actual result                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node focused source checks | 198 distinct cases, 18 suites, final combined run; no failures/skips; previous worker counts not added                                            |
| Rust checks                | 62 custom-protocol tests; locked/offline all-target Clippy with `-D warnings`; rustfmt                                                            |
| Source checks              | Full `pnpm lint` (ESLint/Prettier), `pnpm typecheck`, `git diff --check`                                                                          |
| Build                      | Filtered dashboard, existing resources script, serial target691 locked/offline custom-protocol native build and app bundle                        |
| Artifact integrity         | 115 configured resource files match before/after signing; distributed NOTICE exactly matches source including full pinned MIT grant               |
| Node/signatures            | Original Developer ID Node bytes and distribution license unchanged; outer ad-hoc signing without deep resigning, deep/strict verification passed |
| Preservation               | All seven previous Preview trees and target691 Coexistence698 match complete content/mode inventories                                             |
| Cleanup                    | Original candidate branch preserved locally/remotely, worktree clean and no open files before Git worktree removal without force                  |

Packaged native executable SHA-256:
`c08c43aaf9a52bf5c449cbaa33cb37ea136bc5178437f77678966ddc2c7a782a`.
Minimum free space through build/sign/verification: **25.0262 GiB** (4 GiB gate
never approached). Dashboard retains its existing chunk-size warning; Cargo/Clippy
have no warnings. No check was relaxed. The app was not started, native/provider
acceptance was not performed, and no effective-model/communication/Quit/Electron
retirement claim follows from compilation or packaging.
