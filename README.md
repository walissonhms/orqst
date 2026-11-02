# ORQST

**One place. Every agent.**

ORQST is an open-source, local-first platform for intelligent AI agent
observability, evolving toward managed execution and structured orchestration.
Its primary experience is understanding agent activity, delivery, intervention,
usage and cost uncertainty across workspaces and, eventually, machines.

**The current 0.1.0 runtime observes Codex sessions started outside ORQST.** It
normalizes their activity, persists local observations in SQLite and streams them
to a React browser dashboard. It does not launch agents, control processes, send
prompts or write into observed sessions.

> **Project status:** pre-release. Core/Bridge lifecycle separation and a local Analytics
> aggregation API and first browser ranking screen are implemented and integration-tested.
> Full Desktop Analytics remains incomplete. A minimal macOS Electron observer client
> runs from the checkout; integrated terminals, managed execution and Cloud connectivity are
> not shipped. **Model Usage Analytics is mandatory for the functional Desktop MVP.**
> Community is licensed under [Apache-2.0](LICENSE) and operates without Cloud.

## What works today

| Area                                                                         | State                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------- |
| Codex CLI session discovery (read-only)                                      | Implemented                                       |
| Incremental JSONL parsing with checkpoints and recovery                      | Implemented                                       |
| Normalized event protocol with runtime validation                            | Implemented                                       |
| Local SQLite persistence, migrations, retention                              | Implemented                                       |
| Loopback REST API and WebSocket streaming                                    | Implemented                                       |
| React dashboard: workspaces, agents, timeline, attention, tokens             | Implemented                                       |
| macOS Electron window/tray over the existing local Bridge                    | Implemented checkout client; no installer         |
| macOS native alert mechanism                                                 | Implemented; signed visual delivery pending       |
| Most used models: bounded ranking, bars, filters and coverage                | Implemented; real multi-model validation pending  |
| English (en-US) and Brazilian Portuguese (pt-BR)                             | Implemented                                       |
| Live notifications (completion real-data path; failure/input fixture-tested) | Implemented, subject to browser permissions       |
| Claude Code adapter                                                          | Contract only, not implemented                    |
| OpenCode adapter                                                             | Contract only, not implemented                    |
| Local observed-session evidence / artifact references                        | Implemented library; manual Artifacts panel added |
| Managed execution and structured delegation                                  | Planned, not implemented                          |
| ORQST Cloud, accounts, billing                                               | Not implemented                                   |
| Multi-machine observability and remote connectivity                          | Planned, not implemented                          |

