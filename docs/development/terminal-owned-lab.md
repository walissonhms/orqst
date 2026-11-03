# Owned terminal engineering library

The experimental modules in `packages/core/src/terminal/` implement authorization,
handle ownership and bounded I/O for a future managed terminal. They are **not
exported by the Core package entry point or composed into ObserverCore, Bridge or
normal Desktop startup**. That runtime has no terminal execution endpoint, IPC
handler, native dialog, renderer control, provider adapter or persistent execution
record. The later [native acceptance lab](terminal-native-acceptance.md) composes a
separate disposable application only.
The existing observer and observed sessions remain read-only.

The only native backend is a fixed disposable Node fixture in the explicit
[synthetic acceptance command](terminal-pty-acceptance.md). Automatic tests use
in-memory doubles and never launch a process. No provider or generic shell is enabled.

## Implemented authorization boundary

`TerminalAuthority` accepts at most eight Ed25519 public keys from trusted
composition. Keys are copied into a private in-memory registry; a renderer, read
cookie or claimed click cannot enroll a key. Revocation removes the client and its
pending challenges. There is no persistent enrollment, key store or signing service.

A Core-generated challenge binds a domain/version, random boot epoch, client,
random challenge ID, 30-second monotonic expiry, operation, exact target and SHA-256
digest. Signing uses `terminalChallengeBytes`, an ordered array of those fields.
`consume` checks the registered public key, exact binding, signature, expiry and
one-use challenge before an effect. Another epoch, action, instance, changed
manifest, fake click, revoked key or replay cannot authorize it. Pending challenges
are limited to 128; expired entries are pruned on preparation.

The launch digest covers the frozen registered profile and fixed library policy.
The profile identifies the executable path/hash/version, argv, project/cwd,
environment profile and permissions. Only registered profile IDs can be selected;
there is no command-string/environment override API. The trusted backend validates
the profile at preparation and again before consuming the start grant and spawning.
Validation must be side-effect-free inspection: it cannot launch or modify a process
and runs before authorization is consumed. The library does not itself prove
filesystem identity, sandbox enforcement or the truth of a supplied profile.
The synthetic backend checks the executable and fixed
fixture hashes; hash/check/path-based spawn still has a replacement race and is
not a production immutable-executable admission mechanism.

The fixture's ephemeral private key signs only inside the deliberately invoked
test. **A test signature is not evidence of a native user gesture.** Production
still needs independently enrolled native credentials, native confirmation of the
exact action, sender/document/focus validation, secure storage/revocation and a
separate restricted terminal document. The subsequent experimental broker implements
exact confirmation and sender/lifecycle helpers as described below; production
composition and enrollment remain absent.

## Process and attachment behavior

Each preparation allocates a fresh random attempt/instance ID, separate from PID,
provider session and observed event IDs. Preparation has no process side effect.
Launch reserves at most two instances and one per project synchronously, consumes
authority and calls only the configured backend. The backend owns the handle and
must provide explicit startup and exit evidence. The synthetic fixture's known
readiness instrumentation is not a parser for arbitrary provider output.

States are `prepared`, `starting`, `running`, `exited`, `start_failed` and
`ownership_lost`, independent of v1 session statuses. Profile revalidation failure
proves a pre-spawn failure. A thrown spawn, missing startup evidence after ten
seconds, malformed backend evidence, oversized backend event or uncertain write
loses ownership. It revokes input and disposes listeners without signaling, retrying,
looking up a PID or claiming exit. Uncertain instances retain admission slots.
An explicit owned exit event while `starting` or `running` supplies exit code/signal
and frees capacity. After `ownership_lost`, late startup/exit events are discarded;
the slot remains held for the lifetime of that supervisor instance. No reconciliation
or release of uncertain capacity is implemented.

An independently signed attach action creates one read attachment. Detach removes
it and its lease without killing work. Revoked clients cannot read or write; an
authorized other client can replace their unusable attachment. Input requires a
separate signed lease lasting at most two minutes, its random lease ID, the exact
attachment and the next sequence number on every write. A new lease never accepts
an old lease ID. Blur/navigation/transport loss must call `revokeInput` through the
future trusted broker; that operation also invalidates pending input challenges.
The subsequent Electron lifecycle helper can wire native revocation, but no
application or transport installs it.

Typed input permits 4 KiB per write. Paste requires a separate one-use signature
bound to the exact UTF-8 text, sequence, lease and attachment, up to 16 KiB; text is
not stored in the challenge. Both share a 16 KiB per one-second window budget per
instance, preserved across detach/reattach. The trusted future client must classify
keyboard versus paste and prevent clipboard/emulator automation; a compromised
renderer with an active lease can still misuse typed input. There is no offline
queue. Sequence and budget are consumed before a backend write, including uncertain
failures. Revocation cannot undo already accepted bytes.

