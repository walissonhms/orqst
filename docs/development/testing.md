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
