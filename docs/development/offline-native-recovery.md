# Dedicated offline native recovery increment

Baseline: main `03e5bcb3348e1faac7be03ee8065208253eb6d61`, service `2e0a32b`
and contract `1b3dd9a`, corrected service freeze 744/1
`3c33960bf7f2f546c74a10978079d6e10d7703fb` and final marker-ordering freeze
`739870cb7782d9b1274ee2ad658500b1652b719e`. The original worker increment was isolated. Integration now combines it with
service correction `0382301`; real AppData, reservations, journals and auth
configurations remain untouched by verification. No application, Core, PTY or provider was started. No reboot,
signal, adoption, reconcile or package build was performed.

## Native flow

The fixed `--offline-recovery` mode branches before normal startup. Its native
menu separately offers anchor installation, capture, capture continuation,
post-fence release preparation/continuation, final commit review and pre-release
abort. No renderer supplies authority or paths. The static document and bilingual
native labels describe the administrative mode; the private helper retains one
service instance for all explicit actions in a session.

Install the independent administrative anchor through a signed public preview.
Capture requires a new complete review; it records the raw snapshot including WAL
and retains the original reservation. Every continuation/abort requires a new
challenge and signature; Cancel, expiry and pipe loss confer no future consent.
The native summary offers a scrollable read-only AppKit detail sheet before a
separate approval can be selected. Text is selectable and remains plain text;
display availability never proves human reading or acceptance. No UI action requests an immediate human reboot or starts another
process. External boot fencing is evaluated by the service, never declared by a
human checkbox.

Release/continueRelease now call the final marker-preserving service and report
`release_prepared`: the original marker remains present throughout preparation,
full final review and durable signed commit intent. Native finalize authorizes the
single final rename. Post-commit cleanup is restricted to the exact old controls;
`finalized_controls_preserved` expressly does not promise global capacity. No
intermediate protocol refusal remains in the native entry.

## Operator sequence for a subsequently reviewed package

1. Use the dedicated native `--offline-recovery` entry. It starts before normal
   observer/Core/PTY/provider setup. An already-running instance keeps its mode;
   a second invocation only focuses it, and cannot switch or inherit authority.
2. Select **Install administrative trust anchor**. Review its independent public
   fingerprint/location in the native detail sheet, return to summary and approve.
   Missing/corrupt existing anchor material is preserved, never regenerated.
3. Select **Review and capture reservation**. Review the complete immutable
   source/snapshot facts and separately approve capture. The signed bundle includes
   original DB/WAL bytes; the original reservation remains present.
4. The post-fence phases require a later, genuinely different kernel boot. This is
   an external acceptance step, not an app button or a claim inferred from restart,
   inactivity or a human compatibility checkbox. No reboot was requested/executed
   during this increment.
5. In a later dedicated session, use the native picker (initially rooted in the
   fixed bundles directory) for explicit capture continuation if needed, then
   release preparation/continuation. Each action reviews and signs a new phase;
   preparation still retains the reservation.
6. Select **Review final administrative release commit**, inspect the exact plan,
   then separately approve. Different/future controls stay preserved. Cancel,
   expiry, lost focus, EOF or incomplete evidence never confers future consent.
   Abort is a distinct pre-release review preserving the original reservation.
7. Normal Codex Open is a later explicit action in the normal application mode,
   using its existing preflight and native grants. Recovery never launches it,
   carries a grant forward, retries, or declares global capacity available.

A review lasting beyond 30 seconds expires. A subsequent explicit gesture creates
an entirely new challenge/review; neither opening details nor returning to summary
renews the original proof. Installation/data/whole-volume rollback resistance is
not claimed. Native visual, focus, scrolling, selectable-text and real external
kernel acceptance remain pending.

The private contract, durable storage and threat boundaries are documented in
[the native API](../api/offline-native-recovery.md); phase/lease semantics remain in
[the service API](../api/offline-reservation-recovery.md).

## Research and reuse

The exact current readers, signed terminal service, native preparation helper,
AppKit focus observer, Quit presentation guards and bounded diagnostics were
inspected before implementation. Keep ORQST's Ed25519 signer semantics and
private child transport; add only a separate administrative composition. The
normal 16 KiB transport and preparation admission predicate are unchanged.