Resize needs the read attachment, 20–300 columns and 5–100 rows, at most ten calls
per second per instance. Excess calls are rejected rather than queued/coalesced.
Ctrl+C is ordinary authorized input. `SIGTERM` and `SIGKILL` each require a separate
exact-instance/explicit-signal signature. Sending a signal does not mean the process
exited; no automatic escalation, group cleanup, provider cancellation or approval
response is implemented.

## Bounded output and lifetime limits

The backend is drained into an inert 1 MiB byte ring per instance. Reads return a
defensive copy of at most 64 KiB, an absolute byte cursor and an explicit eviction
gap. They may split UTF-8 characters; a future client needs a streaming decoder and
must reset it on a gap. There is no escape interpretation, terminal query response,
clipboard, hyperlink, title action, transcript file or push transport queue. A gap
must not be replayed as a complete terminal screen. The chosen pull model avoids
an unbounded client backlog; future IPC/network backpressure still needs review.
The original mechanics probe separately exercises native PTY pause/resume.

At most 128 attempt records are retained for the lifetime of each supervisor instance,
including expired preparations, exits and lost ownership; records are never removed
and admission fails at that cap. The admission and memory limits are per instance,
not shared across supervisors. Replacing a supervisor cannot establish that its
previous processes exited and is not a safe recovery mechanism. The maximum ring
storage within one instance is 128 MiB, plus bounded event/read copies and metadata.
A backend event larger than 64 Ki code units
fails closed; the library does not impose a native CPU/memory/output-rate sandbox.
There is no attempt erasure, persistent journal, crash reconciliation, grant extension,
lifetime stop timer, proven process-survival shutdown policy or process-tree
containment. Explicit library teardown now conservatively marks live work
ownership_lost without signaling; see below.
Destroying a library object is not proven process exit or recovery. These gaps
prevent production composition; the app cannot safely infer/relaunch surviving work.

## Provider evidence and next integration gate

| Candidate                    | Proven here                                                                               | Missing before enabling                                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixed synthetic Node fixture | macOS/arm64 Node 24 native PTY plus signed library start/input/resize/paste/stop and exit | Deliberately not a provider or production profile                                                                                           |
| Codex TUI                    | Existing external-session observation only; no managed TUI trial in this change           | Pinned executable, immutable admission, disposable authorized authentication, sandbox/permissions, readiness, interrupt and resume evidence |
| Codex structured transport   | Existing observer records do not establish an owned control channel                       | Separate provider/version protocol and operation-specific authorization/acceptance; cannot be presented as a terminal transcript            |
| Claude Code / OpenCode       | Existing contracts only                                                                   | Real adapter and provider-specific validation; no inferred parity                                                                           |
| Generic shell                | Not admitted                                                                              | Separate arbitrary-code execution product decision and containment design                                                                   |

The next useful integration is a reviewed native enrollment/confirmation broker and
isolated local transport, together with a durable metadata journal and explicit
shutdown/recovery policy. Before a provider trial, choose trusted native execution
versus container/VM isolation and obtain explicit disposable-provider authorization.
Do not enable UI controls from library test results alone. See the
[managed terminal design](../architecture/managed-terminal-design.md).

## Native broker increment — 2026-11-03

The [native-client contract](../api/terminal-native.md) now has a strict request
schema, one-request-at-a-time broker, native confirmation helper and exact
sender/document-generation/focus validation. Keys, proofs and lease identities stay
inside trusted composition. Native blur/navigation/loss revokes input/pending
confirmation; close detaches without stop. Explicit supervisor shutdown rejects new
starts/attachments and retains live processes as ownership_lost without signaling.

The explicit lab now makes four sequential fixed synthetic starts: two mechanics,
one direct supervisor and one broker-driven start. The last two reuse their private
lab directory sequentially, with no provider configuration or credentials. Native
confirmation is deliberately simulated there; the real Electron dialog, document,
focus/accessibility behavior and independent IPC enrollment/transport remain pending.
There is still no application terminal or provider control to enable.

## Native transport integration lab — 2026-11-03

The [explicit native acceptance application](terminal-native-acceptance.md) now
composes the library with a dedicated Electron document/preload/IPC and a separate
Node-host PTY for the fixed synthetic fixture. Normal application startup is
unchanged. The additional `TerminalEvents.lost()` reports transport uncertainty,
without claiming exit or authorizing retry. Real Electron transport is exercised
with intercepted native dialogs; provider/human-consent/recovery gates remain.
