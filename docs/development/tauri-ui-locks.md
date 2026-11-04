# Tauri document getters and metadata ownership

This increment fixes a concrete lock/UI wait cycle in source. It does **not** establish
that this cycle caused the previously reported hang. The affected historical process
had exited before the available sample, which belongs to a successor process.

Baseline: published `19f68b4c6c66368f636ea047ebe8da5918ec73aa`; app source
`b78342fed677ea34f449b042bced6f0bf0fea20d`. Their difference contains documentation
only. This source change does not replace the installed/open Preview app.

## Mechanism and boundaries

The local Cargo lock and cached crate sources identify Tauri **2.12.5** and
runtime-wry **2.12.3**, both published from
`993038c49185307dfc895ab7657d77ca0d5ed7c7` (`.cargo_vcs_info.json`).

- [Tauri `Webview::url`](https://github.com/tauri-apps/tauri/blob/993038c49185307dfc895ab7657d77ca0d5ed7c7/crates/tauri/src/webview/mod.rs)
  delegates to the runtime dispatcher. `window()` clones a cached Window under its
  own mutex; the patch also obtains that parent before locking application state.
- [runtime-wry `getter!`, `webview_getter!`, `Context::send_user_message`, `url`](https://github.com/tauri-apps/tauri/blob/993038c49185307dfc895ab7657d77ca0d5ed7c7/crates/tauri-runtime-wry/src/lib.rs)
  send a UI message and use synchronous `rx.recv()` without a timeout. On the main
  thread the message is handled directly; on another thread it is queued through
  the event-loop proxy. Therefore this is not a claim that every getter deadlocks.
- [Tauri async runtime](https://github.com/tauri-apps/tauri/blob/993038c49185307dfc895ab7657d77ca0d5ed7c7/crates/tauri/src/async_runtime.rs)
  uses Tokio by default. Preparation enters `spawn_blocking`; the host reader uses
  `tauri::async_runtime::spawn`. AppKit observers run on the native UI thread.
- Before this patch, `terminal_creation::identity` held Preparation while calling
  that getter; `features::identity` similarly held Features. The asynchronous host
  reader additionally held Terminals through `features::document_current`.
  AppKit `terminal_focus::{key_changed,deactivated}` and window/page callbacks
  acquire these states for invalidation. A worker waiting for UI while retaining
  state needed by a UI callback can form a cycle.

The two identity paths now copy origin and generation/document under their mutex,
release it for the URL getter, reacquire it and reject changed versions/origins or
an invalid source. No saved snapshot grants authority after invalidation.

The feature-reply path snapshots the exact pending request, releases Terminals for
`document_current`, then reacquires it. It requires the original host stream's
Core epoch, current layout generation, source, document, schema/correlation check
and the same `Arc` request instance before consuming the reply. A getter-free
Features document-version check fences the gap between its invalidation and the
subsequent Terminals invalidation. That final order is **Terminals → Features**;
`features::invalidate` explicitly releases Features before taking Terminals.
Neither the URL getter nor native parent lookup occurs under this nested order.

Metadata dispatch and post-await cleanup also check the original epoch and document
version. The final Features return/publication checks its atomic epoch/generation
context after the URL getter, including each publication target, so an invalidation
during that getter cannot escape a context check performed only before the wait. Completion is epoch-bound as well as request-ID-bound, so an old command
cannot release a new Core's latch. Request IDs remain process-lifetime monotonic
Features IDs; the in-flight reply's Arc token also rejects replacement under an
otherwise identical key. These are internal lifetimes, not new wire fields.

The other URL/focus/size getters in these three files were inspected at their call
sites: menu lookups end their guards before getters, run's current-document predicate
gets URL before acquiring Preparation, terminal slot/focus sampling finishes its
state read before native calls, and resize/layout getters precede state reads.
This is a bounded review, not an audit of every Tauri module. No changes were made
to run/execute/startup errors or admission/preflight owned by the parallel increment.

## Reference research and reuse decision

The owner-supplied `tucano-vs-anywh-integracao-cli.md` was read as untrusted reference
material; none of its content was executed. Delivered handoffs `h-12x` and `h-12w`
were reviewed. The source-backed lock mechanism above is independent of the
historical incident's uncertain effects and preserved reservation.

| Pinned candidate and exact symbols                                                                                                                                                                                                                             | Dependencies / difference                                                                                                                                                                                                                                                                        | Decision                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [Anywh `TailnetSidecars`, `tailnet_sidecar_start`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs)                                                                                    | Tokio async mutex, Tauri shell, serde; serializes profile start/join and retains its async guard over sidecar readiness. It does not provide ORQST document epochs, signed ownership or AppKit invalidation. Architecture, Agent Host and runtime-contract docs at this pin were also consulted. | Keep the existing ORQST native/Core composition and narrowly correct its locks. Importing this manager would not resolve the UI getter cycle. |
| [Anywh Claude `def.exec.kind`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/claude/def.ts)                                                                                                          | Ordinary driver is `spawnPerTurn`; persistent Agent Host and integrated PTY are separate modes. The original Markdown's general long-lived-process description is too broad.                                                                                                                     | No driver/runtime replacement for a document-lock fix.                                                                                        |
| [Tucano `claudeArgs`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/claude.ts) and [`codexArgs`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/codex.ts) | Node filesystem/path, existing `runCli`, streaming parsers, provider configuration and isolated headless turns; not a Tauri document/lifetime mechanism.                                                                                                                                         | Do not use for this fix. Preserve the existing Core/PTY and native authority.                                                                 |

Both exact upstream root LICENSE blobs are Apache-2.0, SHA-256
`cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`;
recursive trees contain no NOTICE. Selected source headers were inspected. Cached
runtime-wry declares `Apache-2.0 OR MIT`. No third-party source/assets/dependencies
are incorporated by this increment; existing LICENSE/NOTICE stay intact. Overclock
is a UX reference, with no source/license presumed or copied.

## Security review and checklist fragment

- [x] UI getter waits occur without Preparation, Features or Terminals retained in
      the changed identity/reply paths; versions are checked after waiting.
- [x] Stale source/document/generation, a replacement pending request, another Core
      and a late completion cannot authorize that reply or release another owner.
- [x] No renderer field, IPC envelope, native grant, CSP, focus policy, AppKit hook,
      stop/quit behavior or Core implementation is changed.
- [x] Existing uncertain files, reservations, runtime and quarantines remain untouched.
- [ ] Full native crate typecheck/test and machine/native UI acceptance remain pending.
      The pure harness and Node checks do not prove native WebKit/provider behavior
      or identify the cause of the historical hang.

## Verification

Use existing Node 24 / pnpm 10 and an existing Rust toolchain:

```sh
RUSTC=/path/to/existing/rustc node scripts/test-tauri-ui-locks.mjs
pnpm lint
pnpm typecheck
pnpm exec tsx --test tests/tauri-studio.test.ts tests/feature-view.test.ts tests/tauri-terminal-layout.test.ts
rustfmt --edition 2021 --check apps/tauri/src-tauri/src/terminal_creation.rs apps/tauri/src-tauri/src/features.rs apps/tauri/src-tauri/src/terminal.rs tests/native/tauri-ui-locks.rs tests/native/tauri-metadata-locks.rs
git diff --check
```

The standalone script compiles actual production State definitions, identity helpers,
pending-request definition, reply/cleanup functions with `rustc --test -D warnings`.
Only unused fixture fields permit dead-code warnings. It substitutes minimal
Tauri/Tokio/transport types and an allowlisted matcher: it does not compile or validate
the full Tauri crate, real dispatcher, Tokio transport or Rust JSON schema validators.
There is no production testing framework, additional runtime or dependency. Temporary
harness source/binary are removed on exit.

Five deterministic Rust tests passed. Controlled getter channels hold the worker
while the simulated UI callback acquires the actual production mutex. Cases cover
unchanged identity, generation/document invalidation, changed origin/source, getter
failure, main/chrome versions, replacement request identity, new Core, stale document
version before Terminals invalidation and late completion/latch ownership.
The 28 existing focused Node tests, full lint and full TypeScript typecheck passed.
Initial worktree typecheck lacked package-local links to existing dependencies; it
passed after adding temporary links to those existing trees, without installation.

No Cargo, build, staging, installation, dependency update, target creation, application,
provider, CLI, Core, PTY, probe, authentication database or GUI was run. Full `pnpm test`,
`pnpm build`, real-source acceptance and packaging were deliberately not run under
this task's constraints. Available space was 25 GiB before and after these light checks.

## Combined source integration — 2026-11-04

Integrated as `029eae6`, followed by admission/startup source `5e2b034`. Both sets
of reader identities and post-wait protections are retained. The combined run
passed 187 synthetic Node and 8 pure Rust cases plus source checks, with no product
build or real native/provider acceptance. See the
[integration review and actual test scope](tauri-opening-source-integration.md).
