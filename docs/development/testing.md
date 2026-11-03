# Testing and validation

Use Node 24.x and pnpm 10.34.9. The local application never imports test fixtures.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:browser
pnpm validate:local --with-browser
```

## Automated suites

The previously validated observer baseline used the built-in Node runner through
`tsx`, with 25 cases. Core/Analytics development may add cases; use current command
output for current counts and results, rather than treating this baseline as a fresh run:

| Suite           | Cases | Purpose                                                                                                                                    |
| --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| normalizer      | 7     | Validated source shapes, inherited history, lifecycle evidence, communication labels, credential redaction, invalid usage                  |
| store           | 6     | Cumulative accounting, restart, permissions, rollback, stale state, retention, notification preferences                                    |
| observer        | 3     | Partial UTF-8/JSONL, malformed and oversized records, truncation/rotation/replay, symlink rejection, source preservation, watcher delivery |
| API             | 4     | Origin/authentication/input/static boundaries, ordered WebSocket replay/live delivery, unauthorized rejection                              |
| locales         | 1     | Both interface catalogs have matching keys                                                                                                 |
| service/runtime | 4     | Private runtime configuration, credential exclusion, XML escaping, invalid input and unmanaged destination preservation                    |

`pnpm test:browser` runs three Chromium checks against a separate, explicitly synthetic temporary source:

1. Desktop rendering, language persistence, escaped results, manual association and sound preference activation.
2. 390px responsive layout and workspace navigation without document overflow.
3. New source records appended outside the app update the page and token total without reload; notification history is created once and retained after reload. A stubbed browser permission denial is reported honestly.

The browser harness uses port 4318 and refuses to reuse an existing server. It removes its source/database/state files on exit. Screenshots under `/tmp/orqst-*.png` contain labeled synthetic activity only; traces stay in gitignored `test-results/`. Browser tests require a prior dashboard build.

## Service and runtime safety

`tests/service.test.ts` adds four cases: private-runtime/loopback configuration with unrelated secret exclusion, XML path escaping, invalid configuration rejection before writes, and preservation of an unmanaged runtime destination. These are filesystem/plan checks and do not install a real launch agent in CI.

## Explicit native Codex acceptance

`pnpm validate:live` is an opt-in developer acceptance command. With an already caught-up local ORQST, Chromium, and an authenticated Codex CLI, it creates a disposable file/workspace, invokes a separate native Codex read-only task, and observes it through the ordinary ORQST API/WebSocket and browser. It checks discovery, a tool call/result, completion, actual final text, notification policy, and cumulative tokens against Codex's own source file.

The command uses real provider usage and leaves Codex's normal native session history intact. It removes its disposable task directory. It never fabricates protocol events or inserts activity into SQLite and is not called by the app, `pnpm test`, browser fixtures, or CI. The application remains an observer without agent-control endpoints.

## Actual local data

`pnpm validate:local` selects up to eight recent real Codex JSONL files below 5 MiB and copies them to a private temporary directory. It computes expected totals independently from thread-scoped cumulative records and compares the imported totals. It then checks duplicate scans, a closed/reopened database, source-prefix integrity and cleanup. Only aggregate counts are printed.

`--with-browser` additionally launches the compiled bridge in a child process against disposable copies, opens Chromium, verifies session count and session-detail events, and shuts down the process. It does not capture real-data screenshots or publish conversations. Run `pnpm build` and install Chromium first.

This does not test the complete session archive or prove every Codex release compatible. Real source data must never be committed. Synthetic fixtures must remain explicitly labeled and confined to tests.

## Evidence and limits

See [Validation status](../../README.md#validation-status) for the public summary. Local acceptance reports and agent working documents are excluded from version control. GitHub Actions runs lint, types, tests, build and Chromium; hosted CI has not yet been observed.

Not established by these checks: actual OS notification delivery, audible playback on the owner's device, real provider failure/input-request records, multi-gigabyte backfill latency, continuous soak behavior, other browsers, Linux/Windows/WSL. The follow-up managed-service check also verified browser reconnection without reload after a real service restart. Arbitrary network interruptions still need further testing.

## Incremental delivery and integration

1. Inspect the repository, applicable instructions, README, roadmap and ADRs before
   each change. Maintain [requirement coverage](../architecture/product-requirements.md)
   against implementation evidence; existing/partial/absent does not mean accepted.
2. Select a bounded backlog outcome with dependencies, risks, tests and acceptance
   from [ROADMAP](../../ROADMAP.md). Record product/security decisions as ADR additions;
   preserve earlier plans, audits and benchmark evidence.
3. Implement authorized non-destructive increments using current versions/patterns.
   Run lint, typecheck, tests and build; fix regressions and report any failed or
   skipped check. Ingestion changes also require `pnpm validate:local`; relevant UI
   changes require browser checks. Keep fixtures synthetic and source data private.
4. At integration, review Core/Bridge ownership and Analytics migration/accounting
   together, v1 compatibility, replay, shutdown/startup, source preservation, retention,
   model changes/unknown models, period baselines, unavailable data and export privacy.
   Update actual API/schema docs only when implementations and tests establish them.
5. Update public changelog/status and commit only the scoped product change after
   relevant checks. Do not version local plans, agent reports, captured content or
   generated output. List exact commands, outcomes and limitations in the delivery.

Development is already authorized; repeating a blanket phase-approval gate is not
required. Product decisions, destructive actions, credentials, external costs and
ungranted permissions still need an explicit decision. Do not run token-consuming
live acceptance/benchmarks or install/restart the owner's service as incidental
validation. A synthetic green suite does not prove real-provider/Desktop acceptance.

The Core/Bridge extraction and Analytics library integration on 2026-11-02 passed
`pnpm lint`, `pnpm typecheck`, `pnpm test` (57 cases including nested cases),
`pnpm build`, `pnpm test:browser` (3 Chromium cases), and
`pnpm validate:local --with-browser` (8 bounded real-session copies). Replay/restart,
source prefixes and cumulative totals were preserved. No service restart or paid
live benchmark was performed. Analytics model attribution has synthetic tests only;
the real-source validation checks observer/built-Bridge compatibility.

The [Analytics acceptance cases](../architecture/model-usage-analytics.md#integration-acceptance)
are required before claiming the complete screen. The global Desktop MVP also needs
real-machine terminal/model selection, native notification, Markdown save and filtered
model usage evidence without Bridge regression. No 1.0 announcement before owner acceptance.

## Browser Analytics integration

The bounded aggregate route and first ranking view passed `pnpm lint`,
`pnpm typecheck`, `pnpm test` (64 Node cases), `pnpm build` and `pnpm test:browser`
(11 Chromium cases). Tests include strict query/auth/privacy/admission boundaries,
calendar/DST filters, races, empty/null/zero/error states, escaping, mobile layout
and both locales. Most new UI cases intercept clearly synthetic summaries; one
unmocked integration writes two synthetic session files only inside the disposable
browser source root, then reconciles ranking/shares through the actual observer,
Store and HTTP route. Native histories and the installed database are not test fixtures.

After clarifying the capacity message, locale parity, build and the affected
error/unmocked browser cases passed again. No paid provider call or real multi-model
benchmark was run. Real multi-model ranking, large-history performance, time series,
exports and qualified task comparisons remain outside this acceptance.

## Worker Analytics queries

`pnpm test` runs the TypeScript worker directly using the existing tsx development
loader; no build, new dependency or installed database is required. Fixtures use
clearly synthetic events and disposable file-backed SQLite WAL stores, because an
isolated worker cannot read a connection-local `:memory:` database. The synchronous
local inspection library still supports in-memory stores.

`pnpm build` emits both `dist/bridge.mjs` and `dist/analytics-worker.mjs`. Deploy both
together; production workers do not load tsx or source TypeScript. Test bundle
execution only with disposable storage and synthetic sources, using an unused
loopback port. Do not restart the installed service as part of tests.

Worker checks cover history beyond the old synchronous API budgets, aggregate
parity, cumulative/source priority/cache/replay semantics, scopes, unknown models,
retention, concurrent ingestion, cancellation, timeout, concurrency rejection and
read-only/schema preservation. Browser checks cover localized worker errors and
retry without stale/partial totals. These checks do not establish arbitrary archive
latency, long-running load, real-provider multi-model acceptance or the Desktop MVP.
The watchdog responds with timeout independently of cleanup, and success requires
confirmed cleanup before the deadline. A delayed-termination fake verifies that
no late success is accepted, the slot stays busy, and shutdown still awaits cleanup.
Native SQL and OS/event-loop scheduling may delay termination or the watchdog
callback; the deadline is not a hard real-time guarantee.

For concurrent browser runs, use a free `ORQST_BROWSER_PORT`; the production port
4317 is rejected. See [isolated browser test ports](browser-tests.md).

The worker increment was checked with Node 24/pnpm 10: lint, typecheck, 80 Node
cases, build and 13 Chromium cases passed. The 310-session/approximately-57000-event
archive case uses synthetic SQLite data. A separate production-bundle smoke started
`node dist/bridge.mjs`, exercised the authenticated endpoint and its colocated worker
with 310 synthetic sessions/1240 events, reconciled 31000 reported tokens (12400
cached, a subset of input), preserved schema 1 and exited cleanly. Disposable
storage and non-production loopback ports were used; the installed service and
native histories were not test targets. These are bounded synthetic checks, not
real-provider or arbitrary-archive acceptance.

## Durable metric evidence upgrade

Use Node 24/pnpm 10 and disposable databases only. `pnpm test` includes synthetic
schema-1 upgrade/backfill, failed migration/rollback/reopen, transactional ingestion,
retention before/after upgrade, deterministic replay/mirrors, conflicting/missing
models, canonical totals/cache and worker parity/budget/cleanup regressions. These
fixtures do not prove real-provider comparative rankings or installed-service upgrade.
Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, then
`ORQST_BROWSER_PORT=4320 pnpm test:browser` only if that port is free. Never stop an
unrelated listener. `pnpm validate:local` reads bounded native sources into disposable
storage; it makes no provider calls and prints aggregates, not content.

Production/service paths still build `dist/bridge.mjs` and colocated
`dist/analytics-worker.mjs`; development workers register tsx internally. Tests must
exercise source workers without a prebuild and the built bridge separately. No
service install/restart is part of this increment. The owner integrates schema 2
only after review and a SQLite-aware backup including WAL. An older writer refuses
schema 2; test recovery against a disposable backup rather than downgrading installed
storage. Backfill time/disk and unbounded-on-disk metric growth remain operational
limits despite bounded query budgets. See [data model](../architecture/data-model.md).

The durable-evidence increment was checked on macOS with Node 24.22.2 and pnpm
10.34.9: lint, types, 90 Node cases, build and 13 Chromium cases passed. Bounded local
validation used 8 real source copies/8 sessions in disposable storage: replay and
restart were stable, cumulative totals reconciled, source prefixes were unchanged,
and built Bridge/browser smoke passed, including the production Analytics worker
route. No installed database migration, service restart, provider call or real-model
comparative acceptance was performed.

## Local lifecycle and artifact-reference contracts

`tests/lifecycle.test.ts` verifies strict version/identity/provenance validation,
independent historical session/turn/task/process semantics, exact retained sequence
selection, detail expiry and content exclusion. `tests/lifecycle-qa.test.ts` provides
independent adversarial coverage in a separate file. These use synthetic in-memory and disposable file-backed
Store/Core fixtures; they do not read native session files or touch installed state.
The existing API/WS and browser suites remain the compatibility checks. Build and
built-bundle checks apply even though no new dashboard feature or transport is added.
Ingestion code is unchanged, so this increment does not require a new real-source
`validate:local` run. Native artifacts, current source availability and process/task
outcomes remain unvalidated and unimplemented.

## Minimal macOS Desktop observer

On 2026-11-02, the first Electron checkout client passed `pnpm lint`,
`pnpm typecheck`, `pnpm test` (109 cases including six independent Desktop policy
cases), `pnpm build`, `ORQST_BROWSER_PORT=4320 pnpm test:browser` (13 cases) and
`pnpm test:desktop`. The private development toolchain was Node24.22.2/pnpm10.34.9;
the real Electron45.2.1 window reported Chromium156.0.8078.75, bundled Node24.22.1
and module ABI150 on macOS26.3/arm64. Independent QA also reran the native smoke.
No Bridge/SQLite native-addon compatibility is inferred from this runtime: the client
imports neither Core nor database.

`tests/desktop-policy.test.ts` covers bounded port and URL containment;
`tests/desktop-qa.test.ts` independently checks policy negatives, source hardening,
the single narrow Artifacts preload/IPC boundary, absence of generic filesystem/
shell/control methods, and dependency ownership. This test evolved from the initial
no-preload shell assertions when native saving was deliberately introduced; see the
[native save contract](../api/artifacts.md#native-desktop-save-contract). `scripts/smoke-desktop.ts` uses
Playwright `_electron` with real Chromium, a real Bridge and only disposable synthetic
sessions/storage/profile on an ephemeral port. It verifies Node globals absent,
denied new windows/notifications, native-session HttpOnly/Strict cookies, online UI,
Bridge restart and dashboard reconnect, native window close/reopen, initial Bridge
offline fallback/retry and Bridge survival after quitting Desktop. Captures live in
a disposable output directory (or `ORQST_DESKTOP_SMOKE_OUTPUT` when explicitly set).
The app menu uses native
roles; fallback text follows OS locale, while the existing dashboard retains its own
language preference. Setup and limits are in [Desktop development](desktop.md).

The installed Bridge/service/database and native provider sessions were not used,
restarted or migrated. No provider call, global installation, release or paid signing
was performed. Ingestion is unchanged; `validate:local` was not rerun for this slice.
This does not validate a packaged/signed `.app`, other macOS versions/Intel,
Windows/Linux, native notifications/tray, long-running soak or the complete Desktop MVP.

## macOS tray/native alert mechanism

The next 2026-11-02 increment adds `tests/desktop-monitor.test.ts` for baseline,
reconnect/replay, category/source/status/identity gates, minimized notification content,
strict snapshot projection, bounded HTTP input and validated session hashes.
`tests/desktop-monitor-qa.test.ts` independently covers cursor rollback replay,
burst limits and the single-instance guard. No installed data is used.

The extended disposable Electron smoke captures actual Tray menus and Notification
objects through test-only Playwright main-process instrumentation. It intercepts native
`show`, so assertions cover the mechanism rather than real macOS banner delivery.
It checks opt-in, unread updates/read history, silent minimal content, session click,
fixed failure status, minimized restoration and monitoring with the window closed,
plus the earlier isolation/authentication/reconnect/quit checks. Chromium adds a current
versus missing session-hash case. Real visual delivery, signed ORQST identity,
Notification Center and OS permission/Focus acceptance remain pending; see
[Desktop limits](desktop.md#tray-and-native-alert-mechanism--2026-11-02).

This increment passed `pnpm lint`, `pnpm typecheck`, `pnpm test` (118 cases),
`pnpm build`, `ORQST_BROWSER_PORT=4339 pnpm test:browser` (14 cases) and
`pnpm test:desktop` on the same Electron45.2.1/arm64 runtime. The smoke also launches
another real Electron process against the same canonical temporary profile, proving
single-instance restore of a minimized window and reopen after window close. It
never addresses the owner profile or installed Bridge. Ingestion remains unchanged;
`pnpm validate:local` was not rerun. Visual OS delivery remains outside these results.

## Manual Artifacts first slice

`tests/artifacts.test.ts` covers strict extraction identity/version/source matching,
read-only Core behavior, the unchanged `reference_only` projection, unsupported messages,
UTF-8 byte limits, retention gaps, authenticated HTTP protections and inert block parsing.
`tests/artifacts-qa.test.ts` adds independent contract, multibyte, retention, renderer
boundary and unwired-transport cases, all using synthetic disposable data.

`tests/browser/artifacts.spec.ts` exercises the actual session-to-panel flow, immutable
source versus draft, limited hostile-content preview, real browser clipboard writes,
denied clipboard reporting, oversized draft rejection, explicit accessible textarea label,
focus restoration after changing tabs, pt-BR and narrow layout. Missing/malformed responses
are tested separately from the unmocked successful extraction path. To avoid concurrent
Playwright output collisions, use a dedicated output directory for each validation run:

```bash
ORQST_BROWSER_PORT=49578 pnpm test:browser --output=/tmp/orqst-artifacts-browser
```

Choose a free nonproduction port for your machine; the fixture refuses production port
4317 and never reuses an existing listener. The extended `pnpm test:desktop` uses only its
own ephemeral Bridge/data/profile and exercises real Electron source/preview/edit and
clipboard result reporting under unchanged denied permissions. On the validation machine,
the Electron write was denied and the UI reported failure; successful native clipboard
copy is not claimed. Browser permission-granted clipboard success is tested separately.
No privileged clipboard fallback is shipped. Smoke captures remain ignored generated output.

This slice changes no ingestion reader or adapter; `pnpm validate:local` was not rerun.
No installed service/database/user profile is part of these tests. At this extraction-only
stage, save destination grants, overwrite/cancel and external editor checks belonged to
the pending file-contract slice (subsequently implemented/tested below), not this panel delivery. See [Artifacts behavior and limits](../api/artifacts.md).

## Native Markdown save increment

`pnpm test` includes disposable synthetic Desktop Artifacts tests for strict original/
draft contracts, UTF-8 limits, hostile inert text, cancel/save, explicit replacement,
symlinks/hardlinks, target/parent/content changes, replay, revocation, concurrency and
sender/frame/session/origin checks. No real session files are used or modified.
`pnpm test:desktop` exercises real sandboxed preload/IPC, authenticated extraction and
file writes with a temporary Bridge/profile/destinations. Native chooser responses,
replacement answers and editor dispatch are intercepted only in the temporary main
process; native visuals and an actual external editor are not accepted by this smoke.
It preserves the owner client, independent Bridge and installed service/storage.
Browser fixtures must use a free `ORQST_BROWSER_PORT` and separate Playwright
`--output` directory to avoid colliding with another local run.

## Confirmed Live Metrics

Synthetic Store/API QA covers canonical evidence, normalized zero versus absence, metric
time independent of other activity, mirror priority/ties, identity conflicts, historical
workspace association, byte/window admission, retention and replay. Browser checks use
isolated synthetic sessions and independent output directories, exercising header/Artifacts
sharing, actual event updates, offline/stale/missing values, races, locales and mobile
layout. Use a free `ORQST_BROWSER_PORT` and `--output` unique to the invocation. Checks
prove synthetic behavior, not provider billing or arbitrary-archive latency. Installed
service/Desktop/storage are never acceptance fixtures. See [metric limits](../api/live-metrics.md).

The confirmed-update cue suite (`tests/browser/live-metrics-updates.spec.ts`) controls
synthetic metric responses and the browser clock to check baseline/replay/unchanged
reads, exact changed fields, cue expiry, unavailable recovery, pt-BR, reduced motion
and a newly opened silent Artifacts panel. The unmocked `live-metrics.spec.ts` appends
a second synthetic token record to verify that both already open views highlight only
the changed fields while retaining source occurrence time. These checks do not establish
native screen-reader delivery or real-provider billing. Ingestion is unchanged; no
`validate:local`, live provider run or installed-service restart is needed for this UI slice.

## Browser aggregate Analytics export

Use synthetic reports and disposable observer storage/profiles. The export QA suites
cover private-field exclusion, reversible hostile text, literal formula guards,
null/zero/unidentified versus literal model labels, strict caps, large integer digits,
streamed byte admission, current-filter/cursor/connection eligibility and Desktop
unavailability. The existing unmocked Analytics browser test also downloads a report
from the real synthetic observer -> worker -> API path.

```bash
pnpm exec tsx --test tests/model-export-qa.test.ts
# Confirm this example port is free first; use unique --output for each invocation.
ORQST_BROWSER_PORT=49373 pnpm test:browser tests/browser/model-analytics.spec.ts tests/browser/model-export-qa.spec.ts --output=/tmp/orqst-export-example
pnpm test:desktop
```

The Electron smoke uses its own temporary Bridge/profile/storage and real preload/IPC
for native Analytics save. It intercepts destination/replacement dialogs, exercises
CSV/Markdown new writes, cancellation, overwrite refusal/approval, wrong-extension
refusal and ranking revocation during a pending dialog. Artifacts checks remain in
the same smoke. This establishes mechanisms and synthetic writes, not native visual
acceptance. Set `ORQST_DESKTOP_SMOKE_OUTPUT` to an exclusive temporary output directory;
otherwise screenshots are discarded with the temporary profile. Serializer/browser checks
do not establish real Excel/LibreOffice import or real-provider multi-model accounting.
No ingestion changed, so this increment does not require `validate:local` or a live
provider run. See [contract and privacy limits](../api/analytics-export.md).

## Native aggregate Analytics export

Run `pnpm exec tsx --test tests/desktop-export-qa.test.ts` for independent synthetic
privacy/injection, integrity/freshness, sender/file/overwrite and Artifacts regression
checks. `pnpm test:desktop` adds the explicit disposable Electron mechanism smoke;
never point it at the installed Bridge or the owner's profile. The browser capability
integration is synthetic; it checks acknowledgment, consumed status, refresh and both
locales without claiming IPC authority. Use a free exclusive `ORQST_BROWSER_PORT` and
`--output` for browser checks. Browser screenshots now follow that output directory.
No ingestion changes require real local session validation in this increment.

### Recorded native increment checks — 2026-11-02

The final implementation passed `pnpm lint`, `pnpm typecheck`, `pnpm test` (202/202,
including 15 independent native-export QA cases), and `pnpm build`. Before the last
consumed-reading correction, the full Chromium suite passed 38/38. The final affected
native capability/consumption/locale checks passed 3/3 against the rebuilt bundle;
independent QA then confirmed the complete 39/39 Chromium suite on the final UI tree.
All browser invocations used their own port/state/output.

The final `pnpm test:desktop` smoke passed on macOS arm64 with Electron45.2.1,
Chromium156.0.8078.75 and Node24.22.1. Real preload/IPC, session-authenticated aggregate
revalidation and synthetic filesystem writes ran; destination/overwrite dialogs,
notification delivery and external application dispatch were intercepted. This is
mechanism evidence, not native visual or real Excel/LibreOffice import acceptance.
QA includes context changes during choose and overwrite confirmation, consumed UUIDs,
late context generations, sender/file integrity and critical Artifacts regressions.
No installed service/client/profile/database/session was used or restarted. There
were no ingestion changes, so `validate:local` and live provider tests were not run.
