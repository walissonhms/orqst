# Local deployment

## Supported topology

ORQST is designed for one user on one machine:

- one bridge process;
- loopback HTTP/WebSocket on `127.0.0.1`;
- one local SQLite database;
- one or more browser tabs on the same machine;
- Codex CLI sessions produced by the user's normal workflow.

This is the only supported topology. Containers, remote hosts, shared machines,
and public exposure are not supported.

## Build and run

From the repository root:

```bash
corepack enable
pnpm install
pnpm build
pnpm start
```

Open `http://127.0.0.1:4317`.

`pnpm start` runs `node dist/bridge.mjs`. It must run with the repository root
as the working directory because the dashboard bundle is resolved at
`apps/dashboard/dist`.

The bridge prints one startup line:

```
ORQST 0.1.0 · http://127.0.0.1:4317 · local only
```

If the port cannot be bound, it prints an error and exits with status 1.

## Configuration

All configuration is environment-based. ORQST does not load `.env`
automatically.

| Variable               | Default                            | Notes                        |
| ---------------------- | ---------------------------------- | ---------------------------- |
| `ORQST_PORT`           | `4317`                             | Loopback only; 1024–65535    |
| `ORQST_DATA_DIR`       | `~/.orqst`                         | Created with mode `0700`     |
| `ORQST_CODEX_SESSIONS` | `${CODEX_HOME:-~/.codex}/sessions` | Read-only source             |
| `ORQST_RETENTION_DAYS` | `30`                               | 1–3650                       |
| `ORQST_POLL_MS`        | `3000`                             | 500–60000                    |
| `ORQST_DEV`            | unset                              | Only for the Vite dev server |

Example with an env file:

```bash
node --env-file=.env dist/bridge.mjs
```

See [`.env.example`](../../.env.example).

## Managed macOS user service

The repository ships a runtime installer and a launchd service manager. They are validated on the current macOS development machine. No root/system-wide service or global toolchain change is needed.

```bash
pnpm runtime:install
export PATH="$HOME/.local/share/orqst/toolchain/bin:$PATH"
pnpm service:plan
pnpm service:install
pnpm service:status
```

`runtime:install` copies the current validated Node 24 binary and the exact `packageManager` pnpm package into `~/.local/share/orqst/toolchain`. It verifies the Node digest and both versions. Repeating the command reuses a matching installation; it refuses to overwrite an unmanaged/different destination. Options `--node`, `--pnpm` and `--destination` accept explicit paths when bootstrapping from a compatible existing toolchain.

`service:plan` renders the concrete XML/configuration as JSON without writing files or starting processes. Installation validates the plist with `plutil`, refuses an unmanaged port listener, and registers `~/Library/LaunchAgents/dev.orqst.bridge.plist` in the current GUI user domain. Only the existing ORQST configuration variables and a minimal PATH are exported to the service. Unrelated environment credentials are excluded.

The launch agent uses the absolute private Node path and checkout path. `RunAtLoad` enables startup at login. `KeepAlive` with `SuccessfulExit=false` configures recovery from unsuccessful exits; a deliberate successful shutdown can remain stopped until restarted. Restarting the operating system was not part of validation.

The installation is tied to this checkout. If you move it, uninstall the existing service from the old checkout and install again from the new one. A helper refuses to overwrite a service owned by another checkout.

```bash
pnpm service:restart
pnpm service:uninstall
```

`service:restart` targets only `dev.orqst.bridge`, reads the installed port, and verifies the new managed PID owns that loopback listener. Restart invalidates the process cookie; open dashboards reconnect and bootstrap automatically. `service:uninstall` stops/unloads the service and removes its plist while preserving data, backups, logs and runtime.

If a standalone ORQST is already running, stop that verified process first (Ctrl+C in its own terminal). The installer never kills an arbitrary port holder. For the initial migration, a consistent SQLite backup was made and checked before replacing the known old process.

