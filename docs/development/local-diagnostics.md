# Local native diagnostics — 2026-11-04

The Tauri source now has an optional structured JSONL sink independent of stdout
and stderr. Native setup records its beginning, Core startup result, completion
and exit request. Terminal preparation/startup/enrollment hooks are a separate
integration increment; the writer alone does not establish their coverage.

## Location and retention

The native shell supplies its own `app_data_dir()`; no document or request can
choose the destination. Files live in `<app_data_dir>/diagnostics/`:

- `native.jsonl`: active log, at most 1 MiB.
- `native.1.jsonl` and `native.2.jsonl`: two previous segments, at most 1 MiB each.
- `native.lock`: empty advisory-lock file. Only one writer uses this directory;
  the operating system releases the lock when its file/process closes. Its
  presence alone does not indicate an active writer. Do not delete it to bypass
  another writer's ownership.

For the current macOS identifier `dev.orqst.desktop.preview`, the normal location
is `~/Library/Application Support/dev.orqst.desktop.preview/diagnostics/`.
Another bundle identifier has another app-data root. Logs rotate by size, not
age: new records can displace old attempts, and low activity retains old records.
There is no automatic upload or exported diagnostic API.

On macOS, inspect recent records locally:

```bash
tail -n 100 "$HOME/Library/Application Support/dev.orqst.desktop.preview/diagnostics/native.jsonl"
```

Read `native.2.jsonl`, then `native.1.jsonl`, then `native.jsonl` for retained
chronological segments. To inspect one attempt, copy its diagnostic UUID and use
an exact fixed-string search across those three files. Review before sharing:
even content-free timestamps and activity cadence can be private.

## Record contract

Every record has exactly `v`, `unix_ms`, `elapsed_ms`, `attempt`, `level`, `event`
and `dropped_before`. Version is `1`; time is local wall-clock milliseconds since
Unix epoch plus monotonic elapsed milliseconds within an attempt. Wall-clock
adjustments do not change elapsed time. `attempt` is an opaque UUID-shaped
correlation identifier generated in memory, unrelated to the workspace, Feature,
session, terminal, process, owner, epoch or proof. It is never authority or evidence
of ownership, execution or completion. Cloning `Attempt` preserves correlation
and the monotonic origin; passing the same instance/reference through the native
helper/start/enrollment boundaries keeps one diagnostic timeline.

`Attempt::begin() -> Attempt`, `Attempt::id() -> &str` and
`Attempt::record(Event) -> ()` are the entire event-writing API. `Event` has only
reviewed unit variants: attempt, helper, review, commit, opening, host,
enrollment, presentation, Core and native setup/exit boundaries. The event enum
accepts no arbitrary text or attached JSON. Neither errors/stacks nor stdout,
stderr, prompts, terminal/session content, paths, manifests, config, credentials,
proofs or application identities can be supplied to the writer.

An event says only that its instrumented boundary was reached. A request is not
an acknowledgment; ready is not provider acceptance. A missing final event is
not proof of a crash, deadlock, process exit or absent effects. Preserve existing
uncertainty, reservation, grant, focus, generation and commit/open fences.

## Failure isolation and security

`record` uses `try_send` to a 256-record queue; it does not await, perform disk I/O
or acquire an application mutex. A separate writer thread opens/appends/rotates.
Records contain only small fixed fields; queue size and disk retention are bounded.
Full/disconnected queues discard records and increment a saturating counter. The
next retained record includes the count observed by the writer, not a promise
that every lost record can be recovered or attributed to that attempt.

The diagnostics directory uses `0700` and files use `0600`. On macOS/Linux,
existing symlink ancestors are rejected, final files open with `O_NOFOLLOW`, and
non-regular/multiply-linked files are rejected. A nonblocking OS advisory lock
excludes another cooperating writer. Fixed names restrict rotation to diagnostic
segments, without scanning/deleting unrelated files. Parent paths originate only
from the native bootstrap. These checks do not claim protection against arbitrary
same-user code replacing ancestor paths concurrently or ignoring advisory locks.

Sink initialization, thread spawn, lock contention, permission errors, disk-full,
write/rotation errors or unsupported platforms silently disable the sink. There
is no synchronous fallback to stderr, retry/respawn or operation failure. An
oversized pre-existing segment is refused rather than appended to or deleted.
After the first I/O failure the writer stops for the process lifetime; there is
no automatic sink recovery. Windows/other platforms currently disable the disk
sink pending equivalent filesystem controls.

Logging never waits for a flush on exit and does not fsync each record. Abrupt
exit, crash, queue saturation or storage failure can lose queued/tail records.
Absence of a log therefore remains inconclusive. This sink is not the persisted
observer event store and adds no HTTP/WebSocket/IPC command, telemetry, global
exception handler, provider launch, native retry or runtime.

## Checks and remaining acceptance

Six standalone Rust tests passed with Rust `1.99.1` using only standard-library
code: opaque correlation/clone, closed serialization, full/disconnected queue
tolerance through the public API, rotation/permissions/writer exclusion, symlink
and hardlink refusal, and ancestor/oversize refusal. Temporary fixture paths were
new synthetic directories under the canonical temporary root; no user state was
opened. Rust formatting and `git diff --check` passed.

```bash
rustc --edition 2021 --test apps/tauri/src-tauri/src/local_diagnostics.rs -o /private/tmp/orqst-local-diagnostics-tests
/private/tmp/orqst-local-diagnostics-tests
rustfmt --edition 2021 --config skip_children=true --check apps/tauri/src-tauri/src/local_diagnostics.rs apps/tauri/src-tauri/src/main.rs
git diff --check
```

The actual commands used the existing toolchain's absolute executable paths.
This is pure source verification. No Cargo/native compilation, app build,
resources, app launch, provider, real reproduction or native UI acceptance ran.
The historical uncertain Codex opening remains unproven; logs cannot reconstruct
an earlier attempt that was never recorded. Existing apps, uncertain reservations
and historical evidence remain untouched. See the
[pinned source/reuse review](../research/local-diagnostics.md).

## Integration checklist fragment

- [x] Add private bounded asynchronous writer and native setup/exit hooks.
- [x] Verify standard-library writer behavior in six pure synthetic tests.
- [ ] Integrate same-attempt hooks for helper/commit/open/startup/enrollment/UI.
- [ ] Compile the combined native app in the coordinated build gate.
- [ ] Validate actual local file creation/rotation and future failure diagnosis
      in an explicitly authorized new native run.
- [ ] Accept platform coverage; Windows sink and native/provider parity remain open.
