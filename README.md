# ORQST

**One place. Every agent.**

The shared dashboard uses the approved ORQST logo in navigation and a static mascot
in its empty-session welcome. See [brand assets](docs/design/brand-assets.md) for
artwork provenance, accessibility and safe SVG handling.

ORQST is an open-source, local-first platform for intelligent AI agent
observability, evolving toward managed execution and structured orchestration.
Its primary experience is understanding agent activity, delivery, intervention,
usage and cost uncertainty across workspaces and, eventually, machines.

**The default 0.1.0 runtime observes Codex sessions started outside ORQST.** It
normalizes their activity, persists local observations in SQLite and streams them
to a React browser dashboard. It does not launch agents, control processes, send
prompts or write into observed sessions.

An explicit checkout-only **Managed Terminal** opt-in adds a real xterm.js
window inside ORQST Desktop for a new owned Codex process, with separate login,
private state and native confirmations. It uses the selected native trusted/same-user
contract; it is not hard containment. The real provider has not been executed for
acceptance. Normal startup and external sessions remain observation-only. See
[setup, interaction and limits](docs/development/managed-codex-terminal.md).

> **Project status:** pre-release. Core/Bridge lifecycle separation and a local Analytics
> aggregation API and first browser ranking screen are implemented and integration-tested.
> Full Desktop Analytics remains incomplete. A minimal macOS Electron observer client
> runs from the checkout; an opt-in embedded managed Codex Terminal is implemented,
> while real-provider acceptance, multi-agent delegation, distribution and Cloud remain pending. **Model Usage Analytics is mandatory for the functional Desktop MVP.**
> Community is licensed under [Apache-2.0](LICENSE) and operates without Cloud.

## What works today

| Area                                                                         | State                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| Codex CLI session discovery (read-only)                                      | Implemented                                             |
| Incremental JSONL parsing with checkpoints and recovery                      | Implemented                                             |
| Normalized event protocol with runtime validation                            | Implemented                                             |
| Local SQLite persistence, migrations, retention                              | Implemented                                             |
| Loopback REST API and WebSocket streaming                                    | Implemented                                             |
| React dashboard: workspaces, agents, timeline, attention, tokens             | Implemented                                             |
| macOS Electron window/tray over the existing local Bridge                    | Implemented checkout client; no installer               |
| macOS native alert mechanism                                                 | Implemented; signed visual delivery pending             |
| Most used models: bounded ranking, bars, filters and coverage                | Implemented; real multi-model validation pending        |
| English (en-US) and Brazilian Portuguese (pt-BR)                             | Implemented                                             |
| Live notifications (completion real-data path; failure/input fixture-tested) | Implemented, subject to browser permissions             |
| Claude Code adapter                                                          | Contract only, not implemented                          |
| OpenCode adapter                                                             | Contract only, not implemented                          |
| Local observed-session evidence / artifact references                        | Implemented library; manual Artifacts panel added       |
| Embedded managed Codex Terminal                                              | Opt-in native path; real-provider acceptance pending    |
| Structured pane queue, correlation and result inbox                          | Opt-in Core library; synthetic transport evidence       |
| Codex structured runtime                                                     | Opt-in library; synthetic protocol tests only           |
| Scoped native A-to-B-to-A delegation facade                                  | Opt-in library; synthetic only; real acceptance pending |
| ORQST Cloud, accounts, billing                                               | Not implemented                                         |
| Multi-machine observability and remote connectivity                          | Planned, not implemented                                |

