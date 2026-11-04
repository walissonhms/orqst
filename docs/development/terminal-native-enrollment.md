# Native incremental terminals — source increment, 2026-11-04

Studio's normal **+ Terminal → CLI → Model → Open** source flow can append one
selected Codex, Claude Code or OpenCode member to the same running Core. It uses
the existing passive catalog and trusted workspace/Feature IDs, with no Finder
in the normal path. Advanced manual preparation remains an initial-selection path.
No app restart, second Core or new session manager is part of this implementation.
Actual native/provider acceptance remains pending.

## Admission, retained views and layout

The native host establishes capacity eight when creating this Core; that limit is
immutable for its lifetime and comes back in its original ready message. A live
caller uses that original capacity and epoch, never a renderer-provided limit.
Prepared profiles must retain the native admission directory and existing Core's
workspace; the Core revalidates identity, model and preparation context.

Only native provisioning supplies a manifest path over the inherited private
pipe. The host sends the [v1 enrollment](../api/terminal-enrollment.md) operation
with original epoch, native operation UUID and inspected CAS revision. `ready`
means admitted only. Existing supervisor/broker/document objects remain intact;
a new broker and native Webview are appended at the confirmed stable slot. No
old document is navigated, reloaded or destroyed. Existing documents extend their
navigation controls in place, preserving the actual xterm element and scrollback.

Feature membership is assigned through existing CAS during preparation. The helper
captures its previous UUID layout before assignment; the native host extends that
layout after confirmed admission, preserving order, names, sizing and hidden state
for old members under the new membership key. Opening the new member explicitly
changes active focus. The old membership-key record is preserved. Unassigned
layouts use the existing selection store. Metadata contains no recovered process
or execution grant.

The native append reserves its opening intent for the new exact document and
presentation generation. Creation runs on the main UI thread. Its private
`enrollment-present` acknowledgment is checked before releasing the addition latch;
obsolete generation, Quit, blur/navigation or failed presentation cannot rearm an
old intent. The existing separately signed operational Open still supplies
independent Start/output/input authorization with its original deadline.

## Refusal and uncertainty

Core enrollment has its isolated 12-second deadline; native admission transport
waits 14 seconds. The native pending correlation is removed on timeout. A late
admission ACK cannot create a Webview, and inspect never adopts it. Native document
creation and presentation have separate bounded waits of five and ten seconds.
None of these paths shuts down the original Core or replaces old documents.

Only a confirmed pre-effect rejection releases the addition fence for another
explicit selection. A new selection gets a new operation identity; no mutation is
retried automatically. Uncertain admission, transport, document creation or
presentation retains capacity/evidence and blocks further additions. Existing
terminal operations remain separate. A post-admission layout/presentation failure
can leave a confirmed Core member without a usable native document; it stays
incomplete and is not materialized by inspection. Prepared files and Feature
metadata can remain after rejection or uncertainty; there is no automatic removal,
rollback, signalling or cleanup.

## Checks and remaining acceptance

On the isolated source with frozen Core `c1b89f8` applied as `28b8dba`:

- `pnpm typecheck` and targeted ESLint passed.
- 43 focused session-free Node tests passed for service/layout/Feature/document/Studio behavior,
  including append preserving old signed input grants/identity, no new automatic
  Start, CAS refusal, preserved names/order, and obsolete presentation ACK refusal.
- `accept-terminal-open-renderer.ts --authorize-synthetic-terminal-renderer`
  passed EN/PT with actual xterm and a synthetic facade: output/keyboard,
  partial-instance continuation and new navigation without replacing the old xterm.
- Rust source was parsed/formatted with rustfmt 1.10.0, edition 2021. New Rust
  source cases reject uncertain/rejected/foreign epoch/opId/slot/capacity receipts;
  they were not executed.

No Cargo test/clippy/build, broad suite, build/resources, Core/PTY/provider launch,
native UI, model entitlement/readiness, native cleanup or packaging was run.
Available disk remained approximately 3.1GiB, below the authorized 4GiB margin.
The owner's running Preview/resources and all quarantines/uncertain fixtures were
preserved. Existing accepted synthetic results are not native/provider acceptance.
Dynamic OpenCode catalog and the wider V6 gaps remain separate.

Security review: inherited native parent/Core pipe only; no renderer manifest,
proof, limit or execution endpoint, new listener, cookie/WebSocket/CSP change,
credential read or observer migration. Reuse decisions and pin/license evidence
are in the [native research record](../research/terminal-native-enrollment.md).

## Queued callback and late layout correction

The five-second UI callback now checks its original Core epoch/view, monotonic
deadline, closed reply receiver and an atomic cancellation/claim token before
creating a Webview. Timeout consumes that token; a queued callback cannot start
creation after cancellation/expiry. Native scheduling/creation failure and the
ten-second presentation failure reuse the existing generation/suspension fence,
consume this operation's intent and reject late layouts. A newer Core/view is not
suspended by an older failure. Core/admission/slots/documents remain preserved.

Two additional pure Rust source regressions cover queued callback expiry/cancel
and old layout/intent rejection after presentation invalidation. Rustfmt parsing
and diff checks passed; Cargo execution remains paused and these cases have not
been run. The prior 43 Node and renderer checks are unchanged by this Rust-only fix.

Integration on main reran 46 focused session-free cases (including mocked Core
IPC), TypeScript, both Studio and xterm EN/PT renderer scripts, rustfmt and diff
checks successfully. These checks do not compile or execute the Rust tests and
do not update the open Preview.
