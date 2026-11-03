# Managed terminal: proposed execution boundary

Current update: the owner-authorized [embedded native Terminal](../development/managed-codex-terminal.md)
selects a trusted/same-user contract and composes the library behind a private Node
Core. It supersedes the blanket immutable-binding/container gate in this historical
engineering note; it does not claim hard isolation or real-provider acceptance.

Implementation update (2026-11-03): the optional
[metadata journal and epoch recovery](../development/terminal-recovery.md) now
implement conservative persistence/admission in the experimental library. The
remaining production/provider gates in this design still apply; normal runtime
and the native lab do not open that journal.

This is an engineering design, not an implemented control contract or permission
to execute a provider. The current runtime remains an observer. The independent
[synthetic PTY acceptance](../development/terminal-pty-acceptance.md) validates a
small part of the mechanics without adding application execution authority.

The subsequent [owned terminal engineering library](../development/terminal-owned-lab.md)
implements in-memory signed operation grants, owned-handle lifecycle and bounded
I/O, exercised through that opt-in fixture. It is not composed into the application;
native gesture/enrollment, transport, persistence/recovery and provider gates below
remain proposals. The budgets below describe the target design, not a claim that
the experimental library enforces every one of them.

## Why retained history cannot become an interactive terminal

Codex JSONL gives source-backed observations, not a process handle, PTY endpoint,
authenticated input channel or current PID ownership. Tool completion is not
process exit. A source path, call ID or provider session ID cannot authorize
attachment, input, cancellation or resume. External sessions therefore remain
permanently observation-only in this design: no adoption, process lookup, terminal
injection, credential reuse or source-file writes.

The browser observation cookie is available to the dashboard and grants reads. It
must never become an execution credential. Likewise, a renderer's claim of a click,
focus or session identity is not proof of a native user authorization.

## Selected direction and alternatives

Extend the existing long-lived Core with a separately reviewed managed-process
component only when the execution gates below pass. Keep the Bridge composition
root, one SQLite writer and existing observer. Core owns admitted process handles
and PTYs; Electron main brokers native confirmations and a dedicated terminal
client. Closing the window detaches its view; it does not terminate the process.
Do not put native PTY code into the renderer or tie work to Electron's lifetime.

The first provider candidate is a new, explicitly launched Codex instance with a
version-pinned executable and proven sandbox configuration. A TUI PTY preserves
the provider's own interface; it does not provide structured approvals, turn
cancellation or trustworthy usage events. Those operations stay unavailable until
individually proven. A structured provider transport is an alternative for later
approval/turn semantics, but must not be described as a terminal transcript. A
generic shell is a separate arbitrary-code execution product decision, not a
substitute for provider validation. No provider is launched by this increment.

For native macOS processes, admission counts and bounded I/O are enforceable here;
a process group is only a cleanup mechanism, not containment of hostile descendants.
Native launch would require provider sandbox evidence and an explicit statement
that OS user privileges remain available. If hard descendant/CPU/memory isolation
is required, use a separately validated container/VM supervisor with resource limits
instead. That option changes filesystem mounts, authentication, packaging and UX.
Neither a PTY nor a project working directory supplies such a sandbox. Until that
is resolved and tested, this design does not enable production launch.

## Authorization by a concrete gesture

Proposed Desktop-only first transport; browser control remains absent:

1. Core prepares a short-lived immutable launch manifest: canonical project root,
   executable identity/version/hash, fixed argv profile, environment profile,
   sandbox/network policy, limits and a random attempt ID. No renderer-supplied
   command string, environment, credential path or source-history path is accepted.
2. Electron main fetches that manifest through a separately enrolled local client
   credential and displays a native confirmation with the actual executable,
   directory, permissions, limits and the action. Cancel grants nothing. A web page
   cannot confirm the dialog. Preparing a manifest does not start a process.
3. Main signs the exact manifest digest, operation, attempt, Core boot epoch,
   client identity and a one-use nonce. Core verifies its enrolled client key,
   expiry (proposed 30 seconds), current policy and unused nonce at admission and
   immediately before spawn. Consume before any side effect. A timeout is an
   uncertain result to query by attempt ID, never a reason to retry a launch.
4. The first implementation must validate credential enrollment/revocation and
   native sender/document checks. Keep the client secret outside preload/renderer
   and the read API, with owner-only local storage and no logs. Same-user malware
   or a compromised native client is outside this trust boundary; it is not a
   multi-user security boundary. No enrollment or signing API exists yet.

Canonicalize and verify project/executable identity while preparing and again at
execution. Plain `realpath` followed by path-based `spawn` still has a replacement
race. The native supervisor must prove directory/executable binding (or enforce an
equivalent immutable authorized location); `node-pty`'s path options alone do not
close that gap. Deny launch if identity, sandbox or credential provisioning changes.

An input lease is a separate native-confirmed action for an exact live instance
and attachment, proposed at two minutes maximum. Expiry, native focus loss,
navigation, reconnect, revocation or a Core epoch change stops input authorization;
reattachment requires a new gesture. Never buffer input while disconnected.
Validate lease/sequence/size on every write. Pasting is a distinct gesture: show
multiline text and confirm it natively; never forward clipboard reads or emulator
responses automatically. A compromised renderer could abuse an active lease, so
keep the terminal in a separate restricted document with no captured HTML or
third-party scripts. Focus alone cannot create or renew a grant.

