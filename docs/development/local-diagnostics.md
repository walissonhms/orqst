# Local native diagnostics — 2026-11-04

The Tauri source has an optional structured JSONL sink independent of stdout and
stderr. This increment is based on the combined source freeze
`5e2b03454f336d0d7417ffa2565a3b25262226f8`; it preserves both the mutex/UI
revalidation and keyed admission/reader cleanup corrections. The writer, hooks
and pure tests are source work. No installed app or running process has these
changes until a separately authorized build and deployment.

## Location and retention

The native shell supplies `app_data_dir()`; no renderer or agent chooses a path.
Files live in `<app_data_dir>/diagnostics/`:

- `native.jsonl`: active log, at most 1 MiB.
- `native.1.jsonl` and `native.2.jsonl`: two previous segments, at most 1 MiB each.
- `refusals.jsonl`, `refusals.1.jsonl`, `refusals.2.jsonl`: separate bounded renderer-originated segments, at most 1 MiB each.
- `native.lock`: empty `0600` advisory-lock file. Its presence does not prove a
  live writer; the OS releases the lock when its descriptor/process closes.

Maximum generated log retention is 6 MiB, plus the empty lock; renderer-originated rotation never removes native segments. Rotation uses size,
not age; low activity may retain old timestamps indefinitely. No unrelated file
is scanned or removed. An oversized pre-existing segment is refused, not deleted
or truncated. Do not remove a lock to bypass another writer.

The configured macOS identifier is `dev.orqst.desktop.preview`; its normal path is
`~/Library/Application Support/dev.orqst.desktop.preview/diagnostics/`. A different
bundle identifier has a different app-data root. Inspect locally:

```bash
tail -n 100 "$HOME/Library/Application Support/dev.orqst.desktop.preview/diagnostics/native.jsonl"
```

For retained chronological segments, read `native.2.jsonl`, `native.1.jsonl`, then
`native.jsonl`. Copy the diagnostic UUID from a record and search it exactly
across these files. There is no upload, server, exported API or sharing action.
Timestamps and activity cadence can still be private; review before sharing.

## Closed record/API contract

Each native operational JSONL record has exactly `v`, `unix_ms`, `elapsed_ms`, `attempt`, `stage`,
`outcome`, `effects`, `dropped_before`. Version is `1`; timestamps are local Unix
milliseconds and monotonic elapsed milliseconds from that attempt's beginning.
Clock adjustments do not change elapsed time. Every record is limited to 512
bytes. The pending queue holds at most 256 fixed-size typed records; serialized
records for a full queue would be at most 128 KiB.

`local_diagnostics::{Attempt, Stage, Outcome, Effects}` exposes:

```text
install(PathBuf) -> ()                         // native bootstrap only
Attempt::begin() -> Attempt                    // fresh diagnostic UUID
Attempt::id() -> &str
Attempt::record(Stage, Outcome, Effects) -> ()
Stage/Outcome/Effects::parse(&str) -> enum       // unknown -> Unconfirmed
```

The private constructor makes a fresh UUID v4-shaped identifier from standard
library randomized hash state and an in-memory serial. It contains no application
identity, timestamp, content or path and is not a cryptographic token. Cloning an
`Attempt` preserves the identifier and monotonic origin. It is exclusively
correlation for this diagnostic attempt, never owner, epoch, terminal/session ID,
proof, request authority, recovery evidence or an execution capability.

Enums hold only static allowlisted labels. Parsing never retains the input;
unknown labels become `unconfirmed`. No arbitrary JSON, error string or text field
can enter a record. Prompts, CLI/session/terminal content, credentials, auth/config,
raw stderr, proofs, owner/epoch/manifest fields and private paths are excluded.
There is no generic logger/redaction fallback and no exception handler.

Only explicitly enumerated renderer request receipt, success and guard refusal events
share a monotonic 60-second window. All other stage/outcome combinations, including
new vocabulary entries, are native by default. At most one entry per fixed
source/stage/outcome and eight entries total are written at window end, followed by
one aggregate `suppressed` count when nonzero. The existing `refusals.*` segments
hold this bounded stream. Source, stage and outcome are closed labels; request data,
paths and IDs are excluded. The window never enters the native operational queue or
rotates its segments. Helper, host, enrollment transport failures and timeouts,
startup, shutdown and lifecycle events use the reserved native stream regardless of
what initiated them. This stream is itself bounded and best effort: queue saturation,
rotation, abrupt exit or sink failure can still lose records. A renderer stream write
failure disables only that stream. Aggregation is not a security audit or proof of a
request.

## Instrumented boundaries and correlation

- Native setup, observer startup, readiness, timeout, protocol/transport failure,
  disconnection and EOF share the setup's diagnostic attempt. The owned shutdown
  circuit records its observed exit or blocked result in the native stream. Exit has a fresh
  diagnostic attempt and does not wait for a flush.
