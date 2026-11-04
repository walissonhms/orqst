# Core availability and explicit MCP pair integration — 2026-11-04

Base `28a03a2dd977dcb4324cef1785cc312a0433cc07` was clean and matched published
main before integration. Delivery `90509ca9a847da1e5d973947eeece414cdcc0dd6`
was integrated as `86a29cb`; `8c458de454679ef129341e90230103f306c3e970` as
`49e5322`. Both locale merges were additive and conflict-free. Existing tests and
all previous EN/PT values are preserved. The initial source review required no correction; the native Clippy check
subsequently found the allocation described below.

## Reviewed contracts

- The helper, Rust validator and Studio retain bounded `stage`/`code`/`effects`.
  Native commit/open evidence cannot be downgraded to `not_started`; uncertain
  transport and post-provision failures remain `possible`. Selection, signed Open,
  focus/document/generation, revalidation and one-shot latches remain distinct.
- Observer startup failure creates a fixed in-memory local document. Runtime
  error, EOF, termination or the exact disconnected frame latch unavailability.
  Only confirmed termination of that exact owned child releases its handle;
  uncertainty retains it and continues draining. No automatic retry, replacement,
  adoption or managed-host shutdown. Quit suppresses late presentation.
- The unavailable protocol serves only exact GET `orqst-unavailable://local/index.html`.
  Escaped EN/PT text, no script/IPC/network/link/button/retry controls, no raw
  errors or paths, restrictive CSP and exact navigation. Existing remote
  capabilities still require the owned dashboard origin/document.
- Normal CLI → model → Open remains MCP-disabled. The separate unchecked pair
  option requires both catalog model IDs, either Codex/OpenCode source direction,
  two fresh opted-in manifests and one validated workspace. Every complete native
  review page must be accepted before catalog/model revalidation and commit.
  Append remains denied. Signed operational Open for each member and the separate
  one-use MCP task grant reuse the existing Core, broker and Unix/stdio relays.
  A granted task does not dispatch PTY text or wake a provider. Correlated results
  report the worker's result; they do not independently verify output quality.
- No runtime, transport, queue, schema migration, ownership/grant expansion,
  provider probe, observer execution authority or Feature Delegate is added.

The pinned Anywh/Tucano sources and Apache-2.0 root licenses were rechecked in
separate existing research checkouts. The decisions remain to retain ORQST's
existing Core and narrow adaptations; no upstream source, assets or dependencies
were added. See the component-specific evidence in
[Core availability](tauri-core-unavailable.md),
[pair research](../research/tauri-mcp-product-pair.md) and
[API/security contract](../api/tauri-mcp-product-pair.md).

## Source verification

Node 24.22.2 / pnpm 10.34.9, using the recorded toolchain environment from the
preceding terminal-fixes manifest:

- Combined focal run: **84 distinct Node tests passed**, with selection/shared
  suites listed once. Includes passive synthetic provisioning, strict failures,
  model drift/cancellation, opt-out and pair/broker/facade/locale contracts.
  The `private packaged` / `private preparation parent` helper-process cases were
  excluded by name. No provider/Core host/PTY/socket/native application was run.
- Intercepted Chromium preparation facade passed EN/PT, both model directions,
  opt-out, keyboard, append denial and 320px overflow. Existing dashboard CSS was
  read without rebuilding any old app. This is not WebKit/native acceptance.
- Repository lint, typecheck, targeted formatting, rustfmt and diff checks passed
  before publication. Initial lint found formatting in the new documentation;
  Prettier corrected it and final lint passed. Exact commands/exits are retained
  with the generated build manifest, rather than committing logs.

## Frozen build and preservation

The initial integration tag is
`delivery/2026-11-04-tauri-mcp-unavailable-integration` (`68dec9d`), preserved as
history. Its two Rust configurations passed the same 47 tests, but Clippy
`-D warnings` failed with `clippy::cmp_owned` at `unavailable.rs:54`. No
dashboard/resource/native build or package ran from that initial freeze.

The corrected package freeze uses
`delivery/2026-11-04-tauri-mcp-unavailable-uri-fix`. The minimal correction compares
borrowed scheme, authority and path-and-query strings exactly, retaining exact
GET and rejecting query/port/case/path variants without permissive URI equality.
The pinned `http` 1.5.0 source implements case-insensitive URI/authority equality;
its suggested direct URI comparison would not retain this strict contract.
A new response regression covers uppercase authority/scheme/path, dot and encoded
paths, empty query and non-GET methods; existing port/authority/query/CSP tests
remain. No CSP, capability, navigation, ownership or uncertainty guard changes.
The original failed Clippy log and both freeze records remain in the generated
manifest. Corrected source checks precede the new commit/push/tag; Clippy and
appropriate Rust tests are repeated from that published freeze before build.
Commit/push and a clean-source notification to the coordinating pane precede any
build. Actual Rust counts, Clippy and build/package outcomes are recorded in the
new generated local
[manifest](../../dist/native-preview-mcp-unavailable/build-manifest.json), next to
[ORQST Preview.app](../../dist/native-preview-mcp-unavailable/ORQST%20Preview.app).
Those paths do not exist in a source-only checkout. Source is not edited after
freeze merely to upgrade the build status in this document.

Only `/tmp/orqst-691-target` is reused, serially, with locked/offline Cargo,
LLVM fallback, jobs=1, incremental=0 and debug=0. The build is gated above 4 GiB
available. No root `pnpm build`, install, dependency/lock changes or extra target.
Resources use the existing staged runtime; the new bundle moves on the same
volume. Sign only the outer app ad hoc, then verify deep/strict and compare exact
Node bytes/original signature and configured resources.

Preserve all five earlier app trees, executables and resource bytes/modes:
`native-preview`, `native-preview-studio`, `native-preview-enrollment`,
`native-preview-terminal-fixes`, and the Coexistence698 bundle in target691.
The manifest records before/after hashes. No app is launched or closed; no
provider/Core/PTY/probe/auth database, quarantine or uncertain state is acted on.
Worker worktrees may be removed only after their changes and original branches
are preserved in published Git, clean status and no open use are confirmed.

## Remaining acceptance

- Native static unavailable rendering/navigation, capability denial, focus,
  close/hide and final Quit in the exact packaged WebKit app.
- Real Codex/OpenCode opening, authentication, effective provider/model/variant
  and one separately granted MCP exchange with matching actual task IDs.
- Historical Codex refusal cause, silent Core health/watchdog and safe managed
  recovery are unproven or unimplemented. No automatic reconnect is introduced.
- Feature/N-member communication, MCP append, busy-provider delivery and durable
  routing/recovery remain open. Electron remains until full retirement gates pass.
- Full Node suite, ingestion/local-data validation, native/provider acceptance,
  cross-platform packaging, notarization and release acceptance are not claimed.