Resize is scoped to a read attachment and bounded dimensions. Ctrl+C sends a byte
only within an input lease; it is not a claim of cancellation. Sending a signal,
stopping a process group, resuming native history and answering provider approvals
are distinct scopes. Native stop confirmation identifies the exact instance and
possible descendant effects. Do not map any of these actions onto observed v1
session statuses or pretend that revocation undoes input already accepted.

## Initial budgets to validate before enabling runtime controls

These are proposed conservative limits, not implemented controls:

| Resource                 | Initial policy                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Starts                   | One active owned instance per project; two per Core; reserve slots atomically                                                 |
| Spawn                    | Ten-second startup evidence deadline; failure remains distinct from unknown outcome                                           |
| Lifetime                 | Thirty minutes per grant; explicit extension; no automatic restart/resume                                                     |
| Input                    | 4 KiB per write, 16 KiB/s per instance, no offline queue                                                                      |
| Paste                    | 16 KiB maximum; multiline native confirmation; no automatic clipboard action                                                  |
| Resize                   | 20–300 columns, 5–100 rows, coalesced at most ten times/second                                                                |
| Output                   | 256 KiB unacknowledged per attachment; pause at high watermark, resume after acknowledged consumption                         |
| Replay                   | 1 MiB memory ring per instance; explicit gap on eviction; no transcript disk cache                                            |
| Slow/disconnected client | Detach it; bounded ring continues draining; no unbounded transport queues                                                     |
| Stop                     | Signal through the live owner handle/group; wait for exit evidence; bounded escalation only after separate stop authorization |

OS-level descendant counts, memory/CPU limits and process-tree cleanup still require
the chosen supervisor evidence. Do not advertise the admission count as an OS
process limit. Output gaps cannot be safely replayed into arbitrary terminal state:
show a reset/gap indication and obtain a fresh provider redraw if supported, otherwise
use an inert bounded text view. Disable OSC clipboard, automatic links/navigation,
title-driven actions and automatic query responses; validate an emulator version
and threat policy before interpreting any output.

## Identity, lifecycle and local persistence

Assign a random instance ID at each launch, separate from PID, provider thread,
turn, observed session and terminal attachment. Keep its live handle only in its
owning Core epoch. States are `prepared`, `starting`, `running`, `exited`,
`start_failed` and `ownership_lost`; they are not v1 agent statuses. Running needs
spawn evidence; exited needs the owner's exit event/code/signal. Silence, a closed
client or a provider completion message is insufficient.

Before a side effect, persist a minimal attempt record through the existing writer;
append confirmed spawn/exit facts afterward. Proposed records contain instance,
attempt, policy/manifest digest, project reference, client/epoch, timestamps and
exit metadata only. Never persist input, prompts, terminal output, environment
values, credentials or capabilities. Use owner-only directories/files and a proposed
30-day/10,000-attempt metadata retention bound. Prune only terminal reconciled records;
if unresolved ownership prevents safe pruning at the cap, reject new starts instead
of deleting uncertainty. Do not write a migration before this contract is reviewed.
The native provider history remains authoritative and needs separately provisioned
managed storage; external histories and credentials are never imported for execution.
This persistence protocol and its retention policy are proposals, not implemented behavior.

On Core crash/reboot, invalidate grants and mark nonterminal records
`ownership_lost`. Do not signal a stored PID, adopt an apparent survivor, or
relaunch based on history. Reconcile only with independently proven supervisor
identity; otherwise display uncertainty. A future resume must be a new authorized
instance and proven provider operation, with uncertain side effects disclosed.
Explicit Core shutdown must drain/reject controls and use a documented owned-process
policy; a UI quit cannot silently become that shutdown command.

## Evidence gates and next independent work

The implemented probe proves only macOS/arm64 Node/PTY mechanics for a fixed
synthetic child. It does not prove grants, native UI, runtime isolation, provider
compatibility, process trees, crash recovery or packaging. No new capability is
advertised in any adapter, API, IPC, dashboard or database.

Next independently testable increments are native grant enrollment/expiry/replay
negatives and a synthetic supervisor crash/descendant lab. Before a real provider
trial, choose native trusted execution versus container/VM isolation and provision
disposable provider authentication explicitly. Then validate a pinned provider's
start, sandbox, approval, interrupt and resume separately; a successful start cannot
authorize the other operations. Keep all tests out of automatic CI when they launch
native providers, access credentials or incur cost.

Sources inspected 2026-11-02: the pinned installed `node-pty@1.1.0` manifest,
license, typings and native-loader/helper paths;
[upstream PTY documentation](https://github.com/microsoft/node-pty),
[xterm.js security](https://xtermjs.org/docs/guides/security/) and
[flow control](https://xtermjs.org/docs/guides/flowcontrol/). The Node host choice,
grant protocol and budgets above are ORQST design proposals, not upstream guarantees.

## Native broker increment — 2026-11-03

The [experimental native-client contract](../api/terminal-native.md) is now implemented
for the explicit lab: strict requests, exact per-operation confirmation, private
proofs/leases, document/focus revalidation, lifecycle revocation and conservative
supervisor shutdown. Electron helpers exist but are not registered in the runtime.
The broker is tested with doubles and the fixed synthetic PTY, not a genuine native
gesture or real provider. Production enrollment, isolated transport, immutable
admission, lifetime/containment and production recovery gates above remain unresolved.
[Current primary-source provider research](../adapters/managed-terminal-research.md)
does not change adapter capabilities or authorize adopting external sessions.
