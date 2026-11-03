# Terminal boundary and retained tool evidence

## Current delivery

The shared browser/Desktop session details include **Observed tools**, a read-only
projection of already-loaded Codex tool records. It groups an invocation and return
only when explicit recorded identity is complete and unique. It is useful for
inspecting tool I/O without interleaving other activity. It is **not** an integrated
terminal, a PTY transcript, an execution grant, or proof of a process's current state.
Phases 2–4 terminal acceptance remains incomplete.

The repository uses Node `>=24 <25`, pnpm `10.34.9`, Electron `45.2.1`, React
`^19.3.1`, TypeScript `~6.0.3` and zod `^4.6.7`. The current Codex adapter normalizes
`response_item:function_call`, `custom_tool_call` and their output records into
`agent.tool.started`/`agent.tool.completed`. Both input and output text are retained
in `payload.text`. The output event's compatibility `status: running` is not
process evidence. No shell, PTY or terminal-emulator dependency was added.

## Ownership and capability boundary

| Operation / resource                                                  | External observed session                              | ORQST-owned process                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Read retained Codex tool evidence                                     | Implemented; partial, source-backed history only       | No managed process exists in the runtime                                        |
| Claim PID/PTY/session ownership                                       | Unavailable; session history is not ownership          | Unavailable; no owner registry or launch implementation                         |
| Start, attach, write/paste, resize, interrupt, stop, resume, approval | Unavailable; no adoption or terminal injection         | Unavailable; authorization, lifecycle and provider evidence are not implemented |
| Close details/window or lose connection                               | Ends viewing only; does not touch the external process | No managed lifecycle is exercised                                               |

Observation authentication (the loopback cookie) grants no execution authority.
Renderer code, captured content, tool names, paths and session IDs cannot grant
control. Current capabilities and the read-only Core/Bridge remain unchanged.
There is no new API, WebSocket message, IPC method, durable buffer or migration.

## Decisions required before an interactive terminal can ship

These are unresolved requirements, not a selected implementation or an approval
request to execute something now. The current observer rules prohibit launching
agent processes in the application runtime. A separately approved managed boundary
must resolve the following before code can expose any control:

- **Authorization:** select a Core-authenticated local principal and an explicit
  user action granting particular operations to a particular owned process and
  project. Define expiry, revocation and checks at admission and execution.
  Observation access cannot be reused as a control grant; input, interruption,
  termination, resume and provider approval need distinct reviewed semantics.
- **Executable and arguments:** select and verify a specific supported provider
  version and absolute executable, with argv validation and no shell interpolation.
  Prove the actual start/resume/approval interfaces individually. A generic shell
  accepts arbitrary code; treating it as a provider allowlist would be misleading.
- **Working directory and environment:** define canonical authorized project roots,
  symlink/containment and change-of-path race handling. Native history paths do not
  authorize cwd access. Define a minimal environment and secure credential ownership;
  do not inherit the Bridge service's secrets, renderer-supplied environment or
  arbitrary loader/PATH overrides. Provider sandbox and OS permissions still apply.
- **Input and interruption:** identify a genuinely owned PTY/process instance.
  Define raw user input and paste limits/confirmation (including multiline paste),
  backpressure and request authorization. Distinguish PTY Ctrl+C bytes, signals,
  provider turn cancellation and destructive process termination. None proves the
  others occurred. Never use these mechanisms on a discovered external session.
- **Lifecycle:** assign a fresh process identity per start, independent of PID reuse,
  provider session, turn and terminal attachment. Confirm spawn/error/exit with
  runtime evidence; define process-group cleanup, startup failure and resource bounds.
  Closing a window or detaching must not implicitly kill work. Reconcile crashes,
  reboot, lost ownership and uncertain side effects before retry; never auto-resume
  or adopt external work. Define explicit stop behavior separately.
- **PTY/emulator dependencies and threats:** select versions with compatible
  licenses and test Electron ABI/packaging on supported platforms. Bound buffers,
  transport, resize and reconnect behavior. Terminal escapes, OSC clipboard/link
  actions, title changes, bidi text and hyperlinks are untrusted. Disable active
  actions unless narrowly authorized. A terminal emulator is not a sandbox;
  provider permissions, authentication and process ownership remain required.

The concrete blockers are the missing managed-execution product boundary,
principal/grant design, owned-process lifecycle and validated provider/PTY stack.
No external CLI, provider or process was probed to bypass those blockers. The
independent evidence view requires none of those permissions.

## Projection semantics and limits

- Inspect the last 500 loaded events; validate at runtime and select at most 100
  latest supported tool records for this session. Loading older history reuses the
  existing read API only while the display window has room. Activity remains the
  path to other retained events. This is not a full-history or native-file reader.
- Pair only one start followed by exactly one return with equal machine, adapter,
  session, agent, turn, call ID, source file and function/custom-tool family.
  Both call-ID fields must agree. Missing fields, duplicate/ambiguous calls,
  reversed source/sequence order and returns outside the display window stay
  separate. Known ambiguity anywhere in the inspected window blocks pairing even
  when the conflicting record is outside the 100-record display cap. Workspace labels
  are not process identity. No JSON arguments, nested calls or output prose are
  parsed to invent a command, process, exit code, success or task outcome.
- Display each record's normalized timestamp and retained source file, byte offset,
  line, hash, record type and turn/call references. The source is not reopened or
  reverified. Original retention, redaction, source truncation and missing records
  limit completeness; even an invocation/return pair is not a terminal transcript.
- Show up to 4,000 display characters per body; tool name and provenance fields have
  smaller display limits and truncation labels. Use plain React text without HTML,
  Markdown, links or a terminal parser. Render terminal controls and direction/format
  characters as visible Unicode escapes, preserving ordinary newline/tab. This
  presentation does not modify the
  retained record. Empty text is unavailable rather than proof of empty output.
- Disconnection and refresh failure mark the visible records as historical/stale.
  The view is not an assertion of live process output or process liveness.

## Validation scope

Synthetic unit tests cover adapter normalization, identity pairing, missing and
ambiguous evidence, bounded windows, hostile/control text and source preservation.
A disposable browser fixture covers the real observer-to-view path, hostile output,
updates, localization and offline behavior. No user command, real session, running
service or production data is part of these checks. No managed execution, native
PTY, provider interaction or native Desktop terminal has been accepted.
