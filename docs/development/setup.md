# Development setup

## Prerequisites

| Requirement | Version                                | Notes                                                       |
| ----------- | -------------------------------------- | ----------------------------------------------------------- |
| Node.js     | `>=24 <25`                             | Pinned by `.node-version`; enforced by `engine-strict=true` |
| pnpm        | `10.x` (declared `10.34.9`)            | `corepack enable` is the intended path                      |
| macOS       | primary target                         | Linux and Windows/WSL are not validated                     |
| Codex CLI   | any version that writes JSONL sessions | Needed for real data, not for unit tests                    |
| Browser     | modern Chromium/Firefox/Safari         | Dashboard                                                   |

`node:sqlite` is part of Node 24. Do not use an older Node major; the database
layer depends on it.

## Install

```bash
corepack enable
pnpm install
```

If Corepack is unavailable, install pnpm 10 through your normal toolchain. Do
not switch the repository to npm or yarn; the workspace uses `workspace:*`
protocol dependencies and a pnpm lockfile.

## Environment

ORQST reads environment variables directly and does **not** load `.env`
automatically. `.env.example` documents every supported variable.

For a shell session:

```bash
export ORQST_PORT=4317
export ORQST_DATA_DIR="$HOME/.orqst"
export ORQST_CODEX_SESSIONS="${CODEX_HOME:-$HOME/.codex}/sessions"
```

For the built bridge:

```bash
node --env-file=.env dist/bridge.mjs
```

Defaults are usually sufficient. See the configuration table in
[README.md](../../README.md#configuration).

## Development run

```bash
pnpm dev
```

This starts two processes:

- the bridge via `tsx watch` on `127.0.0.1:4317`, with `ORQST_DEV=1`;
- the Vite dev server on `127.0.0.1:5173`.

Open `http://127.0.0.1:5173`. Vite proxies `/api` and `/ws` to the bridge.
`ORQST_DEV=1` is what allows the bridge to trust the Vite origin.

If `ORQST_PORT` is changed, Vite reads the same variable for its proxy target.

## Production-style build

```bash
pnpm build
pnpm start
```

`pnpm build`:

1. builds the dashboard with Vite into `apps/dashboard/dist`;
2. bundles `apps/bridge/src/main.ts` with esbuild into `dist/bridge.mjs`,
   keeping `chokidar`, `ws`, and `zod` external.

`pnpm start` runs `node dist/bridge.mjs`. Run it from the repository root: the
bridge resolves `apps/dashboard/dist` relative to the current working
directory.

Open `http://127.0.0.1:4317`.

## First run with no Codex sessions

The bridge starts with an empty database and an empty dashboard. That is
expected.

Open **Observation guide** in the empty-session welcome, Settings / General or
Search & commands. Its three steps explain the existing Bridge connection, source
reading diagnostics and retained-session count across all workspaces. A missing
snapshot stays unavailable; disconnected or failed refreshes qualify last loaded
evidence. The guide links to the existing capability inventory and workspace
directory. It never starts Codex, scans installations, tests authentication or
changes service configuration. Check `ORQST_CODEX_SESSIONS` in the Bridge environment
if existing history is missing; the dashboard does not receive that configured path.

Synthetic discovery checks belong to the isolated automated harness:

```bash
pnpm test
pnpm build
pnpm test:browser
```

These fixtures are explicitly labeled synthetic and never become ordinary local history. For an authorized real CLI cycle with an already-running local ORQST and Codex login, use `pnpm validate:live`; it uses actual provider resources. For managed startup, see [local deployment](../deployment/local.md).

## Data directory

Default: `~/.orqst`.

- `orqst.db` — SQLite database (plus WAL/SHM files while running).
- Created with mode `0700`; the database is mode `0600`.
- Delete the directory to reset local history. Codex session files are
  untouched and will be re-read on the next scan.

## Commands

| Command               | What it does                                    |
| --------------------- | ----------------------------------------------- |
| `pnpm dev`            | Bridge watch mode + Vite                        |
| `pnpm build`          | Dashboard build + bridge bundle                 |
| `pnpm start`          | Run the built bridge                            |
| `pnpm test`           | Node test suites via `tsx --test`               |
| `pnpm lint`           | ESLint + Prettier check                         |
| `pnpm format`         | Prettier write                                  |
| `pnpm typecheck`      | `tsc --noEmit`                                  |
| `pnpm validate:local` | Real Codex data validation into a disposable DB |

## Common setup problems

### `ERR_PNPM_UNSUPPORTED_ENGINE`

Your Node version is outside `>=24 <25`. Switch to Node 24. Do not disable
`engine-strict` to work around it.

### `pnpm: command not found`

Run `corepack enable`, or install pnpm 10 explicitly. The repository declares
the expected version in `package.json`.

### Port already in use

The bridge exits with a message. Set another port:

```bash
ORQST_PORT=4400 pnpm start
```

The dashboard dev proxy reads `ORQST_PORT` too.

### Dashboard shows `dashboard_not_built`

In production mode, `apps/dashboard/dist` is missing. Run `pnpm build` first,
or use `pnpm dev`.

### Dashboard cannot connect after a bridge restart

The session cookie is per process. The dashboard reconnects and bootstraps again automatically. If it does not, check the browser console and the bridge
port.

### No sessions appear

- Confirm `ORQST_CODEX_SESSIONS` points at the directory containing `*.jsonl`
  files, not the parent.
- Check the "Source health" panel: `files`, `malformed`, `oversized`, `errors`.
- The walk is limited to depth 5 and skips symlinks.
- A session file must contain a valid `session_meta` record before other
  records are accepted.

### Node 24 is installed but the shell uses another version

Check `node -v` in the same shell that runs pnpm. Version managers often keep a
different default per shell. The primary validation shell initially reported Node 20.10 and a broken pnpm shim. Checks used isolated Node 24.22.2/pnpm 10.34.9; select a compatible toolchain in your own shell.

## What not to do

- Do not add a `.env` loader dependency; use shell exports or `--env-file`.
- Do not change the package manager or hand-edit `pnpm-lock.yaml`.
- Do not run the bridge on `0.0.0.0` or behind a public proxy.
- Do not point `ORQST_CODEX_SESSIONS` at a directory you do not trust; ORQST
  reads every `.jsonl` file under it (within the depth and size limits).
- Do not commit captured session data or database files.
