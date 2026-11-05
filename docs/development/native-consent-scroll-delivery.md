# Native terminal consent review and delivery — 2026-11-04

Independent code review accepts implementation
`5d8e828f805b117ef57650c60ca3e8daeffc1c1b` against baseline
`12dab3b8ba03e86c6ea97c51fef4fa960ac2f2f4`. The delivery additionally supplies
one missing synthetic startup argument, applies Rust 1.99.1 rustfmt and uses
Option propagation required by Clippy without changing the failure result. No
production lifecycle, provider, recovery, dependency or lockfile change is added.
See [pinned reference research](../research/native-consent-scroll.md).

## Native implementation review

The locked `objc2` 0.6.5 / `objc2-app-kit` 0.3.2 bindings were inspected for the
sheet selector, `NSModalResponse`, button ordering, default cell, plain text and
geometry. The selector is supported but deprecated in favor of a block callback;
its delegate signature remains `(id, SEL, NSAlert*, NSInteger, void*)`. On the
supported arm64 macOS target, NSSize/NSRect alias CGSize/CGRect with CGFloat=f64.
The helper's repr(C) encodings and NSInteger=isize match those bindings.

The boxed context retains alert and delegate until the single AppKit completion.
Only that callback reconstructs/frees the Box. Async receiver cancellation cannot
free a live callback target; if AppKit never completes, retention is conservative.
Only second-button response 1001 approves; first/default Cancel and Escape deny.
All detail bytes remain selectable, read-only plain text in the bounded accessory.
There is no HTML, nested modal loop, stopModal, automatic approval or saved consent.

New AppKit getters run on the main thread before the application mutex. The
pre-presentation closure checks the exact document, dialog owner, generation,
loaded/revoked state, native focus and MCP request. Existing post-await generation,
focus, document, correlation and presentation checks remain. No lock crosses the
sheet await, and the host reader remains free to process invalidation/EOF.
`offline_recovery_details.rs` and the offline recovery contract remain unchanged.

## Demonstrated synthetic test correction

The unmodified private Feature test failed on both baseline and implementation:
`terminalStartupIdSchema.parse(process.argv[6])` received undefined. Its direct
fork supplied only manifests, public key, admission directory and capacity. The
current production client supplies the required fifth argument, startup correlation.
Adding only `startup-1` to that synthetic fork made the same focused test pass on
both revisions. No assertion, timeout, production schema or startup fence changed.
Missing worktree dependency links and generated resource links were restored from
the existing checkout for checks; these are disposable ignored environment setup.

## Existing normal application: retire before switching

This is source analysis, not a claim about the current user's runtime state.
An undispatched Codex selection is eligible for normal retirement only if the
owned Core can still prove its reservation, journals and ready enrollment. In
`ManagedTerminalPair.evidence`, undispatched prepared/start_failed attempts and
an empty attempt set are admissible; every dispatched attempt requires a genuine
owned exited state and exit evidence. Unknown/starting/running/lost ownership is
not converted to an exit by this UI fix.

Keep the current normal Preview open until Root 676 performs its owned-state
preflight. The existing native **Managed Terminal → Review safe retirement of
this reservation** command (`managedTerminal.retire`; Portuguese: **Revisar
encerramento seguro desta reserva**) is the release path. Focus the existing
terminal document and review/approve that separate retirement only under human
authority. `TauriTerminalRetirement.run` obtains Core evidence/challenge, checks
current focus/generation, signs a fresh proof, fences, calls `core.retire`, and
waits for `closeAndWait` before reporting retired. Core `retire` writes/fsyncs an
exclusive archive, fences the pair and only then finalizes its exact owned marker.
The native handler requires `status=retired` and `fenced=true` before hiding the
workspace and stopping its host.

**Quit alone does not release the active-pair reservation.** Native Exit writes
`shutdown`, waits at most six seconds and can terminate its owned wrapper on
transport timeout. Host shutdown disconnects Core; Core revokes authority and
closes pair/journals. `ManagedTerminalPair.close` never invokes `prepareRelease`.
Supervisor teardown preserves uncertain execution and never signals providers.
Therefore neither process disappearance nor successful Quit proves retirement.

Only after confirmed native retirement and owned Core shutdown should Root 676
consider the separate native Quit approval and normal-mode launch of the exact
new package, with no offline flag. If retirement is refused, cancelled,
inaccessible or uncertain, keep the current app/Core and reservation preserved;
do not switch packages or invent recovery, retry, adoption, process signals or a
reboot. This review does not exercise that human state or change its contract.

## Acceptance boundary

The package manifest records actual current-command results, source publication,
resource/native/helper/Node hashes and preservation inventories. A package build
is not native acceptance. Synthetic 390/720/1440 geometry cases cannot prove real
AppKit control visibility, scrolling or keyboard interaction. Those and actual
provider/model behavior remain Root 676 / human acceptance. The new package is
not launched by this delivery. Offline recovery is not invoked again.
