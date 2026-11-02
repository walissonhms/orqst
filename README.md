# ORQST

**One place. Every agent.**

ORQST is a local-first, agent-agnostic observability platform for AI coding
agents. It observes agent sessions that were started outside ORQST, normalizes
their activity into a provider-independent event protocol, persists it in
SQLite, and streams it to a browser dashboard in real time.

ORQST is not an agent runner. It does not launch, wrap, or modify the agents it
observes, and it does not send prompts or keystrokes back into their sessions.

> **Project status:** MVP v1.0 is under active development. The Codex CLI
> adapter is the only implemented integration. Claude Code and OpenCode exist
> only as documented adapter contracts. ORQST has no remote session control.
> ORQST Community Edition is open source under [Apache-2.0](LICENSE).

## What works today

| Area                                                                         | State                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------- |
| Codex CLI session discovery (read-only)                                      | Implemented                                 |
| Incremental JSONL parsing with checkpoints and recovery                      | Implemented                                 |
| Normalized event protocol with runtime validation                            | Implemented                                 |
| Local SQLite persistence, migrations, retention                              | Implemented                                 |
| Loopback REST API and WebSocket streaming                                    | Implemented                                 |
| React dashboard: workspaces, agents, timeline, attention, tokens             | Implemented                                 |
| English (en-US) and Brazilian Portuguese (pt-BR)                             | Implemented                                 |
| Live notifications (completion real-data path; failure/input fixture-tested) | Implemented, subject to browser permissions |
| Claude Code adapter                                                          | Contract only, not implemented              |
| OpenCode adapter                                                             | Contract only, not implemented              |
| Remote control of agent sessions                                             | Not implemented, by design                  |
| ORQST Cloud, accounts, billing                                               | Not implemented                             |
| Cross-machine synchronization                                                | Not implemented                             |

This is version 0.1.0. Build, type checking, automated/browser tests, native Codex live acceptance and managed-service recovery have been checked on macOS. Final v1.0 acceptance remains pending. See [Validation status](#validation-status) and [Testing](docs/development/testing.md) for scope and reproduction commands.

## Architecture at a glance

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

There is one long-running process. The bridge owns discovery, normalization,
persistence, the REST API, and the WebSocket server. The dashboard is a static
bundle served by the bridge in production and by Vite in development.

- **Node.js 24.x** and **pnpm 10.x** are required.
- **SQLite** is Node's built-in `node:sqlite` (`DatabaseSync`), not a native
  addon.
- **One bridge, one port:** `127.0.0.1:4317` by default. The server never binds
  a public interface.
- **No cloud dependency:** local operation requires no account, API key,
  telemetry, or upload.

## Requirements

- macOS (primary development target; Linux and Windows/WSL are not validated)
- Node.js `>=24 <25` (pinned in `.node-version`; `engine-strict=true`)
- pnpm `10.34.9` (declared in `package.json`; Corepack can provide it)
- Codex CLI installed and used at least once, so that session files exist
- A modern browser for the dashboard

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
| `pnpm build`          | Build the dashboard, then bundle the bridge to `dist/bridge.mjs`                    |
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
  and token totals are retained.

See [docs/architecture/security-model.md](docs/architecture/security-model.md)
and [SECURITY.md](SECURITY.md).

## Documentation

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
- **No remote control.** This is a deliberate product boundary for v1.0, not a
  missing toggle.
- **macOS-first.** Linux and Windows/WSL behavior is unvalidated.
- **Node 24 only.** Older Node versions are rejected by `engine-strict`.
- **No encryption at rest** and no multi-user access control. The local API is
  protected by a per-process session cookie and loopback binding, which assumes
  a single trusted OS user.
- **Redaction is best-effort.** Secrets in unusual formats may survive.
- **Token data is only as good as the source.** ORQST records observed
  cumulative session usage; it does not estimate cost, enforce budgets, or
  report provider quota.
- **Validation scope.** Tests include desktop/mobile Chromium and a bounded real-data smoke. Other browsers, multi-gigabyte backfills, and long-running load are not validated.
- **CI configured.** GitHub Actions runs the checks and browser suite; a hosted CI run has not been observed.
- **Distribution is incomplete.** A macOS user-service helper is available; there is no standalone installer, container image, Linux/Windows service installer or published package.

## Validation status

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