This is version 0.1.0. Earlier macOS baseline evidence covers build, type checking, automated/browser tests, native Codex live acceptance and managed-service recovery. Final v1.0 acceptance remains pending. See [Validation status](#validation-status) and [Testing](docs/development/testing.md) for scope and reproduction commands.

## Delivery status and roadmap

- **Dashboard visual refinement:** the logo now follows the resolved light/dark
  theme without a white CSS backing, with the original artwork retained and a
  documented transparent dark derivative. Responsive headers/sidebar, mobile
  session cards and labeled fields preserve real actions, focus and observation
  semantics. Palette contrast and synthetic layout checks cover both languages;
  native Desktop and manual screen-reader acceptance remain pending. See the
  [visual check scope](docs/development/dashboard-visual-checks.md).

- **Terminal and communication boundaries (2026-11-03):** the embedded Desktop
  Terminal is an explicit native opt-in for newly owned processes. Separately,
  [pane communication](docs/api/pane-communication.md) provides stable scoped IDs,
  grants, durable FIFO admission, independent delivery/task evidence and a result
  inbox/subscriptions to a Core client. Queue admission is not provider acceptance;
  a Core notification is not a result delivered inside an agent CLI. There is no
  public communication endpoint, Communication Inspector or verified two-agent
  workflow. Unknown outcomes retain capacity and are never retried automatically;
  four unresolved outcomes block all dispatch even after restart. No capacity
  reclamation exists, so normal-runtime provider dispatch remains gated.
  The dated Terminal engineering entries below record earlier stages; current
  setup and native trust limits are in the
  [managed Terminal guide](docs/development/managed-codex-terminal.md).

- **Structured Codex runtime library:** an additional opt-in Core path joins signed
  native start authority, independent managed homes/journals and the pane registry
  to a bounded app-server channel. Readiness requires initialization and a new
  native thread; acceptance, turn start and matching result remain separate.
  Synthetic transports exercise two identities and correlated Core results. Normal
  Desktop/Bridge startup does not construct this path, and its compiled native host
  has not been exercised against real Codex. An optional native dynamic-tool facade
  now returns B's verified result into A's pending RPC under a separate signed,
  exact-target/task root grant and one-call budget. Synthetic tests cover that
  return and its native receipt. Requested capability stays distinct from observed
  support. MCP, multi-agent UI and real-provider acceptance remain pending.
  This is separate from the interactive xterm Terminal; no existing process or
  external session is converted or adopted. See the
  [runtime contract](docs/development/codex-structured-runtime.md) and
  [prepared, unexecuted two-agent acceptance](docs/development/codex-two-agent-acceptance.md).

- **Observation guide:** Settings, Search & commands and the empty-session welcome
  open a three-step guide using the existing Bridge snapshot: connection, source
  reading diagnostics and retained sessions across all workspaces. Missing snapshots
  stay unavailable; loaded evidence is qualified when stale. Existing capability and
  workspace routes keep their navigation/draft guards. This is read-only orientation,
  not CLI discovery, an installation test or a saved onboarding checklist. See the
  [interface guide](docs/design/ui-ux-specification.md#first-observation-guide).

- **Searchable Artifact sources:** `/artifacts` adds a read-only library of retained
  Codex assistant/agent messages, with search over loaded text/agent/session/workspace,
  current-workspace and exact-session filtering, provenance and explicit older-page
  loading. Opening a source selects its session and reuses the manual source/preview/
  draft/copy/Desktop-save panel and draft navigation guard. A reading stops at 2,000
  observations or 200 sources; search is not a full archive index. Refresh and new-data,
  empty, limit, error and offline states explain coverage. Saved files and drafts are
  not indexed; automatic document detection and durable recovery remain unavailable.
  See the [interface guide](docs/design/ui-ux-specification.md#search-artifact-sources).

- **Pinned workspaces:** pin/unpin recorded workspaces in the directory, filter to
  pinned projects and find them first in both directory and sidebar. The selected
  recent/name ordering applies within directory groups. Pins persist locally and
  synchronize across same-origin tabs; storage denial keeps visit-only changes with
  an explicit notice. Pinning preserves the active scope, routes and Artifact drafts.
  This is a browser/Desktop-profile preference, not a project file operation or
  process/tab restoration. **Unpin all workspaces** clears only those pins, including
  absent identities. See the [interface guide](docs/design/ui-ux-specification.md#pin-workspaces).

- **Configurable Overview panels:** **Customize overview** shows/hides and reorders
  the existing timeline, attention, token usage and source-health panels. The first
  visible panel uses the wide column; narrow windows keep the same reading order.
  Keyboard arrow buttons, immediate changes, scoped default restoration and an
  all-hidden recovery action work without the Bridge. Layout persists locally and
  synchronizes between same-origin tabs; storage denial reports visit-only scope.
  Summary, sessions, open details/drafts and notification delivery keep their existing
  behavior. No new metrics, data deletion, drag-and-drop or panel resizing is added.
  See the [interface guide](docs/design/ui-ux-specification.md#customize-overview-panels).

- **Clean dashboard routes:** use `/overview`, `/workspaces`, `/agents`, `/models`,
  `/artifacts` and `/settings`, including direct entry and reload. `/` restores the last view;
  explicit routes take precedence over that preference. Legacy `/#overview` (and
  the other five view hashes) still work and replace the current URL without an
  extra history entry. Legacy `/#session=<encoded-id>` opens a session only after
  validation against the Bridge snapshot and becomes `/overview/sessions/<encoded-id>`.
  Safe session paths use one canonical encoded segment; IDs containing separators,
  residual percent escapes, controls or dot-only segments retain their historical
  hash representation. Session links remain reloadable. Browser Back/Forward and
  same-document hash links share draft confirmation; cancellation preserves both history directions.
  Desktop permits only the root, these six exact paths and the strictly validated
  session-path shape at its configured loopback origin. Unknown extensionless
  Bridge paths return 404. See
  [navigation and limits](docs/design/ui-ux-specification.md#navigate-real-observations).

- **Light and system theme increment:** Settings now offers dark, light and
  follow-system themes across the shared dashboard. Dark remains the default;
  older appearance choices keep their values. Light mode includes semantic status
  colors, native form controls, readable source/draft panels, higher contrast and
  visible focus. System mode follows OS appearance changes; explicit choices stay
  fixed. Themes work offline, persist/synchronize through the same local appearance
  key and reset to dark only after confirmation. Native menus, file dialogs, alerts
  and menu-bar artwork retain their platform policy. Chromium checks cover contrast,
  keyboard and 320–1440px layouts; native visual and screen-reader acceptance remain
  pending. See the [design system](docs/design/design-system.md#light-theme).

- **Artifact navigation protection:** changed memory-only drafts now require a
  decision before switching sessions/workspaces or leaving Overview, including
  Search & commands, notification source links and same-document session links.
  Cancel preserves exact text and context; confirmation performs only the requested
  transition. Pending native saves keep the panel open with explicit feedback.
  Browser reload/exit uses a best-effort browser warning while edits remain; Desktop
  window close/quit, native reloads and crash recovery remain unprotected. Nothing is
  autosaved. See [Artifacts limits](docs/api/artifacts.md#panel-preview-and-clipboard).

- **Settings and accessibility increment:** open **Settings** in navigation, the
  header or Cmd/Ctrl+K (`/settings`). General, Appearance & accessibility,
  Notifications and Privacy & storage group working controls and explain their
  scope. Choose standard/higher contrast, compact/comfortable spacing and
  system/reduced motion. Appearance persists in this browser/Desktop profile;
  storage denial keeps changes for the visit with an explicit notice. System
  reduced motion always wins. Reset appearance asks for confirmation and changes
  only appearance choices. Language and reading comfort work offline; notification
  categories/sound reuse the Bridge store and disable without a current connection.
  Reading controls now scale interface text (100/112.5/125%) and captured text
  (an additional 0/15/30%), with original/monospace/system sans-serif reading fonts
  and a labeled example. Old preferences migrate safely; copied/saved text stays exact.
  Terminal font controls, retention/deletion UI, quiet hours and provider
  configuration remain pending. See the [interface guide](docs/design/ui-ux-specification.md).

- **Terminal native-boundary increment (2026-11-03):** a strict native-client
  broker now connects fixed profiles, private signed consent, input leases and
  owned lifecycle in the explicit synthetic PTY lab. Electron sender, native
  confirmation and lifecycle helpers were unit-tested before the
  native lab below composed them. This historical lab uses synthetic processes;
  the current embedded opt-in is described above.
  Codex is still the only implemented observer; Claude Code and OpenCode remain
  contracts. Read the [native contract](docs/api/terminal-native.md) and
  [dated primary-source CLI research](docs/adapters/managed-terminal-research.md).

- **Terminal durable recovery increment (2026-11-03):** the experimental supervisor
  can use the existing SQLite writer for metadata-only attempts, commit-before-start
  admission and explicit epoch recovery. Lost ownership keeps admission capacity;
  old owners cannot send input or signals. The journal remains absent from
  normal observer startup; the later embedded Terminal explicitly opens its own
  private journal. Synthetic restart/crash tests do not establish provider support.
  The selected native mode and remaining acceptance limits are described above;
  Claude Code and OpenCode remain contracts. See [recovery and concrete gates](docs/development/terminal-recovery.md).

- **Native Terminal integration lab (2026-11-03):** an explicit developer command
  builds a disposable Electron document, separate session/preload and bounded
  IPC runtime connected to an owned synthetic PTY in a separate Node host. Native
  cancellation, private grants, leased exact paste, focus revocation, confirmed
  exit and permanent reload revocation are exercised through real Electron/IPC.
  Dialog answers are intercepted in acceptance, not evidence of a human native
  gesture. Run only the [explicit synthetic acceptance](docs/development/terminal-native-acceptance.md).
  At that lab stage, Desktop/Bridge had no terminal execution channel. The later
  embedded opt-in above composes the native path with separate state and owned
  lifetime; its real-provider acceptance remains pending.
  No real provider is launched; Claude Code/OpenCode remain unvalidated contracts.

- **Terminal mechanics increment:** an opt-in developer command now checks a real
  PTY using only fixed disposable synthetic Node processes, private temporary
  directories and bounded output/lifetime. The macOS/arm64 Node-host check passed;
  no agent is launched and no application control is exposed. Read the
  [reproduction guide](docs/development/terminal-pty-acceptance.md) and
  [proposed managed terminal design](docs/architecture/managed-terminal-design.md).
  An additional [owned terminal library](docs/development/terminal-owned-lab.md)
  now exercises signed one-use grants, owned lifecycle, leased input, exact paste,
  detach/reattach and scoped stop against the same fixed fixture. This records the earlier
  uncomposed stage; the embedded opt-in above now composes those mechanisms.
  Real-provider, human native-dialog and packaging acceptance remain pending.

- **Observed tools increment:** session details group uniquely correlated retained
  Codex invocation/return records, with inert bounded text and per-record sources.
  This is partial historical tool evidence, not a terminal connection; the separate
  embedded Terminal opt-in uses its own ownership/authorization path and still
  lacks real-provider acceptance. See [terminal boundary](docs/development/terminal-boundary.md).

- **Observed usage evolution:** **Most used models** can request a bounded chronological
  chart/table with the current filters, confirmed aggregate reconciliation, explicit
  zero/missing windows and separate lifetime totals without known time distribution.
  UTC windows group interval-end measurements; they do not invent daily consumption.
  Ranking/export contracts remain unchanged. See [contract](docs/api/analytics-evolution.md).

- **Artifact close protection increment:** explicitly closing the panel or session
  details asks before discarding a draft that differs from the retained original.
  Cancel/Escape preserve the draft; copying/saving does not bypass confirmation.
  Session/view navigation, reload and window closing remain outside this protection;
  drafts have no persistence or recovery.

- **Artifact draft editing increment:** the manual panel indicates whether its draft
  exactly matches the retained original and can restore that text after explicit
  confirmation. Cancel/Escape preserve edits. This memory-only comparison does not
  verify saved files; restoration never alters the original or saved files.

- **Session token alert increment:** configure a temporary total-token threshold in
  the confirmed metrics header. The session and manual Artifacts views compare only
  a current confirmed cumulative reading; stale/pending/error/offline readings leave
  comparison unavailable. The threshold clears when session details close or reload.
  This is a visual advisory, without persistence, system alerts or execution control.
  It now shows the exact difference from the confirmed total and a static flame at
  or above the threshold; stale readings suppress both. The difference is not a
  provider allowance or forecast.

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
  or `/models`. Rank covered observations by reported tokens or observed sessions;
  filter local calendar periods, workspace, exact agent/model IDs and implemented
  CLI adapter. Unknown models, missing usage and incomplete coverage stay explicit.
  CSV/Markdown export now projects the current aggregate with bounded validation,
  spreadsheet literals and inert Markdown. Model IDs may contain private metadata;
  review before sharing. Desktop can save the same aggregate through a dedicated
  native dialog and exact-reading revalidation; it never accepts page-supplied report
  content or paths. See the
  [export contract](docs/api/analytics-export.md).
- **Descriptive comparison increment:** choose two or three observed aggregate rows
  in **Most used models** to view reported input/output/cache/total and session counts
  side by side under the current filters and coverage. Unknown values stay unavailable;
  no task equivalence, quality, efficiency, price or current model access is inferred.
  Choices reset with each report reading and never narrow the exported aggregate.
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

The observer has one long-running Bridge process. Optional Desktop Terminal
execution uses separate owned Node/PTY processes and private storage, outside the
observer API and session reader. Analytics queries use one disposable Node worker
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

## Find your work quickly

Use the sidebar to open **Overview**, **Workspace directory**, **Agents & integrations**
or **Most used models**. Press **Cmd/Ctrl+K** to search local workspaces, observed
agents/models, tasks and sessions. The directory supports search, grid/list and
recent/name sorting. Selecting a workspace keeps Analytics in its current view;
source notifications open the relevant session from any screen.

Collapse desktop navigation when space is tight. The last view/workspace, status
filter and directory layout/sort are saved in this browser origin, without search
terms or captured content. This restores UI context, not agent processes. An open
session's sticky context strip shares confirmed token readings with its inspector,
including explicit stale/unavailable states. The adapter matrix reports observation
support, without pretending to detect installations or change models.

See the [interface guide and capability matrix](docs/design/ui-ux-specification.md)
for shortcuts, persistence, current screens and remaining backend dependencies.

## Observed model identifier

The session header labels its historical model identifier explicitly and discloses
that its observation time, current availability, capabilities and selection are
unverified. Missing identifiers stay unrecorded. This first observational Model
Manager increment adds no discovery, model picker or agent controls. See
[Model Manager evidence and limits](docs/architecture/model-manager.md).

The expandable **Recent model observations** history reads at most 32 compact session
evidence records with partial coverage and explicit unavailable/null states. Its times
are normalized-event times, not model declaration or effective-use times. Local cache
discovery remains blocked on source trust; no credentials or provider calls resolve it.
See the [history contract](docs/api/model-history.md).

## Confirmed Live Metrics

Session details and the Artifacts panel show **Confirmed session tokens** from one
bounded evidence-backed query: input/output/cache/total and the metric's own occurrence
time. Cache is included in input. Missing proof is unavailable; previous confirmed
readings are explicitly out of date during refresh/failure/disconnection. These
normalized session totals do not attribute consumption to the artifact or prove
individual provider field presence. Changes between confirmed readings receive a brief
text/outline cue; reduced-motion preferences keep it static. Initial, repeated and stale
readings never trigger the cue. See [Live Metrics and limits](docs/api/live-metrics.md).

## Manual Artifacts

The sidebar and Search & commands expose **Artifact library** (`/artifacts`). This
library searches a bounded, explicitly loaded window of retained message sources and
opens the manual panel below. It is not a catalog of saved Markdown files or drafts.
Select an exact session to explore history beyond the general reading budget. See
[coverage and limitations](docs/api/artifacts.md#searchable-source-library).

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
there is no generic filesystem/shell method or Node renderer access. The shared
dashboard has no agent control; the separate opt-in Terminal uses its own restricted
document and native grants.
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

`pnpm accept:terminal-pty --authorize-synthetic-pty` explicitly runs the fixed
synthetic PTY mechanics experiment on macOS/arm64. It is separate from automatic
tests and launches no agent. See [scope and limits](docs/development/terminal-pty-acceptance.md).

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

- Observed session files are opened read-only and never modified. The observer
  never launches Codex. Explicit managed Terminal login/start uses a new owned
  process and separate private home; the provider can write its own state there.
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
- [Official design system](docs/design/design-system.md) — Minimal Dark + Developer Studio, shared tokens and accessibility.
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
- **External sessions stay read-only.** Observation APIs cannot answer interventions,
  approve tool calls, stop runs or deliver prompts. Alerts direct users to the original
  terminal. Managed Terminal input/signals apply only to separately owned instances.
- **Agentic communication is incomplete.** The optional native dynamic facade now
  has synthetic exact-grant A-to-B-to-A evidence; normal startup exposes no agent
  transport. Real-provider protocol/return, concurrent multi-agent UI and additional
  providers remain unvalidated or undelivered. The native
  Terminal is not hard containment, and provider UI can change its initial defaults.
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
  Bounded interval-end evolution is implemented; daily consumption, task-qualified
  comparisons, verified costs and full Desktop delivery remain unavailable. Native aggregate CSV/Markdown save is implemented with the limits
  in the [export contract](docs/api/analytics-export.md). Real multi-model ranking is unvalidated. See the [design](docs/architecture/model-usage-analytics.md).
- **Token data is only as good as the source.** ORQST records observed
  cumulative session usage; it does not estimate cost, enforce budgets, or
  report provider quota.
- **Validation scope.** Tests include desktop/mobile Chromium and a bounded real-data smoke. Other browsers, multi-gigabyte backfills, and long-running load are not validated.
- **CI configured.** GitHub Actions runs the checks and browser suite; a hosted CI run has not been observed.
- **Distribution is incomplete.** A macOS user-service helper is available; there is no standalone installer, container image, Linux/Windows service installer or published package.

## Validation status

The latest scoped native-delegation delta passed the contributor's lint, types,
366 Node cases and build; independent QA and the integrator each passed its 36
structured-runtime cases with Node 24. Real two-Codex acceptance was not executed.
See the [delta evidence and limits](docs/development/testing.md#scoped-native-delegation-integration--2026-11-03).

The Terminal/communication baseline at `eecf345` passed lint, typecheck, 330 Node
cases and full build using Node 24.22.2/pnpm 10.34.9. The runtime contributor then
validated the identical `c7187ab` source tree with all 353 Node cases, lint, types
and build before integration. The integrator repeated the 46 communication/runtime
cases after fast-forward and checked the global documentation separately. These
are code/build and synthetic-test results, not real managed-provider or
agent-to-agent acceptance.
The installed service, Desktop and user data were preserved. See the
[integration record and skipped checks](docs/development/testing.md#terminal-and-communication-integration--2026-11-03).

The observation-guide increment after `f4ed5f6` passed lint, typecheck, all 303 Node
tests, full build and 45 focused Chromium cases on isolated port 4613. Coverage
includes the guide's real snapshot evidence, unavailable/stale states, keyboard and
focus, exact draft/navigation guards and neighboring Settings/routes/brand behavior.
Synthetic dark/light images at desktop and 320px pt-BR were inspected with maximum
reading sizes. The existing bundle-size advisory remains. Real-source/live-provider,
native Desktop, other-browser and manual screen-reader checks were not repeated;
ingestion and native contracts are unchanged. No installed service, user history or
source session was changed. See the [test record](docs/development/testing.md#first-observation-guide--2026-11-03).

The 2026-11-03 Artifact source-library increment, combined with concurrent Terminal
recovery, passed lint, typecheck, all 303 Node cases, build and 40 focused Chromium
cases for the library, manual Artifacts, draft guards, shell and six view routes.
Dark/light screenshots cover 1440/1280/390/320px at maximum reading sizes. This is
synthetic checkout evidence, not full-archive, native Desktop or screen-reader
acceptance. Ingestion was unchanged; `validate:local` was not rerun. See
[commands and limits](docs/development/testing.md#artifact-source-library-validation--2026-11-03).

The configurable Overview increment started after `39eaf4d` and preserves the
concurrent brand, native-boundary and clean-route work through `f0ef4eb`. Final combined
checks passed lint, typecheck, all 282 Node cases, full build and 69 focused Chromium
cases on isolated port 4591. A broader 132-case Chromium run passed before the final rebase.
The final selection covers layout-only persistence/synchronization, keyboard moves/
focus (including recovery when a trigger disappears), offline/storage denial, exact
active drafts, clean routes/history, brand assets, Settings, reading comfort and themes.
Synthetic images were inspected at desktop and 320px pt-BR with maximum reading sizes.
The existing Vite bundle-size warning remains. No ingestion or native contract was
changed by this increment; local/live provider validation, Electron smoke, other-browser,
native visual and manual screen-reader acceptance were not repeated. This delivery
neither restarts services nor changes stored observations/source sessions. See
[Overview testing](docs/development/testing.md#configurable-overview-panels).

The clean-route increment on 2026-11-03 passed lint, typecheck, 279 Node tests,
build, 36 focused Chromium navigation/draft/preference cases and the separate
brand-layout Chromium case after integration with the current brand and native
terminal-boundary work. A disposable Electron 45.2.1/macOS arm64 smoke passed
real clean-route/reload, source-session selection, isolated IPC and native-save
revocation checks; dialogs, editor dispatch and native alert delivery were
intercepted as described below. The historical-hash address-bar regression and
duplicate navigation events are covered deterministically. No installed service,
owner data or real provider sessions were changed; ingestion is unchanged and no
new `validate:local` run was performed. Native close/quit/reload draft recovery and
other browser/OS acceptance remain outside this evidence.

The Artifact navigation increment after `cb5bc12` passed lint, typecheck, all 254
Node cases and full build. A full Chromium run passed 119 cases; final modal
centering and save-status consolidation were then covered by 19 focused cases
against the rebuilt final bundle. The final checks cover the shared guard, modal focus handoff, browser reload warning,
pending-save blocking and a single save-status announcement. A synthetic pt-BR
screenshot was inspected at 320px with maximum reading sizes. The existing bundle-size
warning remains. No ingestion or native contract changed: local/live provider checks,
Electron smoke, other-browser, manual screen-reader and native visual acceptance were
not repeated. Installed services, Desktop, storage and source sessions were preserved
without restart. See the [test scope](docs/development/testing.md#artifact-navigation-protection).

The reading accessibility increment was checked on top of `b92c971`, preserving
its isolated live-session fixtures and explicit Desktop navigation. Targeted checks
passed lint, typecheck, three appearance/locale Node cases, full build and 12
Chromium cases for reading, Settings and the existing inert Artifact workflow.
Synthetic screenshots were inspected at maximum reading sizes, including pt-BR at
320px; narrow Settings fields stack to keep selected values readable. The existing
bundle-size warning remains. The prior 252-Node/97-Chromium/Electron acceptance was
not repeated wholesale. No ingestion or native contract changed, so real-source/live
provider validation and another Electron smoke were not run. Other browsers,
manual screen-reader and native visual acceptance remain pending. No installed
services, stored observations or source sessions were changed or restarted.

The owned-terminal library candidate (`fdff231`) passed independent read-only critical
QA for experimental, uncomposed integration. Finalization against the navigation
baseline passed lint, typecheck, all 252 Node tests, full build and the explicit
synthetic PTY probe on macOS/arm64 Node24.22.2 with pnpm10.34.9. The existing bundle-size
warning remains. QA's capacity/ownership documentation clarifications are included.
No browser, native Desktop, local-source or live-provider checks were repeated for
this library-only increment; their earlier evidence and failures remain below.
Native authorization, provider terminals and production composition remain unavailable.
See the [lab scope and remaining gates](docs/development/terminal-owned-lab.md).

The navigation/directory increment passed lint, typecheck, 240 Node tests and the
full build after integration with the visual system and synthetic PTY test work.
The complete Chromium run passed 94/97: three existing threshold cases still expect
120 tokens after `dashboard.spec.ts` advances their shared fixture to 170. Their
assertions were preserved. A fresh isolated run passed all 17 shell/threshold cases;
after rebasing, 15 shell/dashboard/Artifacts regression cases passed. Synthetic
screenshots cover 1440/1280/390px, keyboard focus and reduced motion. The build's
bundle-size warning remains. No ingestion changed, so local/live provider validation
and native Desktop smoke were not repeated. Installed services, storage and source
sessions were preserved without restart. Exact approved-collage matching and manual
screen-reader/native visual acceptance remain pending. See the
[interface guide and screen matrix](docs/design/ui-ux-specification.md).

The observed usage evolution increment passed lint, typecheck, 225 Node tests,
full build and a compiled-worker smoke with disposable synthetic storage. Both new
Chromium cases passed after fixture-only corrections, covering actual observer/API
reconciliation, filters, missing/zero windows, locales/mobile and revoked readings.
The first full browser run was **85/89**, not green: one new fixture assertion was
corrected; three existing threshold cases expected 120 tokens after an earlier
Analytics test advanced shared synthetic usage to 190. The mutating test now uses
a dedicated synthetic source/session. A focused regression run passed that test
followed by all three affected threshold cases (4/4), retaining their exact assertions.
No successful full browser rerun is claimed. Build reports a bundle-size warning.
Ingestion is unchanged: local-source/live acceptance and native Desktop smoke were
not repeated. Installed client, services, storage and source sessions were preserved;
real-provider temporal coverage and full Desktop acceptance remain pending.

The descriptive Analytics comparison increment passed lint, typecheck, 222 Node
tests, full build and all 62 Chromium cases, including five independent comparison
QA cases. The first full browser run exposed a synthetic export fixture whose query
did not match the selected period; correcting the fixture to all-history preserved
the existing export checks. The final full rerun passed with exclusive port/state/output.
Independent critical review approved the increment without blockers. These checks use
synthetic reports and disposable observer storage; real-provider multi-model and native
Desktop visual acceptance remain pending. Ingestion is unchanged, so `validate:local`
and live provider tests were not run. The installed service, Desktop, database and
source sessions were preserved without restart.

The native aggregate Analytics export increment (2026-11-02) passed lint, typecheck,
202 Node tests (including 15 independent native-export QA cases), full build and
an Electron45.2.1/Node24.22.1/arm64 disposable smoke. The final affected browser checks
passed 3/3; independent QA passed all 39 Chromium cases with exclusive port/state/output.
The smoke uses real preload/IPC, authenticated refetch and synthetic file writes;
native destination/overwrite dialogs and external dispatch are intercepted. It covers
CSV/Markdown, cancel, overwrite denial/approval, extension refusal, live revocation and
Artifacts regressions. Tests also cover consumed readings, delayed contexts, and
query/ranking/cursor/connection/document changes during choose and confirmation.
Native visual acceptance, real spreadsheet import, real-provider multi-model coverage
and the full Desktop MVP remain unvalidated. No ingestion changed; `validate:local`
was not run. The user's Desktop, installed Bridge, database and sessions were preserved.

The earlier browser-only aggregate Analytics export increment (`a47f799`) passed lint, typecheck, 187 Node
tests (including 18 independent export QA cases), full build and disposable
Electron45.2.1/arm64 smoke with final `result: passed` and successful cleanup. The
unmocked synthetic observer/worker/API test downloads a reconciled CSV. Independent
QA passed the complete 36-case Chromium suite with isolated port/state/output,
including current-query/connection gates and both older Desktop UA and current
preload detection. Initial runs against evolving QA exposed encoded-text assertions
and fixture timing assumptions; the corrected tests retain the negative checks.
That browser-stage export evidence is synthetic. At `a47f799`, native Desktop Analytics
save was still pending; the native increment above now implements it. Real-provider
multi-model and real spreadsheet-import acceptance remain pending.
No ingestion changed, so `validate:local` and token-consuming live tests were not
run for this increment. User Desktop/service/storage were preserved without restart.
See [export fields, limits and privacy](docs/api/analytics-export.md).

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

### Experimental structured pane communication

The [private Core communication library](docs/api/pane-communication.md) now has
stable pane IDs, explicit workspace/actor authorization, a bounded durable SQLite
queue, separate acceptance/start/result evidence and a local result inbox with
post-commit notifications. Tests use synthetic adapters; normal observer startup
has no communication endpoint. The first real two-agent delegation/automatic CLI
response milestone remains incomplete until native ownership, per-terminal state,
structured provider and authenticated agent transport are validated together.
