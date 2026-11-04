# Local diagnostic sink source review — 2026-11-04

Baseline `5e2b03454f336d0d7417ffa2565a3b25262226f8`, the frozen combined
mutex/UI and admission/startup corrections. Isolated branch
`fix/local-diagnostics-739`; main and running apps are outside this change.
Current sources are the primary contract: `apps/tauri/src-tauri/src/main.rs`,
`sidecar.rs`, `terminal_creation.rs::execute/run`,
`terminal.rs::start_selected_with_open/enroll_selected`,
`apps/bridge/src/desktop-sidecar.ts`, and
`apps/desktop/src/diagnostic-output.ts`. Native helper/terminal stderr is drained
without persistence; setup uses bounded generic refusal text. The existing
Electron module only prevents write-EPIPE on optional stdout/stderr from killing
the app. Launchd's separate observer service writes stdout/stderr files, but it
does not cover the native Preview's helper/admission stages. Preserve all three
boundaries and add a separate native-only optional diagnostic sink.

## Pinned candidates and decisions

Required Anywh `docs/architecture.md`, `docs/agent-host.md` and
`relay/src/runtimes/README.md` were consulted in the existing separate checkout at
`546f189c04415c3c5af5f40e3931a0a90b9aba31`, then the actual components below.
The actual `append/rotate` source and sidecar stderr branches were re-read, and
both checkout origins were verified. Tucano `codexParser` and `routerPrompt`
were re-read at `0501956d127699300209902e889f3e69a0948766`.

- [Anywh `AgentEventLog.append/rotate`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/eventLog.ts):
  Node filesystem/crypto plus its `BufferLineSplitter`; bounded segments/retention
  and record limits, synchronous append before subscriber delivery. This is an
  authoritative replay log of CLI events with offsets/seq/incarnation. **Do not
  reuse** as an optional diagnostic sink: arbitrary CLI events contain content,
  synchronous writes affect operations and failures can fail the hosted agent.
  Keep ORQST's Core/PTY/SQLite authority; diagnostic events cannot become replay,
  recovery or session evidence. Only the general size-bounding approach is relevant.
- [Anywh `tailnet_sidecar_start/log_sidecar`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs):
  Tauri, shell plugin, serde, tokio and desktop process lifecycle. `log_sidecar`
  prints raw lines/profile IDs to stderr, and identity failures may expose raw
  stderr. **Keep existing ORQST integration** and add closed events: raw stderr,
  profile IDs and paths are incompatible with the requested privacy contract.
  Its separate process/job handling does not belong in a diagnostic writer.
- [Tucano `codexParser().end`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/codex.ts):
  child-stream parsing helpers (`cli.ts`), `EngineEvent` and localization; the
  engine also imports filesystem/OS/TOML/native configuration. It appends bounded
  raw stderr text to a user-facing error when a turn ends without a reply.
  **Do not use**: truncation does not remove content/secrets and a turn result is
  not native preparation, admission or proof of cleanup. Do not transplant a
  process engine to obtain logs.

Tucano's [router](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts)
chooses speakers from channel content and grant descriptions; it is not an
allowlisted diagnostic boundary. Keep ORQST's explicit routing/authority and do
not use its content-oriented channel records for diagnostic correlation.

The exact root LICENSE files were read and both declare Apache-2.0. At these
pins `git ls-files '*NOTICE*'` returned no paths in either checkout; source file
headers and imports were inspected. The candidate components use their native
Node/Tauri ecosystems and are excluded, so no transitive dependency or bundled
notice is incorporated. No upstream source/assets were copied and no dependency
was added; root NOTICE retains its existing attribution.

Overclock remains a UX reference, not a located source/licensing grant. This
change has no pane layout/focus/navigation redesign or Overclock asset reuse.

## Resulting contract

`local_diagnostics.rs` uses Rust standard library only. A bounded in-process
queue feeds one disk-writer thread; it is not another app/agent runtime. Fixed
events, opaque per-attempt correlation and small numeric timestamps/counters are
the only record fields. Log failure is independent of preparation/ownership/
execution outcome and never removes uncertainty or authorizes retry. macOS/Linux
files use restrictive modes and final-component no-follow checks, with an OS
writer lock. Other platforms are disabled pending equivalent controls.

Candidate writer `7c2d38c` and documentation `7957d9a` from the abandoned worker
were inspected as unvalidated source, not integrated as prior delivery. The
writer is adapted to closed stage/outcome/effects, record budgets, nonblocking
special-file refusal and directory/file owner checks; tests are run afresh.
No old equivalent commit is cherry-picked. A separate hook increment sits above
the combined freeze without re-resolving its conflict. Existing native
`startup-N` correlation remains private and unchanged: the Rust caller binds its
validated reply to the independent diagnostic attempt. No diagnostic fields or
frames are added to the helper/host protocol. Source tests do not
prove native receipt, provider readiness, UI responsiveness or the historical
cause. No active app, reservation, source session, runtime, credentials or provider
was operated. See [retention, consultation and limits](../development/local-diagnostics.md).