| Pinned reference                                                                                                                                                                | Source/dependencies/license evidence                                                                                                                               | Decision                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [Anywh instanceLock](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/instanceLock.ts), `acquireInstanceLock`/`takeLockFile` | Node fs/net/crypto and PID liveness. Exact checkout root LICENSE Apache-2.0, no tracked NOTICE; architecture, agent-host and runtime contract docs also inspected. | Do not use: stale-PID takeover is incompatible with unknown administrative leases and legacy kernel fencing. |
| [Anywh native sidecar](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs), `tailnet_sidecar_start`        | Tauri shell/Tokio/serde, already adapted and attributed in ORQST `sidecar.rs`.                                                                                     | Keep ORQST's existing child-pipe pattern; no upstream manager or process replacement copied.                 |
| [Tucano router](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts), `routerPrompt`/`parseRoute`                                | Node/TypeScript shared language/types and owned engine/gateway orchestration; exact root LICENSE Apache-2.0, no tracked NOTICE.                                    | Do not use: speaker selection grants no administrative native authority or durable anchor.                   |

The locked objc2-app-kit 0.3.2 generated NSAlert/NSScrollView/NSText/NSTextView/
NSTextContainer/NSWindow selectors, Core Foundation CGSize ABI and rfd macOS dialog
backend were inspected for the custom accessory panel. The existing objc2 0.6.5
dependency supplies message dispatch; the documented NSAlert delegate selector
avoids introducing a block ABI or another dependency. The deprecated delegate
selector and native wrapping/focus/copy behavior require later native acceptance.

No new dependencies, upstream source/assets or license changes are incorporated.
ORQST's existing Apache-2.0 notices remain intact. Overclock layout/communication
assets are unnecessary for this narrow native administrative entry.

## Verification boundary

Node 24.22.2 and pnpm 10.34.9 are selected from the existing local toolchain.
Existing dependencies are linked into the worktree; none were installed or copied.
Pure tests mutate only explicitly synthetic temporary fixtures. They cover signed
installation and reload; partial/symlink/hardlink/mode/key/inode rejection;
64 KiB UTF-8 review, frame/session budgets; stale and malformed ACKs; actual
30-second timer expiry; EOF during modal and after queued ACK; anchor replacement
after review; independent abort/capture phases; complete WAL-bound capture; and
preservation with explicit uncertainty after effects began.

The production Rust `Presentation` guard is compiled independently for pure tests
of details, exact sheet observation, generation, source/deadline invalidation and
focus loss after return. These are not native/AppKit acceptance. Cargo 1.99.1/Rust 1.99.1 checked the real worktree manifest offline/locked with
all targets, both default and custom-protocol. The first attempt failed because
external sidecar resource paths were absent; existing prior resources were then
linked into the worktree without copying/generating bytes. Both checks passed.
A later small wire-outcome/source-revalidation edit is covered by source/rustfmt
review and remains for the serial integrator's final Cargo check. No Cargo test,
app build, bundle, resource staging, native UI, real kernel fence, old binary
execution or provider acceptance was run. Disk remained at approximately 23 GiB.

Final local Node validation covers 29 new synthetic tests, including persisted
anchor across fixture boots, release preparation retaining the original marker,
final signed commit, future-owner/control preservation, explicit interrupted
finalization and replay refusal. The production pure Rust presentation guard has
4 passing standalone tests. The final focused run passed 206 synthetic Node cases (29 new native boundary
cases plus service/admission/enrollment/Pair/retirement regressions). Root
`pnpm lint`, `pnpm typecheck`, Prettier, rustfmt and diff whitespace checks passed.

Integration owner 746 independently reproduced proof expiry between approval and
final commit (clock advanced during a durability boundary), and owns its minimal
Core correction. This worker did not edit Core/types or claim that this separate
review issue was fixed. Production acceptance requires the integrated correction.

Joint source review and native validation remain required before production use.

## Integrated source and package boundary — 2026-11-04