- Preparation creates one attempt before the existing helper run. Its
  spawn, review choice, commit decision, helper exit/cancellation and final typed
  failure are recorded in the native stream. Renderer request receipt and success
  are aggregated without their UUID, while native menu attempts use the operational stream. Validated `stage/code/effects` failures are projected into
  closed enums; the actual error/result is preserved unchanged.
- Opening dispatch, host startup/readiness/failure, enrollment and presentation
  receive the same attempt. Existing `startup-N` protocol correlation remains
  unchanged and private: Rust first validates the keyed reply, then records its
  typed outcome against the independent diagnostic UUID. `startup-N` is never
  parsed as a UUID, persisted as `attempt`, or granted authority.
- At most eight optional in-memory tags carry that attempt from prepared members
  to their first `open` dispatch. Dispatch lifecycle records use the native stream.
  Consuming a tag changes diagnostic
  correlation only. Later manual opens get fresh attempts. Tags never participate
  in focus, grant, generation, ownership, intent or pending-reply decisions.
- A dispatch logs only its projected public reply: explicit `opening:ready` is
  `ready`, `opening:incomplete` stays `uncertain`, and absent/unknown opening
  evidence stays `unconfirmed`. `instanceId` and output are never recorded. The
  host reader retains the original attempt for later protocol/transport/EOF loss;
  this does not attribute a host-lifetime loss to a particular later append.

`helper_complete/succeeded` means observed helper exit code zero; it does not
validate the returned preparation or prove provider execution. Native setup ready
includes the existing unavailable-observer view. Host readiness, presentation and
opening readiness describe their exact source boundary, not login, inference or
provider/native acceptance. Effects remain conservative: `not_started` only from
the existing validated failure boundary, `possible` for typed
uncertain/mutation/open paths, and `unconfirmed` otherwise. Nothing in
these logs upgrades or replaces the existing failure/authority contract.

A missing final record cannot establish a crash, deadlock, process exit or absence
of effects. The old Codex alert/hang has no proved historical cause and cannot be
reconstructed by this new sink. No reservation is reconciled, mutated or cleaned.

## Failure isolation and filesystem controls

Native `record` calls `try_send`; allowlisted renderer request `record` takes only the
diagnostic aggregation mutex. Neither awaits, touches disk, takes an application
mutex, calls a UI getter or returns a success/failure to operational code. One writer thread
opens/appends/rotates fixed files, without a new app, agent or execution runtime.
Full/disconnected queues discard records and increment a saturating counter. The
next retained record includes the count observed by the writer; the count is
process-wide loss, not attribution or completeness for that attempt.

On macOS/Linux, the diagnostic directory is `0700` and files are `0600`. Ancestor
symlinks are refused; final files use `O_NOFOLLOW | O_NONBLOCK`, regular-file,
single-link and owner checks. An OS nonblocking advisory lock excludes another
cooperating writer. Existing diagnostic directory ownership must match the native
app-data parent. Same-user code racing directory replacement or ignoring locks is
outside these guarantees. Windows/other platforms disable the disk sink pending
equivalent controls.

Initialization/thread spawn/lock contention, permission/disk/rotation errors or an
unsupported platform silently disable the sink. First disk error stops the writer
for the process lifetime. There is no synchronous stderr fallback, retry loop,
respawn or change to a decision, effect, grant, latch, timeout or retry policy. No
new getter/await is introduced under an application mutex. Existing Core/PTY,
SQLite, observer boundaries, startup IDs, keyed EOF cleanup and public Stop remain
in place.

Exit never waits for diagnostic persistence, and there is no per-record fsync.
Abrupt exit or storage failure can lose tail/queued records; a partial final line
may remain after a write failure and should be ignored when querying. Retention
can discard an attempt's beginning. This is not the observer's persisted event
store, replay log, session history or durable completion evidence.

## Checks and remaining acceptance

Current change used the existing Node `24.22.2`, pnpm `10.34.9` and Rust `1.99.1`
toolchains, reusing dependency symlinks without installation or copying targets.
Eleven standalone Rust cases run the production writer plus the extracted opening
outcome function: UUID/clone/correlation, closed privacy projection, budgets,
full/disconnected queues, bounded rotation, permissions/writer exclusion,
symlink/hardlink/ancestor refusal, oversized-existing-file preservation and
uncertain/unconfirmed opening results. Eight additional pure Rust cases cover
the unchanged mutex/revalidation and admission/late-EOF gates. Thirty-one focused
Node cases cover startup failure protocol, Studio, Feature view and layout with
synthetic files/in-memory backends. No host/Core, app, provider or PTY is launched;
one Studio test bundles only a small client fragment in memory.

