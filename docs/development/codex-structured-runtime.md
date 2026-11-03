# Experimental native Codex structured runtime

This is an **opt-in Core library**, separate from the embedded xterm/PTY Terminal.
Normal ObserverCore, Bridge and Desktop startup do not import or construct it. It
has no dashboard control, Electron IPC, MCP server, planner or provider approval UI.
An optional narrow dynamic tool now supports a separately authorized fixed A-to-B-to-A
flow; see [developer acceptance and remaining gates](codex-two-agent-acceptance.md).
It does not inject into an interactive PTY or an externally observed session. The first milestone of two real Codex agents delegating and receiving results
inside ORQST remains incomplete. No real provider inference has been validated for this increment.

## Existing native login extension — 2026-11-03

An optional manifest authentication block supports explicit `reuse-existing` for
this structured runtime only. It retains native HOME/CODEX_HOME, delegates login
loading/refresh to Codex, gates thread creation on `account/read` without forced
refresh and requires a new ephemeral thread. SQLite, logs, temp paths, journal and
process/thread/pane IDs remain per-slot; native auth/config remain shared, including
configured MCP startup. No complete physical isolation is claimed. See
[setup and the shared-state boundary](local-cli-integration.md#structured-codex-reuse).
Legacy manifests and their separate-login path retain the behavior documented below.
No real inference or existing-login acceptance is established by fixture tests.

## Implemented composition

`packages/core/src/managed-codex/runtime.ts` composes the existing signed
`TerminalAuthority`, one private structured host per process, the existing terminal
metadata journal and the [pane communication service](../api/pane-communication.md).
The protocol is Codex app-server JSON lines over private pipes; PTY output and
keyboard input are never used to deliver tasks or interpret acknowledgements.
The existing interactive PTY path is unchanged. Its process cannot be attached,
adopted, resumed, converted to app-server or assigned structured capabilities.

Provision **separate new states** with the existing `terminal:setup` command for
each future configured slot. It never runs the provider or imports credentials.
The version-1 manifest is unchanged; a slot is the digest of its canonical state
path, not a pane ID. Each slot has its own `HOME`, `CODEX_HOME`, temporary directory,
configuration, native history and `terminal.sqlite`. Reuse the existing slot journal
so another live PTY/Core owner of the same state blocks this runtime as well; never
create a parallel journal to bypass ownership. Simultaneous overlapping
state roots are rejected. The same project can have two slots because no managed
home is shared; this native mode only requests read-only work, and does not provide
write-isolated worktrees or authorize parallel writers.

Trusted Node composition supplies:

1. A `TerminalAuthority` enrolled with the native client's public key and an
   independent `PaneCommunication` writer/resolver. Never enroll from HTTP cookies,
   captured messages, CLI text or renderer assertions.
2. An exact-scope result writer. It stores local content under opaque IDs and must
   enforce the complete workspace/actor/source/target/purpose scope. The communication
   resolver verifies bytes, length and SHA-256 before accepting result evidence.
   This runtime provides no generic file/URL resolver and stores no transcript itself.
3. `nativeCodexBackend(absoluteBuiltHostPath)` for the compiled
   `dist/codex-structured-host.cjs`. `pnpm build` produces this inert entry; building
   does not run it. The backend interface also permits explicitly synthetic tests;
   it is a trusted composition seam, never a user-selectable provider fallback.

Call `prepare(clientId, manifestFile, {workspaceId,name,ownerId,model})` to obtain a
new instance UUID, inspectable manifest and expiring start challenge. The manifest
includes project/executable hashes, slot, explicit requested model and lifetime
policy. A real native host must present those details, default to Cancel and sign
`terminalChallengeBytes(challenge)` only following explicit human consent. There is
no consent UI in this library and no implicit permission to execute a real provider.
Then call `launch(instanceId, proof)` exactly once.

The library revalidates the complete config and pinned native binary before
consuming the proof and again at dispatch. It commits the slot's metadata admission
before opening the process channel. The new pane is registered before dispatch
using the existing durable registry; registry/validation/expiry failures before the
backend boundary become start_failed and close that never-dispatched pane. A backend
exception after crossing the boundary remains uncertain, because it may have acted.
The registry alone allocates nonreused `T-NNN` IDs. Each pane binds
one instance/project/terminal epoch; a subsequent start gets a new pane, including
a start using a previously exited slot. Native thread, requested model and reported
model remain separate in `snapshot`. CLI version is owner-supplied manifest metadata,
not an execution probe or compatibility certification. Registry model remains null;
use the runtime's qualified reported-model snapshot instead of presenting a request
as confirmed. Explicit model requests fail closed unless thread/start confirms that
exact identifier. A catalog, account entitlement or successful inference is not
inferred from initialization.

The host starts only the pinned native executable with file credential-store mode
and `app-server --listen stdio://`. It inherits a fixed allowlist environment from
`managedCodexEnvironment`, with no parent API keys, auth socket, loaders or user
configuration. ORQST does not open credential content or import an existing home;
the native Codex process owns any authentication reads. A future real acceptance
requires separately authorized login and provider use of each dedicated home.

## Evidence and authorization

The process journal records `running` only from the host's provider spawn callback.
That does **not** make a pane ready. The adapter waits for successful initialization
and creation of a new native thread. It has no resume/adoption method. Thread start
requests fixed read-only/on-request defaults; no permission response, arbitrary
terminal input, command execution or provider approval method is exposed.

A trusted host separately grants communication with the existing exact actor,
workspace, source, targets and expiry rules. Starting a process does not grant an
agent permission to send tasks. `dispatchNext(targetPaneId)` submits one queued
message through `turn/start` when the adapter is ready; it returns after native
acceptance and never waits for the full task. Busy work remains FIFO in SQLite.
A native readiness callback now attempts one bounded dispatch after a verified turn
ends. The optional facade also invokes dispatch after admission. There is no polling
scheduler or automatic retry; the same durable service enforces claims and grants.

Native turn/start response confirms **accepted** only. Matching turn/started confirms
**running**. Notifications arriving before the response are bounded and buffered
until its exact turn ID is known. Completion needs the matching thread and turn,
prior native start, a successful turn/completed status and bounded authoritative
agentMessage text. This adapter maps one bounded task to one response turn:
completed means that correlated native response is available, not that repository
artifacts, tests or the user's broader goal have been independently validated.
Commentary/deltas are not results. No separate delivered receipt
is fabricated. A provider failure is separate from process exit; interrupted turns,
missing results, mismatched IDs, disconnection or malformed data become unavailable
and communication records uncertainty. Native process exit never proves task success.

Result references flow to the existing post-commit Core subscription and durable
inbox. A separately authorized root turn can now invoke the optional dynamic facade and
receive B's verified result in its pending native tool response. The return is
confirmed by the corresponding native dynamicToolCall completion before root success.
This path has synthetic acceptance only, no MCP or interactive Desktop composition;
the required real agent-to-agent milestone remains pending.

A native permission/input request, except the one granted dynamic delegation tool,
marks waiting for approval where it can be
correlated. The library does not answer it. A future permission UI must be separately
reviewed. A later result without supported resolution evidence fails closed. Native
enrollment revocation, terminal journal fencing and owner shutdown prevent new native
dispatch/evidence; revoking a communication grant separately prevents new client
operations and notifications, while preserving facts of already-dispatched work;
unknown outcomes are never automatically retried.

## Bounds, lifecycle and recovery

- Two active or ownership-lost attempts per runtime owner, 128 prepared/retained
  attempts. The communication registry separately retains at most **128 historical
  panes**, including closed panes, across runtime restarts; there is no pruning,
  retention/reclamation API or safe counter reset. Capacity exhaustion fails a new
  start before backend dispatch. A future registry retention design must preserve
  identity and nonreuse. This is not a machine-wide process/resource service or a
  guarantee across
  independently constructed owners. Slot journals prevent concurrent ownership of
  the same state; communication has its own durable global active-task cap.
- Startup is bounded by 50 seconds overall; thread preparation has a 30-second
  budget, while initialization/account/task-admission RPCs retain 8 seconds.
  Communication's 10-second dispatch/submit timeout remains authoritative. Task
  observation
  expires at its own grant-bounded deadline (at most 15 minutes); expiry revokes
  adapter readiness and marks uncertainty, without asserting provider cancellation.
- Maximum native JSON line 256 KiB, session structured traffic 8 MiB, four outstanding
  RPCs, 32 early notifications, result/request 16 KiB. UTF-8 decoding is strict and
  handles fragmented lines. Stderr is discarded, not persisted as diagnostics.
- The independent Node host retains the start-authorized 30-minute process lifetime
  even after Core disconnect, then sends TERM and after five seconds KILL to its
  owned child handle. This does not contain descendants, CPU/RSS or all network/file
  access. No hard token/dollar ceiling is implemented; token/cost accounting is
  unavailable. Limits must be approved before future autonomous/paid workflows.
- Stop TERM and force-stop KILL require distinct signed signal-bound grants. A stop
  request is not a process exit or task cancellation. There is no stopTask provider
  control; pane canCancel covers only cancellation of undispatched local queue work.
- UI hide/detach is outside this library and must not terminate a process. `shutdown`
  detaches controls and closes journals, preserving active attempts as ownership
  lost. The host's disclosed lifetime remains. No stored PID is signaled, resumed or
  adopted. Process exit is reported only by the exact owned host.
- The existing terminal journal requires a numeric exit code. Signal-only native
  exits have null code: the pane closes on explicit host evidence, while the journal
  conservatively retains ownership-lost capacity. No numeric exit is invented.
- A previous crash/dirty slot journal fails closed (`recover:false`). Graceful
  shutdown still retains lost-ownership reservations. There is no reclamation or
  reconciliation API and no promise to restore control after reboot. Do not reset,
  delete, replace journals or invent a new state to bypass unresolved capacity.
  The journal is an epoch fence, not an OS lock preventing the legacy PTY Core
  from explicitly opening it with recover:true. That recovery revokes this owner
  and reserves its unresolved slot, which blocks another same-project process from
  starting. It must not be used to convert/adopt a structured process or restore
  capacity. Future composition must keep configured states distinct and review
  recovery before enabling production.
  A future reviewed reconciliation path must establish native process and task
  outcomes before releasing slots or retrying side effects.

This is native trusted/same-user execution on non-root macOS arm64/Node 24. Project
cwd is not filesystem containment; Codex can use provider network access and OS
user privileges. Provider configuration/policy can affect effective capabilities.
Pinned hashes/path checks detect drift, not malicious same-user replacement races.
A no-credential native probe confirmed the requested thread shape and permission
response on Codex 0.162.1; real-account sandbox, configuration, authentication,
model access and delegation behavior remain unvalidated. No release readiness is implied.

## Validation and remaining acceptance

`tests/codex-structured-runtime.test.ts` uses clearly labeled synthetic structured
transports and disposable private manifests/journals. It covers two independent
homes/identities, signed grants, busy FIFO, deduplication, native acceptance/start/
completion, automatic Core result subscription, model mismatch, manifest drift,
correlation failures, deadlines, missing acceptance/results, approvals, exits and
conservative recovery. Two IPC cases also fork labeled synthetic Node hosts to check the isolated
transport and host-loss classification. These tests never launch an installed
provider or inspect real credentials/history. The compiled provider-owning native
host is build-checked. One authorized existing-login attempt failed before first
thread readiness and either task submission; its process exit was not confirmed by
the protocol. The actual provider workflow and native human-consent path remain
unvalidated. See [the current acceptance result](codex-two-agent-acceptance.md#current-machine-validation-status--2026-11-03).

Real acceptance still requires specific authorization for the exact native binary,
two new private states, the chosen native-authentication/provider path, requested models and bounded
read-only tasks/cost, then actual A-to-B-to-A verification using the explicit developer command below.
Interactive Desktop/Studio/MCP composition remains a distinct pending step. Until that evidence exists, report **implemented library; synthetic
protocol tests; real-provider milestone pending**. No installed service, source
session, user database or existing Desktop process needs to change for development.

Protocol reference, reviewed 2026-11-03: [official Codex app-server documentation](https://developers.openai.com/codex/app-server/).
Moving documentation is design evidence, not proof of compatibility with the
owner-admitted executable. Validate generated schemas/observed events for that
exact CLI version under separate execution authorization before enabling it.

## Startup diagnosis and IPC backpressure — 2026-11-03

The private native transport treats `child.send()` returning `false` as backpressure:
the write is already queued and is never retried. Only a thrown send, callback error,
disconnection or a 512 KiB pending serialized-message budget denies the transport.
The pending budget includes the IPC envelope and is released by the send callback.
This fixes a synthetic reproducer in which four accepted bounded writes previously
caused false transport loss. It does not establish the cause of the earlier real run.

`snapshot` now includes `launchFailure` (`admission_failed`, `startup_failed`,
`startup_deadline`, or null), `startupPhase` (`not_started`, `initialize`,
`account_read`, `thread_start`, or `ready`) and an optional `channelDiagnostic`.
The diagnostic retains the first fixed reason and at most a fixed RPC method name;
no native error message/code/data, account value, prompt, output or configuration is
retained. The returned diagnostic is a defensive copy. The explicit acceptance
prints these fields for each cleanup attempt. The phase identifies the local await
boundary; it is not proof of provider delivery, authentication or task acceptance.
A null/`detached` channel diagnostic does not establish why a response was rejected.

Initialization, account read and task-admission RPCs retain their 8-second deadline.
Thread preparation has a separate 30-second deadline, and total startup is bounded
by 50 seconds (covering the serial 8 + 8 + 30 second phases plus spawn overhead).
Only the total 50-second startup policy is included in the signed manifest. The
8/30-second per-RPC limits are code constants, not individually bound into that
manifest. Review both the new manifest and the runtime code before a future real
launch; this change is not an extension of an old grant.
Timeout fixtures at initialization, account read and thread start reproduce
`ownership_lost` without signaling or retrying. That conservative state is intentional
when dispatched process ownership/result evidence is unresolved. No diagnostic
restores authority, frees capacity or confirms exit. The earlier real journal's
8.329-second interval is consistent with a request timeout, but the older artifact
contains no phase/reason to distinguish it from other failures. An isolated compiled
host probe with no credentials/inference succeeded and confirmed its own exit;
this does not validate the native user's configuration or account.

A disposable native Codex 0.162.1 probe with empty file-auth home and no inference
reproduced `thread/start` timing out at 8.216 seconds when a synthetic **required**
MCP delayed initialization for 9 seconds within its own 15-second startup timeout.
With the separate thread budget, the same controlled scenario completed thread
preparation in 9.284 seconds; the native host reported exit code 0 through owned
IPC and the synthetic MCP recorded its own exit. An optional slow MCP did not
block thread creation in that probe. These are compatibility fixtures, not the
user's configuration/account or proof of the historical cause. No timeout, model,
MCP requirement or account policy is silently disabled to obtain readiness.

This follow-up passed lint, typecheck, 399 Node tests and full build on
Node 24.22.2/pnpm 10.34.9. The only native probes used new empty file-auth homes
and no inference. The real acceptance was not repeated, the old uncertain state
was not reused/removed, and no user process/service was signaled or restarted.
