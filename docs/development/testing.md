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

`pnpm test` uses the built-in Node runner through `tsx`, with 25 cases:

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