Private service output goes to `ORQST_DATA_DIR/logs/bridge.stdout.log` and `bridge.stderr.log` (directory 0700, files 0600). The source logs remain read-only and loopback binding is unchanged.

## Linux and Windows/WSL

Linux and Windows/WSL are not validated. The code is Node-based and the bridge
binds loopback, but path handling, file identity (`dev:ino`), watcher behavior,
and filesystem permissions have not been tested there.

If you try Linux, the equivalent supervision is a user-level systemd unit. It
is also illustrative:

```ini
[Unit]
Description=ORQST local bridge
After=default.target

[Service]
Type=simple
WorkingDirectory=/absolute/path/to/orqst
ExecStart=/absolute/path/to/node /absolute/path/to/orqst/dist/bridge.mjs
Environment=ORQST_PORT=4317
Restart=on-failure

[Install]
WantedBy=default.target
```

Do not run it as a system-wide service or as a different user than the one whose
Codex sessions you want to observe.

## Reverse proxies and containers

Do not put ORQST behind nginx, Caddy, Traefik, or a tunnel. Do not publish its
port from a container. Do not bind `0.0.0.0`.

The API has no user authentication beyond a per-process cookie, no TLS, and no
rate limiting suitable for a network service. Loopback binding is a security
control, not a default to override.

## Backup

The database contains captured prompts and tool output. Treat backups as
sensitive.

Safe procedure:

1. Stop the bridge (`SIGTERM` or `SIGINT`). It closes the observer, HTTP server,
   and database.
2. Copy the entire data directory, including `orqst.db`, `orqst.db-wal`, and
   `orqst.db-shm` if present.
3. Restart the bridge.

Example:

```bash
pnpm service:uninstall
cp -a "$HOME/.orqst" "$HOME/.orqst-backup-$(date +%Y%m%d)"
pnpm service:install
```

If you run the bridge in the foreground, send `SIGTERM` to its PID instead.
Use `service:uninstall` for a stopped backup window; it does not delete application data. A consistent online SQLite backup is also available as described below.

If you must back up while running and have the `sqlite3` CLI, use its backup
command rather than a plain file copy:

```bash
sqlite3 "$HOME/.orqst/orqst.db" ".backup '$HOME/orqst-backup.db'"
```

## Restore

1. Stop the bridge.
2. Move the current data directory aside.
3. Restore the backup directory or database file.
4. Ensure the directory is `0700` and the database is `0600`.
5. Start the bridge.

If the backup predates recent events, ORQST re-reads Codex session files from
its checkpoints. A restored checkpoint resumes from that offset; deleting the
database causes a full re-read of available source files, subject to the 8 MiB
per-file, per-scan budget.

## Upgrade

1. Back up the data directory.
2. Stop the bridge.
3. Update the checkout.
4. `pnpm install`
5. `pnpm build`
6. Start the bridge.

Database migrations run automatically inside a transaction. A database newer
than the application refuses to start; there is no downgrade path. Changing the
Node major requires revalidating `node:sqlite` behavior.

## Uninstall

1. Stop the bridge and remove any service definition.
2. Remove the checkout.
3. Optionally remove `ORQST_DATA_DIR` (default `~/.orqst`).

Removing the data directory deletes local history. It does not touch Codex
session files.

## Resource expectations

- The bridge is a single Node process. Resource usage depends on retained history; no long-running memory bound has been established.
- SQLite grows with captured event detail and shrinks only when retention
  deletes old events; SQLite may not return disk space to the OS immediately.
- The observer reads at most 8 MiB per file per scan, so a large backlog is
  processed gradually.
- The dashboard polls the snapshot every 5 seconds in addition to WebSocket
  updates.

## Verification after deployment

```bash
curl -c cookies.txt -i http://127.0.0.1:4317/api/bootstrap
curl -b cookies.txt http://127.0.0.1:4317/api/snapshot
```

Then open the dashboard and confirm the connection indicator is live. See
[operations.md](operations.md) for troubleshooting.
