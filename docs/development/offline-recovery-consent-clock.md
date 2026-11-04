# Offline recovery intention and approval clock

The native acceptance run exposed **pre-approval expiry**: complete scrollable
review exceeded the old 30-second challenge deadline and Back returned a blocked,
unconfirmed result before Approve. Anchor installation had succeeded separately.
No capture approval or release was observed; the original reservation marker was
verified unchanged. Private inspection files remained in an incomplete bundle.
This is neither a rollback receipt nor evidence that retry is safe. No private
paths, identities, proofs, captured files or keys belong in this document.

This source correction does not operate on that installation or partial bundle.
Cargo, application builds, packaging and renewed native acceptance are separate
coordinated work. No Core, PTY, provider, reboot or release is authorized here.

## Two moments, one bounded consent

1. Core freezes a strict `AdministrativeRecoveryIntent` and complete review bytes
   before any await. The intention contains domain, version, operation ID, phase,
   owner, epoch, before/current kernel boots, original/current snapshot digests,
   directory and bundle. Complete review adds action, transaction, raw snapshot
   digest, every source identity/hash, metadata, membership and journal facts.
   It contains no new proof nonce or expiry. The displayed fingerprint is SHA-256
   of `[administrativeIntentBytes(intent), fullReview]`; the first item is the
   serialized fixed tuple `["orqst.administrative-recovery-intent",1,domain,version,
operationId,phase,owner,epoch,beforeBoot,currentBoot,snapshotDigest,currentDigest,
directory,bundle]`. Review bytes participate exactly, including whitespace.
2. Details and Back remain pre-consent. Only explicit Approve in the observed
   native summary records a native clock sample in AppKit's delegate **before**
   `stopModal`, thread wakeup, pipe ACK or fresh challenge creation. Core then
   creates one version-2 challenge with fresh nonce/expiry and signed
   `intentDigest`. Native checks the complete semantic projection against the
   original consent. It permits one signature, followed only by checks of that
   exact challenge. A check never renews consent. Cancel does not create a proof.

The strict native private wire is version 2; the ready handshake rejects mixed
old/new helpers. Review ACKs bind session/review ID/review nonce/digest. Each
`authorize` request, including every final check, has a **fresh request nonce** and
proof digest binding the review, complete binding, exact serialized challenge and
check flag. Its ACK must echo all correlation fields exactly. A replay, stale ACK,
unknown field, wrong challenge, absent consent, budget failure or EOF denies. No
renderer, public API, capture-supplied key or automatic proof refresh is added.

## Clock transfer and commit

macOS `Instant` uses uptime and may exclude sleep. The same delegate therefore
also samples the SDK's `mach_continuous_time`, which includes sleep, using the
checked `mach_timebase_info` ratio. The native grant is bounded by **both** clocks
from the original click, never by the time a waiting worker returns. Failures,
backward samples, changed/zero ratios and exhausted time deny. Computation uses
checked `u128`: subtract scaled elapsed ticks from the scaled 30-second budget,
then floor the remaining milliseconds. Sub-millisecond remainder grants zero;
there is no rounded-up credit or wall-clock fallback.

The helper records `sentAt` using its own monotonic clock **before** sending each
authorization/check. Native samples the original deadline's remainder **after**
validating the frame, exact intent/challenge, source, generation and focus. Core
carries `effectiveDeadline = min(challenge.expiresAt, priorEffectiveDeadline,
helperSentAt + nativeRemainingMs)` through effects. It never adds remaining time
to ACK receipt time. Request/response latency therefore reduces usable time.
The signed expiry is a service ceiling; it alone cannot extend native consent.
The absolute helper session deadline is included in that minimum, so consent near
second 299 cannot permit a later effect after second 300 even if a synchronous
fsync delays the host timer.