The source integration preserves original service commits `2e0a32b`, `1b3dd9a`,
`3c33960`, `739870c` and native commit `614cae6` (cherry-picked as `753788a`), plus
separate blocker correction `0382301`. The final commit checks the retained helper
lease bytes/full identity and proof deadline after durable preparation and the last
source checks. No new consent is inferred from an old signed plan or control file.

Vertical source review checked the independent durable anchor, separate signature
domains, fixed native kernel UUID source, full DB/WAL and current-owner enrollment
validation, non-dispatch restriction, per-phase approval, Cancel/EOF denial, unknown
same-boot helper refusal, marker exclusion until commit and future-owner cleanup.
The fixed native document has no IPC capability; HTTP/WS and observer authority
remain unchanged. Its static custom scheme restricts method/URL, refuses navigation,
new windows and downloads, and sets a no-script/no-connect CSP. This is the security
review note for that new local static surface. Existing upstream/license decisions
above were revalidated; no dependencies or upstream source are added.

On integrated source, 122 service tests and 29 native-boundary tests passed (151
distinct synthetic cases); full lint/Prettier, TypeScript, Rust formatting and Git
whitespace checks passed. The existing 53 admission/enrollment/retirement regressions
were already reported green on unchanged service dependencies by the prior reviewer;
that result is not a newly executed integration check. Full `pnpm test`, root build,
browser tests and real local ingestion validation are excluded here: ingestion is
unchanged and root build would clean shared output. Native Cargo tests/Clippy and
packaging happen only after the published source freeze, serially in the coordinated
`/tmp/orqst-691-target`; their actual outcomes and hashes belong to the generated
`dist/native-preview-offline-recovery/build-manifest.json`. A failing source gate
requires correction and a new published freeze before packaging continues.

The output is a separate `dist/native-preview-offline-recovery/ORQST Preview.app`.
Open its **executable** with the explicit argument, only during separately authorized
human acceptance, without first double-clicking its normal application icon:

```sh
"dist/native-preview-offline-recovery/ORQST Preview.app/Contents/MacOS/orqst-desktop" --offline-recovery
```

An existing Preview instance with the same bundle identity keeps its existing mode.
If the administrative title/menu is absent, stop: another launch did not select
administrative mode. Any orderly closing of current work needs its own human
context and authorization; this delivery does not quit, kill or adopt anything.

Real acceptance must first verify native detail wrapping/scrolling/selection,
Cancel/default, Back without approval, focus loss and timeout. Only then separately
authorize installation and exact real capture **before** any full kernel reboot.
Preserve the complete bundle/independent anchor and unrelated work. A subsequent
human-authorized kernel reboot is external; app restart or userspace restart is
insufficient. After a different native boot, select the exact captured bundle and
review release preparation; confirm it reports `release_prepared`, then separately
review/approve final commit. If the result is unconfirmed or controls are preserved,
preserve evidence and do not infer free capacity or retry automatically. Explicit
continuations obey the phase/lease rules; unknown same-boot helper evidence stays
denied. Normal Codex Open remains a later, independent human action requiring its
existing native grants and real started/owned-exit evidence. Recovery has not run
against the real reservation, and no actual release, native/provider or Codex
acceptance is claimed by source checks or packaging.

## Native lint correction before the second source freeze

The first published integrated freeze `1d5966a` passed locked/offline all-target
Cargo tests in both modes: 80 passed and one pre-existing explicit fixture ignore
per mode. Clippy with warnings denied then refused two new native expressions:
eight parameters to the details function and an owned URI string comparison.
Packaging stopped before native application build/bundle. The failed manifest/logs
remain preserved in `/tmp/orqst-746-delivery/`.

The narrow correction groups the three display labels as one array and reuses the
existing unavailable-document response's exact scheme/authority/path-and-query
predicate. URI equivalence is deliberately avoided because the locked HTTP crate
compares scheme/authority case-insensitively; the new regression covers uppercase,
query, encoded/dot paths and non-GET requests. No lint is suppressed or dependency
changed. The second source tag is
`delivery/2026-11-04-offline-recovery-source-r2`; resources and native checks must
be regenerated from that published freeze before packaging resumes. Node/Core
sources and the 151 passing synthetic cases are unchanged by this native fix.
