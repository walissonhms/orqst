# Operations

## Process lifecycle

The bridge is a single Node process.

Startup:

1. Set `umask(0o077)`.
2. Load and validate configuration.
3. Open SQLite, apply migrations, generate or load `machineId`.
4. Bind `127.0.0.1:<port>`.
5. Run retention once.
6. Start the Codex observer (initial scan, watcher, polling).
7. Schedule retention hourly.

Shutdown on `SIGINT` or `SIGTERM`:

1. Stop the retention interval.
2. Stop the observer: mark stopped, clear the poll timer, close the watcher,
   await any active scan.
3. Terminate WebSocket clients and close the WebSocket server.
4. Close the HTTP server.
5. Close SQLite.

There is no `SIGHUP` reload. Restart to change configuration.

## Data locations

| Path                              | Content                                   |
| --------------------------------- | ----------------------------------------- |
| `ORQST_DATA_DIR/orqst.db`         | SQLite database                           |
| `ORQST_DATA_DIR/orqst.db-wal`     | Write-ahead log while running             |
| `ORQST_DATA_DIR/orqst.db-shm`     | Shared-memory file while running          |
| `ORQST_CODEX_SESSIONS/**/*.jsonl` | Read-only source files                    |
| `apps/dashboard/dist`             | Built dashboard, required by `pnpm start` |
| `dist/bridge.mjs`                 | Built bridge bundle                       |

Default data directory: `~/.orqst`.

Permissions are enforced on the data directory (`0700`) and database
(`0600`). Backups inherit sensitivity.

## Managed service

On macOS, `pnpm service:status` reports installed/loaded state and the managed PID. `pnpm service:restart` restarts only the registered ORQST service. The private runtime lives under `~/.local/share/orqst/toolchain`; `pnpm service:uninstall` stops the service while preserving data and runtime. See [local deployment](local.md).

## Logs

The supervised service writes private stdout/stderr under `ORQST_DATA_DIR/logs`. Foreground runs use their terminal. There is no structured logging.

- Startup prints one line to stdout.
- A bind failure prints one line to stderr and exits 1.
- Other errors are generally swallowed at the request or scan boundary; the
  dashboard exposes observer counters instead.
- If you run under a supervisor, capture stdout/stderr there.

This is a deliberate minimal surface, not a complete observability system. For
incident analysis, use the dashboard's "Source health" panel and the database.

## Health checks

Minimal:

```bash
curl -i http://127.0.0.1:4317/api/bootstrap
```

- A `200` means the bridge is listening and the request passed host checks.
- A `403` means the request did not come from a trusted loopback host/origin.
- Connection refused means the process is not running or is on another port.

Authenticated check:

```bash
curl -c cookies.txt http://127.0.0.1:4317/api/bootstrap
curl -b cookies.txt http://127.0.0.1:4317/api/snapshot
```

Check the port on macOS:

```bash
lsof -nP -iTCP:4317 -sTCP:LISTEN
```

In the dashboard, "Source health" shows:

| Counter           | Meaning              | Expected                                  |
| ----------------- | -------------------- | ----------------------------------------- |
| Session files     | `.jsonl` files found | Matches the source tree                   |
| Malformed records | JSON parse failures  | 0 in a healthy source                     |
| Oversized records | Lines over 2 MiB     | 0 unless the provider writes huge records |
| Read errors       | Scan/watch failures  | 0                                         |

`lastScan` is not displayed in the current dashboard, but is present in the
snapshot payload.

## Retention

- Runs at startup and hourly.
- Deletes events older than `ORQST_RETENTION_DAYS` (default 30).
- Cascades to messages and notifications.
- Keeps sessions, summaries, and token totals.
- Does not reset the event cursor.
- Does not vacuum the database. Disk space may not shrink immediately.

To free space after a large purge, stop the bridge and run `VACUUM` with the
`sqlite3` CLI if available. Back up first.

## Changing configuration

Restart is required for every variable.

- **Port:** `ORQST_PORT`. The dashboard dev proxy reads the same variable.
- **Data directory:** `ORQST_DATA_DIR`. Moving it does not migrate existing
  data; copy the database first.
- **Source root:** `ORQST_CODEX_SESSIONS`. Existing checkpoints are keyed by
  root + relative path, so a new root starts fresh.
- **Retention:** `ORQST_RETENTION_DAYS`. Lowering it deletes on the next
  startup or hourly run.
- **Poll interval:** `ORQST_POLL_MS`. Lower values increase idle I/O.

## Troubleshooting

### Port already in use

```
ORQST could not bind the local port. Check ORQST_PORT.
```

Find the listener with `lsof`, stop it, or choose another port.

### Dashboard loads but API returns 401

The cookie is per bridge process. Reload the page. If the bridge restarted, the
old cookie is invalid. If the problem persists, confirm the browser is using
the same host (`127.0.0.1` vs `localhost`) as the bridge.

### Dashboard is blank or returns `dashboard_not_built`

Run `pnpm build`. Confirm you started `pnpm start` from the repository root.

### No sessions appear

1. Confirm the source root contains `*.jsonl` files.
2. Confirm the files have a valid `session_meta` record with a parseable
   timestamp.
3. Check "Source health" for read errors or malformed records.
4. Remember the walk is depth-limited to 5 and skips symlinks.
5. Confirm the process user can read the files.

### Sessions appear but no new events

- Confirm the file is still being appended.
- Check `ORQST_POLL_MS`; the fallback scan may take a few seconds.
- Check whether the event timestamp is recent enough to be classified live.
  Imported history is stored but does not raise notifications.
- A file replaced without an inode change may trigger the anchor reset on the
  next scan.

### Token totals look wrong

- ORQST stores the largest accepted cumulative session snapshot. It does not
  sum every record.
- `cached` is a subset of `input`; it is not added to the total.
- Turn usage is shown only when the source record carries it.
- Compare against the source's own cumulative snapshot, not a sum of turns.

### Notifications do not appear

- Notifications are created only for live completion, failure, and
  intervention events.
- Check preferences: the category may be disabled.
- Browser notifications require permission; the dashboard shows a notice when
  permission is denied or unavailable.
- Sound requires a user gesture to unlock the audio context.
- Imported history never notifies.

### Database cannot open

- Check that the data directory and database are not symlinks.
- Check permissions: directory `0700`, database `0600`.
- Check that the database is not newer than the application.
- If the file is corrupt, stop the bridge, move it aside, and restart. The
  observer re-reads available Codex files from the beginning because
  checkpoints are lost. History detail is rebuilt from the source, subject to
  retention and the per-scan budget.

### Node version error

`engine-strict=true` rejects anything outside `>=24 <25`. Switch to Node 24.

## Incident checklist

1. Is the process running and bound to the expected port?
2. Does `/api/bootstrap` return 200 from `127.0.0.1`?
3. Is the dashboard connected (live indicator)?
4. What do the source-health counters show?
5. Did the source root or Codex version change?
6. Is the data directory writable and not a symlink?
7. Was the bridge restarted (cookie invalidation expected)?
8. Is retention deleting the events being investigated?
9. Is the browser blocking notifications or audio?

## Security operations

- Do not expose the port.
- Do not share the data directory.
- Treat backups as sensitive.
- Rotate/delete history by deleting the data directory when no longer needed.
- Do not paste real captured content into issues or logs.
- Review `SECURITY.md` before changing deployment topology.