After awaited native checks, Core checks the original files, kernel boot and
controls again. It checks finite expiry before capture publication/gate, archive
and receipts, abort control removal, and final commit. Finalization awaits another
check **after** durable preparation, then rechecks exact source and retained lease
identity/deadline immediately before the original marker rename. A delay in
signing, anchor validation, boot reads or fsync consumes the same short window.
An already committed rename is not undone by expiry: truthful observation remains
possible, while expired cleanup leaves old controls preserved. Future-owner
markers, journals and enrollments are never touched by old cleanup.

A dropped pipe or native context change denies at the next awaited check. This is
an owned-process lease, not an atomic cross-process cancellation primitive:
EOF/focus notifications cannot interrupt a synchronous helper syscall that has
already begun. No claim of instantaneous revocation inside such a syscall is made.
An uncertain native modal retains its callback context/alert/delegate until
completion and blocks subsequent modal/action presentation in that session.
Opening a native sheet without the exact focused document also fails closed and
latches this session; the human must retain focus throughout review.
A missing callback can retain one bounded native context; it does not free a
possibly live callback target or authorize another sheet above it.

The existing absolute **300-second session** is unchanged and never refreshed by
review or signing. Expiry while a human reads still requires a new explicit
session/review; it never extends signing authority. Usability beyond that limit
requires separate observation and a separate decision.

## Existing anchor and incomplete inspection

New anchor installation uses the same two moments and native bounded checks.
Only its immutable public intention is reviewed; nonce/expiry are created after
consent. The signed installation/envelope remain **format 1** and its verification
is unchanged. An already installed valid anchor is loaded/rechecked, never
regenerated, reinstalled or migrated. Recovery challenge version 1 remains valid
only as historical signed evidence; every new recovery authorization is version 2
with a required signed intention digest.

A bundle without `capture.json` has no authenticated capture to continue. It is
preserved in place and `continueCapture`, abort, release and finalize deny it. This
increment deliberately supplies no adopt/delete/repair path. Preserve its original
inspection files and the installed anchor. Any later operator operation needs its
own authorized inspection of current state; a separately approved fresh capture
would create a distinct bundle and leave the partial intact. That is a possible
future action, not an automatic retry, current permission or proof of safety.
An unknown same-boot helper lease cannot be inherited by a new host.

## Research and verification boundary

Keep ORQST's existing Ed25519 signer, admission transaction, snapshot validators,
owned private pipes and AppKit presentation guard. Re-inspected exact upstream
sources: [Anywh instanceLock](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/instanceLock.ts)
(`acquireInstanceLock`/`takeLockFile`, Node fs/net/crypto) and
[native sidecar](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs)
(`tailnet_sidecar_start`, Tauri shell/Tokio/serde), with architecture, agent-host and
runtime docs; [Tucano router](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts)
(`routerPrompt`/`parseRoute`, shared types/engine). Both exact roots have
Apache-2.0 LICENSE and no tracked NOTICE. Neither provides an exact administrative
consent/clock contract; PID takeover and speaker routing cannot supply this
permission. Decision: keep and narrowly adapt ORQST; no upstream code/dependency
or Overclock visual asset is incorporated.

Clock behavior was checked against [Node 24 libuv Darwin source](https://github.com/nodejs/node/blob/v24.0.0/deps/uv/src/unix/darwin.c),
[Rust Instant's platform contract](https://doc.rust-lang.org/std/time/struct.Instant.html#underlying-system-calls)
and the installed macOS SDK `mach/mach_time.h` signatures/comments. SDK ABI facts
are used through narrow FFI, with no copied Apple implementation or dependency.
The existing locked objc2 message dispatch and NSAlert delegate pattern are reused.

Executable regression results are recorded in the delivery handoff, separately
from native acceptance. Pure tests cover independent synthetic clocks, long
pre-consent reading, post-click expiry, replay, semantic binding and unchanged
reservation/owner/future-owner constraints. Rust guard tests compile the actual
production guard; formatting checks cover the native wire/delegate source.
They do not prove AppKit runtime behavior or a packaged application.