```bash
RUSTC=/path/to/existing/rustc node scripts/test-local-diagnostics.mjs
RUSTC=/path/to/existing/rustc node scripts/test-tauri-ui-locks.mjs
rustc --edition=2021 -D warnings --test apps/tauri/src-tauri/src/terminal_admission.rs -o /tmp/orqst-admission-test
/tmp/orqst-admission-test
pnpm exec tsx --test tests/terminal-startup-failure.test.ts tests/tauri-studio.test.ts tests/tauri-terminal-layout.test.ts tests/feature-view.test.ts
pnpm lint
pnpm typecheck
rustfmt --edition=2021 --config skip_children=true --check apps/tauri/src-tauri/src/local_diagnostics.rs apps/tauri/src-tauri/src/main.rs apps/tauri/src-tauri/src/sidecar.rs apps/tauri/src-tauri/src/terminal.rs apps/tauri/src-tauri/src/terminal_creation.rs tests/native/local-diagnostics.rs
git diff --check
```

Lint passed. The first types/Node runs found unresolved package-local dependencies
in the new worktree; reusing the existing package dependency directories fixed that
environment issue. The repeated 31 Node cases and full typecheck passed. Full
`pnpm test`, `pnpm build`, Cargo, resource staging, installed app/native/provider acceptance and real reproduction
are deliberately excluded. Available disk remained about 25 GiB; no Node install,
Cargo target, app bundle or resource tree was created or cleaned.

- [x] Implement the bounded writer, closed API and same-attempt source hooks above
      the combined mutex/admission freeze.
- [x] Exercise pure filesystem/privacy/correlation and existing mutex/ownership
      regressions with existing toolchains.
- [ ] Compile the combined native shell in a separately authorized build gate.
- [ ] Validate actual packaged log creation/rotation and future failure diagnosis
      in an authorized native run. No existing app is operated for this delivery.
- [ ] Accept Windows/native/provider parity and establish any historical cause.

See the [pinned reference and reuse review](../research/local-diagnostics.md).

Preparation preflight denials now record closed, static `studio_*` and `feature_*`
outcomes without request values. `studio_post_identity` reports possible effects;
earlier native preparation guards report not started. Feature focus and pre-presentation context checks use separate closed outcomes;
`feature_post_context` identifies the combined fence after presentation.
A renderer-detected catalog scope mismatch shows a local denial notice and does not
write a native diagnostic.

## Renderer admission and lock-test limitation

Native admission limits each authenticated document label and action to 12 requests
per fixed 60-second window. Catalog, creation, selection, preparation navigation,
terminal open and terminal start (including managed-agent start) use separate buckets. A burst across a window edge
can admit up to 24 operations. Exceeding a bucket returns `rate_limited` before the
helper, opening diagnostic or native dispatch; the UI displays a localized notice
and does not retry that operation. Automatic catalog refresh on focus is suspended
after a refusal until the user explicitly refreshes. A prepared open intent is not
consumed by a refusal. Native menu actions and lifecycle records do not use this
renderer admission path.

Equal in-flight catalog requests for the same native generation, source URL,
webview label, parent and exact request share the same helper and result, up to
the admission limit. A different identity or request does not join it; the existing
single preparation latch returns busy while another request is in flight. The detached native task completes even if its caller
disappears, and each caller revalidates its own document before receiving a result.
Rate refusals are counted without document IDs or payloads in the renderer stream:
one aggregate per source per 60-second diagnostic window, subject to the existing
best-effort sink and rotation. Native event classification is unchanged.

The diagnostic lock test previously observed `WouldBlock` reopening the lock in
3/30 and 2/30 parallel suite runs. A separate experiment showed inherited file
descriptors can plausibly retain a lock. Isolating the lock lifetime in a subprocess
then yielded 0/30 failures in both isolated and full-suite repetitions. Suite
interference is probable, **not proved**: the descriptor owner was not identified.
The test still checks competing-writer exclusion and immediate reopen after close;
no production lock behavior, retry or timeout was changed. This does not establish
whether an independent production defect exists.

The reference decisions in [the pinned diagnostics review](../research/local-diagnostics.md)
remain applicable: Anywh `AgentEventLog.append/rotate` at `546f189c04415c3c5af5f40e3931a0a90b9aba31`
is a synchronous replay log, and Tucano's router at `0501956d127699300209902e889f3e69a0948766`
handles content-oriented routing; neither provides this native admission contract.
Both pinned root licenses are Apache-2.0, with no NOTICE found in that review.
No upstream code or dependency is incorporated.

Synthetic tests exercise the admission implementation, in-flight coordinator,
aggregated counts and bounded representative native records, plus the typed client
responses. They do not invoke a real Tauri Webview command or prove native UI,
provider or package behavior. Like any finite rotating log, sustained admitted
activity can eventually rotate older native records; the rate limit bounds work
per window and does not promise indefinite retention.