This is version 0.1.0. Earlier macOS baseline evidence covers build, type checking, automated/browser tests, native Codex live acceptance and managed-service recovery. Final v1.0 acceptance remains pending. See [Validation status](#validation-status) and [Testing](docs/development/testing.md) for scope and reproduction commands.

## Delivery status and roadmap

- **Implemented:** the local Codex observer, SQLite store, loopback API, live React
  dashboard, en-US/pt-BR UI, macOS user-service helper and minimal Electron observer
  client listed above.
- **Phase 1 increment delivered:** UI-independent observer Core and evidence-backed
  model Analytics library with schema-2 compact durable metric/model evidence.
  Historical coverage remains qualified. Versioned local observed-session evidence
  and artifact message references now have strict schemas and Core consumers; broader
  lifecycle transport remains planned. The first manual Artifacts slice adds bounded
  retained-message extraction, source/preview/draft editing and explicit copying; file
  saving and optional opening in the system default application are implemented for Desktop only. This does not complete Phase 1.
- **Browser Analytics increment delivered:** open **Most used models** in the sidebar
  or `/#models`. Rank covered observations by reported tokens or observed sessions;
  filter local calendar periods, workspace, exact agent/model IDs and implemented
  CLI adapter. Unknown models, missing usage and incomplete coverage stay explicit.
- **Planned:** six delivery phases covering Core/contracts, the Desktop MVP,
  robust provider integrations, managed sessions, evidence-gated optimizer integration,
  and distribution. Desktop includes Terminal, Monitor/Notifications, Artifacts,
  Model Manager, Live Metrics and mandatory Model Usage Analytics.

Observability remains the primary product experience. Terminals and orchestration
support it. Native provider histories should be reused, with bounded, explicit
content caching. Future Cloud connectivity must not store code, conversations,
terminal output or session content; local Community features remain independent.

See [ROADMAP](ROADMAP.md) for phases, acceptance criteria, pending decisions and
the migration from the previous phase numbering; [CHANGELOG](CHANGELOG.md) records
changes. See the [requirement matrix](docs/architecture/product-requirements.md)
and [Analytics design](docs/architecture/model-usage-analytics.md). Incremental,
non-destructive development may continue after checks. Product decisions, destructive
actions, credentials, external costs and ungranted permissions remain explicit gates.

The [Token Optimizer research](docs/benchmarks/token-optimization.md) is an isolated
Phase 0 experiment. Disabled/Economy/Intelligent are planned production modes;
no optimizer setting or automatic token reduction exists in the current runtime.

## Current architecture at a glance

```
  Codex CLI started outside ORQST
  ~/.codex/sessions/**/*.jsonl
              │
              │ read-only, incremental
              ▼
  @orqst/adapter-codex ──► @orqst/protocol (zod schemas)
              │                     │
              ▼                     ▼
        @orqst/database (node:sqlite, WAL)
              │
              ▼
  @orqst/bridge  ── HTTP + WebSocket on 127.0.0.1 only ──►  @orqst/dashboard
  (single process)                                           React + Vite + Tailwind + i18next
```

The Core also exposes version-1 local queries for one retained observation or an
explicit artifact message reference. They validate identity/source metadata at runtime,
keep task/process and missing timestamps unavailable, and never return captured bodies
or open source paths. Those metadata queries remain local-only. A separate bounded manual Artifacts query
and session panel are now available, with a separate narrow Desktop Markdown save capability described below.
See [lifecycle contracts](docs/api/lifecycle-contracts.md).

There is one long-running process. Analytics queries use one disposable Node worker
thread at a time with a separate read-only SQLite WAL connection. The bridge
composes `@orqst/core`, which owns
the observer, single SQLite store and retention lifecycle; the bridge owns REST,
WebSocket and signal handling. The dashboard is a static
bundle served by the bridge in production and by Vite in development.

- **Node.js 24.x** and **pnpm 10.x** are required.
- **SQLite** is Node's built-in `node:sqlite` (`DatabaseSync`), not a native
  addon.
- **One bridge, one port:** `127.0.0.1:4317` by default. The server never binds
  a public interface.
- **No cloud dependency:** local operation requires no account, API key,
  telemetry, or upload.

## Confirmed Live Metrics

Session details and the Artifacts panel show **Confirmed session tokens** from one
bounded evidence-backed query: input/output/cache/total and the metric's own occurrence
time. Cache is included in input. Missing proof is unavailable; previous confirmed
readings are explicitly out of date during refresh/failure/disconnection. These
normalized session totals do not attribute consumption to the artifact or prove
individual provider field presence. See [Live Metrics and limits](docs/api/live-metrics.md).

## Manual Artifacts

Open a session's **Execution timeline** and choose **Extract artifact manually** on a retained
assistant/agent response. Its panel keeps recorded provenance and immutable retained
source separate from a temporary editable draft, with a limited inert preview and
explicit raw/readable clipboard actions. No automatic recognition or complete-source
claim is made; expired evidence stays unavailable. Extraction/drafts are capped at
32 KiB UTF-8. Copy failures are reported; Desktop permissions may deny copying.
Desktop can save the selected original or draft as `.md` using a native destination
dialog and explicit confirmation before replacing an existing file. A separate
**Save and open** gesture optionally hands only that newly saved, verified file to
the system default application. Cancel writes nothing. The browser explains that
these native actions require Desktop. Existing destinations must be regular,
nonexecutable, single-link files of at most 32 KiB; ambiguous or changed targets fail
closed. Writes are not atomic or crash-recoverable; partial failures are reported.
No agent session or source file is modified. See [contract, behavior and limits](docs/api/artifacts.md).

## Requirements

- macOS (primary development target; Linux and Windows/WSL are not validated)
- Node.js `>=24 <25` (pinned in `.node-version`; `engine-strict=true`)
- pnpm `10.34.9` (declared in `package.json`; Corepack can provide it)
- Codex CLI installed and used at least once, so that session files exist
- A modern browser for the dashboard; macOS13+ for the optional Electron client

The `node:sqlite` API is tied to the pinned Node major. Changing the Node major
requires revalidating the database layer.

## Quick start

```bash
corepack enable
pnpm install

# Development: bridge on 127.0.0.1:4317, Vite on 127.0.0.1:5173
pnpm dev
# open http://127.0.0.1:5173
```

Production-style local run:

```bash
pnpm build
pnpm start
# open http://127.0.0.1:4317
```

`pnpm start` must run from the repository root: the bridge resolves the
dashboard bundle at `apps/dashboard/dist` relative to the current working
directory.

## Optional macOS Desktop window

The Electron client uses the independently running Bridge and existing React dashboard.
After `pnpm install` and `pnpm build`:

```bash
pnpm --filter @orqst/desktop exec install-electron --no # explicit official binary download
pnpm desktop
# ORQST_DESKTOP_PORT=4320 pnpm desktop # separately configured loopback Bridge
```

`pnpm dev:desktop` rebuilds/opens the shell without starting a Bridge. Window close,
reopen and quitting Desktop preserve the service/observer. If the service is unavailable,
the client shows an honest offline state and retries. A single isolated preload and
`saveMarkdown` IPC channel support the native [Artifacts save contract](docs/api/artifacts.md#native-desktop-save-contract);
there is no generic filesystem/shell method, Node renderer access or agent control.
Browser permissions and external navigation remain denied.
The menu bar opens/restores the window and quits only Desktop. It displays Bridge
availability and unread history (latest 200), with an opt-in native alert switch for
this Desktop run. Categories/sound use the existing Bridge preferences. New confirmed
Codex completion, failure and input requests can alert; history/reconnect cannot.
Native text contains only a fixed category; clicking revalidates the session identity.
The mechanism is implemented, but visual native delivery remains unaccepted: Electron's
macOS API requires signing, a valid app identity and OS permission. Focus/settings can
suppress alerts. This checkout has no `.app` packaging, signing pipeline or updater.
See [Desktop setup, verified runtime and trust/lifetime](docs/development/desktop.md).

## Managed background service on macOS

After installing dependencies and building with Node 24/pnpm 10:

```bash
pnpm runtime:install
export PATH="$HOME/.local/share/orqst/toolchain/bin:$PATH"
pnpm service:plan
pnpm service:install
pnpm service:status
```

The private runtime is copied from the validated Node/pnpm installation; no global tools are changed or versions downloaded. The service starts at user login and is supervised by launchd. Its runtime is outside `/tmp`; logs and SQLite stay private under `~/.orqst`. Stop your existing foreground ORQST process before installing: the helper refuses to replace an unrelated port listener.

```bash
pnpm service:restart
pnpm service:uninstall
```

Uninstall stops the service and removes its plist; it preserves the database, backups, logs and private runtime. See [local deployment](docs/deployment/local.md).

## Commands

| Command               | Purpose                                                                             |
| --------------------- | ----------------------------------------------------------------------------------- |
| `pnpm install`        | Install workspace dependencies                                                      |
| `pnpm dev`            | Run the bridge in watch mode plus the Vite dev server                               |
| `pnpm build`          | Build dashboard, Bridge/Analytics worker and Desktop shell bundles                  |
| `pnpm dev:desktop`    | Build/open the Electron client; requires an independent Bridge                      |
| `pnpm build:desktop`  | Build only the Electron shell                                                       |
| `pnpm desktop`        | Open the last built Electron shell                                                  |
| `pnpm test:desktop`   | Real Electron/macOS smoke with a disposable synthetic Bridge/profile                |
| `pnpm start`          | Run the built bridge (`node dist/bridge.mjs`)                                       |
| `pnpm test`           | Run the Node test suites with `tsx --test`                                          |
| `pnpm test:browser`   | Run Chromium end-to-end tests using an isolated synthetic source                    |
| `pnpm lint`           | ESLint plus Prettier check                                                          |
| `pnpm format`         | Write Prettier formatting                                                           |
| `pnpm typecheck`      | `tsc --noEmit` across the workspace                                                 |
| `pnpm validate:local` | Read bounded local Codex files into a disposable database and print aggregates only |

Additional commands: `pnpm validate:live` runs an explicitly requested native Codex acceptance task; `pnpm runtime:install` and `pnpm service:{plan,install,status,restart,uninstall}` manage the private macOS runtime/service. The live test uses the current Codex login/model and consumes real provider usage. It never runs as part of the application, automatic tests or CI.

## Configuration

ORQST is configured through environment variables. It does **not** load `.env`
automatically. Copy `.env.example` for reference, then export the values or
start the built bridge with `node --env-file=.env dist/bridge.mjs`.

| Variable               | Default                            | Accepted values           | Meaning                                                |
| ---------------------- | ---------------------------------- | ------------------------- | ------------------------------------------------------ |
| `ORQST_PORT`           | `4317`                             | integer `1024`–`65535`    | Loopback HTTP/WebSocket port                           |
| `ORQST_DESKTOP_PORT`   | `4317`                             | integer `1024`–`65535`    | Desktop client target port on fixed `127.0.0.1`        |
| `ORQST_DATA_DIR`       | `~/.orqst`                         | absolute or relative path | Directory holding `orqst.db`                           |
| `ORQST_CODEX_SESSIONS` | `${CODEX_HOME:-~/.codex}/sessions` | path                      | Codex session root to observe                          |
| `ORQST_RETENTION_DAYS` | `30`                               | integer `1`–`3650`        | Event-detail retention window                          |
| `ORQST_POLL_MS`        | `3000`                             | integer `500`–`60000`     | Fallback scan interval when file events are unreliable |
| `ORQST_DEV`            | unset                              | `1`                       | Trusts the Vite dev origin on `127.0.0.1:5173`         |
| `CODEX_HOME`           | `~/.codex`                         | path                      | Used only to derive the default session root           |

Invalid numeric values fail startup instead of silently falling back.

## Data and privacy

- Session files are opened read-only. ORQST never writes to Codex session
  files and never launches Codex.
- Captured text is treated as untrusted. It is rendered as plain text, never as
  HTML or Markdown, and is never executed.
- A best-effort redaction pass removes common credential shapes before text is
  stored. Redaction is heuristic, not a guarantee.
- Raw logs, encrypted reasoning, identity/account fields, and environment or
  configuration blocks are not copied into SQLite.
- The database is plaintext SQLite. It is protected by filesystem permissions
  (`0700` directory, `0600` database), not encryption at rest.
- There is no telemetry and no automatic upload. The Cloud Edition is not
  implemented.
- Event details expire according to `ORQST_RETENTION_DAYS`. Session summaries
  and token totals are retained. Schema-2 compact metric/model evidence also survives
  detail expiry without automatic expiration; it contains only metric, identity and
  provenance metadata. Pre-upgrade deleted evidence is not reconstructed. See
  [data lifecycle and migration](docs/architecture/data-model.md).

See [docs/architecture/security-model.md](docs/architecture/security-model.md)
and [SECURITY.md](SECURITY.md).

## Documentation

- [Public roadmap and Phase 1 scope](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Planned lifecycle contracts](docs/api/lifecycle-contracts.md)

- [Documentation index](docs/README.md)
- [Architecture overview](docs/architecture/overview.md)
- [Data model](docs/architecture/data-model.md)
- [Security model](docs/architecture/security-model.md)
- [Architecture decisions](docs/architecture/decisions.md)
- [Codex adapter](docs/adapters/codex.md)
- [Claude Code adapter contract](docs/adapters/claude.md)
- [OpenCode adapter contract](docs/adapters/opencode.md)
- [Adapter capability model](docs/adapters/capability-model.md)
- [REST API](docs/api/rest.md)
- [WebSocket API](docs/api/websocket.md)
- [Event protocol](docs/api/protocol.md)
- [Development setup](docs/development/setup.md)
- [Testing](docs/development/testing.md)
- [Repository layout](docs/development/repository-layout.md)
- [Local deployment](docs/deployment/local.md)
- [Operations](docs/deployment/operations.md)
- [Licensing decision](docs/commercial/licensing-decision.md)
- [Future Cloud architecture](docs/commercial/cloud-architecture.md)

## Known limitations

- **Codex only.** Claude Code and OpenCode do not collect data yet. Their
  capability flags are all `false` until an implementation is validated. Codex intervention detection also remains unvalidated against real logs.
- **Observation, not orchestration.** ORQST cannot answer an intervention,
  approve a tool call, stop a run, or send a message to an agent. Intervention
  alerts tell the user to continue in the original terminal.
- **Control is planned.** Managed execution, terminal input and delegation require
  validated adapters, operation-specific authorization and a reviewed control boundary.
  No current API can deliver them.
- **macOS-first.** Linux and Windows/WSL behavior is unvalidated.
- **Node 24 only.** Older Node versions are rejected by `engine-strict`.
- **No encryption at rest** and no multi-user access control. The local API is
  protected by a per-process session cookie and loopback binding, which assumes
  a single trusted OS user.
- **Redaction is best-effort.** Secrets in unusual formats may survive.
- **Analytics is partial.** The first browser screen has ranking, share bars, filters
  and coverage. Worker queries admit up to 5000 candidate sessions, 250000 retained
  envelopes, 256 MiB of evidence, 8 MiB per record, 64 MiB of metric metadata and 2 MiB of aggregate response.
  One read-only worker runs at a time, with no queue and a 10-second watchdog;
  disconnect/shutdown cancel and await cleanup. Explicit errors show no partial sums.
  Native SQL cleanup can delay termination. Narrow workspace, agent or adapter scopes
  may help; a shorter period can need the same history.
  Time series, export, task-qualified comparisons, verified costs and full Desktop delivery
  remain pending. Real multi-model ranking is unvalidated. See the [design](docs/architecture/model-usage-analytics.md).
- **Token data is only as good as the source.** ORQST records observed
  cumulative session usage; it does not estimate cost, enforce budgets, or
  report provider quota.
- **Validation scope.** Tests include desktop/mobile Chromium and a bounded real-data smoke. Other browsers, multi-gigabyte backfills, and long-running load are not validated.
- **CI configured.** GitHub Actions runs the checks and browser suite; a hosted CI run has not been observed.
- **Distribution is incomplete.** A macOS user-service helper is available; there is no standalone installer, container image, Linux/Windows service installer or published package.

## Validation status

The confirmed Live Metrics increment passed lint, typecheck, 169 Node tests, full
build, 27 Chromium cases and a disposable Electron smoke including absent-to-confirmed
token updates in session/Artifacts. The initial combined browser run exposed eight
fixture-order assumptions; the corrected full rerun passed without skips. A later
accessibility refinement added description-list pairs and one quiet session announcement
region. Dashboard rebuild, lint, typecheck, locale parity and the 13 affected Chromium
cases passed again, including refresh with the artifact open. Independent QA also
repeated the full 27-case browser suite and 169 Node tests after the refinement.
Full build and Electron smoke preceded that UI refinement; the Electron smoke was
not repeated for the markup/announcement change. Evidence is synthetic;
provider billing, arbitrary-contention latency and manual screen-reader acceptance remain
unvalidated. Installed service/Desktop/storage were preserved without restart.

The native Markdown save increment passed lint, typecheck, 149 Node tests (including
9 independent save QA cases), full build and 18 Chromium cases on isolated port 51390
with separate output. Disposable Electron45.2.1/arm64 smoke exercised real preload/IPC,
authenticated extraction, cancel/save/overwrite denied and accepted, hostile multibyte
draft text, current-file-only opening and revocation during choose/confirm after
navigation away and back. Native dialog answers and editor dispatch were intercepted;
actual native visuals/editor launch remain unvalidated. Existing Desktop/Bridge PIDs,
service/storage and source sessions were preserved. Saves are not transactional,
atomic pathname CAS or guaranteed crash-recoverable; partial failures are reported.

The larger-history Analytics worker increment passed lint, types, 80 Node tests,
build and 13 Chromium tests, including a synthetic 310-session/approximately-57000-event
archive. A separate smoke ran both production bundles through the authenticated
endpoint with disposable synthetic SQLite storage (310 sessions/1240 events).
The installed service was not restarted; real-provider multi-model acceptance and
arbitrary-archive latency remain unvalidated.

The later browser Analytics integration passed lint, typecheck, 64 Node tests, build
and 11 Chromium tests. One unmocked browser test ingests two synthetic source sessions
through the observer and reconciles their model ranking/shares to the aggregate API.
Other Analytics UI fixtures exercise filters, DST/calendar windows, races, missing
values, errors, escaping, mobile layout and en-US/pt-BR. This is synthetic functional
evidence, not real-provider comparative acceptance. A final copy clarification was
checked with locale parity, build and the two relevant browser cases.

The Core/Analytics integration on 2026-11-02 passed `pnpm lint`, `pnpm typecheck`,
`pnpm test` (57 cases), `pnpm build` and `pnpm test:browser` (3 Chromium cases).
`pnpm validate:local --with-browser` checked disposable copies of 8 real sessions,
with stable replay/restart, preserved cumulative totals and unchanged source prefixes.
The installed service was not restarted. Analytics model attribution itself has
synthetic acceptance only; full Desktop, native notifications and real-provider ranking
remain unvalidated. See [Core lifecycle](docs/architecture/overview.md#observer-core-lifecycle).

The minimal Desktop increment on 2026-11-02 passed lint, types, 109 Node cases,
full build, 13 Chromium cases on isolated port 4320 and real Electron45.2.1 smoke on
macOS26.3/arm64. Independent QA added six policy/security cases and reran the smoke.
Temporary synthetic sessions/storage/profile exercised window rendering, isolation,
cookies, initial offline/retry, loaded reconnect and close/reopen/quit lifetime.
Installed storage/service, real-provider acceptance and packaging were not exercised.
See [Desktop testing](docs/development/testing.md#minimal-macos-desktop-observer).

The subsequent tray/native mechanism increment passed lint, typecheck, 118 Node
cases (including three independent monitor QA cases), build, 14 Chromium cases on
isolated port 4339 and disposable Electron45.2.1/arm64 smoke. The smoke validated
menu/count/source gating, minimal silent content, session click, failure reporting,
monitoring without a window and real second-process restore/reopen with one temporary
profile. Native `show` was intercepted: real macOS banner/Notification Center delivery,
signed ORQST app identity and OS permission/Focus acceptance remain pending. No
installed service/database, owner window or native provider sessions were modified.

Earlier observer baseline evidence follows; it is distinct from those increments.

On macOS, using isolated Node 24.22.2 and pnpm 10.34.9:

- 25 automated tests passed for normalization, SQLite, recovery, API/WebSocket, preferences and locale coverage.
- 3 Chromium tests passed for desktop/mobile, language persistence, escaped content, association, live updates and notification history.
- `pnpm lint`, `pnpm typecheck` and `pnpm build` passed.
- 8 real Codex sessions in 2 workspaces were validated in disposable storage, including one explicit parent relationship. Replay/restart preserved totals, and original source prefixes remained unchanged.
- The compiled bridge and browser dashboard were also checked with disposable copies of these real sessions; no captured conversations or real-data screenshots were exported.

Reproduce the real browser smoke after building and installing Chromium:

```bash
pnpm exec playwright install chromium
pnpm validate:local --with-browser
```

The managed macOS service uses a private runtime at `~/.local/share/orqst/toolchain`, without changing global tools. See [Managed background service](#managed-background-service-on-macos) for setup.

The follow-up native Codex test also verified a real read-only tool call, live completion/notification, source-matching tokens and browser updates. A managed-service restart preserved the selected session/events, preferences, machine identity, read checkpoint and existing parent links, and the existing browser reconnected without reloading. Actual OS notification delivery, reboot recovery and continuous soak behavior remain unvalidated.

## License

ORQST Community Edition, including the core, protocol, adapters and documentation,
is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) and the
[licensing decision](docs/commercial/licensing-decision.md). Third-party dependencies
retain their own licenses and notices.

Tucano was used as an architectural reference; no Tucano code or assets were copied.
Future independently developed Cloud modules may have separate terms; no Cloud
service is included in this repository.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing the repository. Contributions
intentionally submitted for inclusion are governed by Apache-2.0 section 5. Report vulnerabilities
according to [SECURITY.md](SECURITY.md); do not open a public issue for a
security problem.
