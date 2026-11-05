# Native owned terminal shutdown

This private API follows the [single CLI policy](single-cli-authorization.md) and the
[dated owner decision / pinned source review](../research/owned-terminal-shutdown.md).
It is absent from renderer `terminalNativeRequestSchema` and observer HTTP/WS APIs.

## Native parent pipe

Only the native main-window Quit/CloseRequested handler may send these messages.
Cmd+Q, Dock and menu Quit need no terminal or application focus claim:

| Request                                | Reply                                                           | Parent action                       |
| -------------------------------------- | --------------------------------------------------------------- | ----------------------------------- |
| `{kind:'shutdownOwned',id:UUID}`       | `{kind:'owned-shutdown',id,status,evidence?,uncertain,reason?}` | Inspect status below.               |
| `{kind:'retireOwned',id:UUID}`         | `{kind:'retirement',id,status,fenced}`                          | Exit only after `status:'retired'`. |
| `{kind:'closePreservedOwned',id:UUID}` | `{kind:'owned-shutdown-closed',id,status:'closed'               | 'denied'}`                          | Exit only after `closed`. |

The native parent must not forward any renderer payload as one of these requests.
Normal terminal keyboard/input/Stop requests retain their actual native focus/document
checks; native global Quit is separate release authority, never a grant to execute tasks.

`shutdownOwned` statuses:

- `ready`: every current Core attempt is nondispatched or has an owned exit receipt,
  and Core can prepare exact retirement evidence. Send `retireOwned`.
- `exited_retirement_unavailable`: every owned principal exit/nondispatch is proven,
  Core refuses retirement at the existing OpenCode-v3 descendant boundary, and Core
  has acknowledged a durable owner/epoch-bound pending marker. Send `closePreservedOwned`;
  the admission reservation remains pending in its preserved owner-specific namespace. This is **not** cleanup or retirement.
- `uncertain`: missing receipt, timeout, lost ownership/transport, invalid evidence or
  unconfirmed marker. Keep Core and the visible main window alive; show an inline error.
  Repeating the same native shutdown rechecks evidence without signalling twice.
- `denied` / `busy`: show inline refusal and do not exit.

`evidence` is private Core `{epoch,attempts:[{slot,instanceId,epoch,state,exit?}]}`.
`uncertain` contains `{slot,instanceId,reason}`; reason is `timeout`, `ownership_lost`,
`transport` or `retirement_unavailable`. With no trustworthy inventory, there may be
no safe instance ID to list; top-level `reason` reports transport/timeout.

## Mechanism and fences

The first native request quiesces new Core starts, enrollment, metadata mutations and
MCP task authority before taking its owned inventory. It consumes the existing fresh
SIGTERM stop proof per running attempt, at most once per helper lifetime. There is no
SIGKILL escalation, PID probe, task prompt, retry/adoption or signal to observed sessions.
Starting attempts are watched until the existing Core can prove a running owned handle;
they are not signalled through a guessed process identity.

The transaction waits at most five seconds, including RPC preparation and receipt waits.
A deadline is not exit evidence. A late stop-preparation response cannot sign after the
transaction expires. Concurrent requests share one wait; later user retries examine
receipts under the same per-instance signal latch. Current Core epoch, owner and exact
instance binding remain authoritative. CLI-use trust may be revoked without preventing
owned release. Volatile broker views are not the source of retirement identity.

The existing PTY host fsyncs its lifecycle receipt before Core receives exit; Core also
requires successful journal transition. Retirement still consumes its own exact signed
Core proof and requires nonempty evidence. Empty/forged/unknown Core attempts do not
release capacity. A current Core may prove an earlier-view prepared attempt without a current broker view.
`TerminalAuthority.epoch` is generated per Core launch, not per installation. Cross-launch
prepared reservations are not adopted or retired by this route; the existing separately
verified offline `non_dispatch` flow remains the historical path. This is an open product
limit, not a regression of same-Core retirement.

During this transaction, generic RPC timeouts retain the Core connection, bounded late-ACK
tombstones and pending records. `closeAndWait()` refuses until either retirement or a
matching durable pending-marker ACK is confirmed. The preserved-exit close ACK additionally
waits for actual Core process exit; Core absence/timeout is not substituted for an ACK.

## Pending startup state and security review

The private exclusive `exit-pending-<owner>.json` marker is `0600` under the existing
`0700` admission directory. Core asserts original admission ownership before and after
write/fsync; existing marker bytes cannot be overwritten with another scope. The strict
bounded reader matches each preserved admission owner and epoch and rejects unsafe links/modes.
An incomplete pre-rename handoff remains an honest blocking failure **`owned_exit_pending`**;
a completed pending namespace is a nonblocking catalog/ready notice. Native/frontend allowlists preserve that code; the nonblocking notice uses the full
shared-resource warning defined below.

After the marker is durable, the same irreversibly quiesced owned Core renames its
exact `active-pair.json` bytes to `pending-pair-<owner>.json` in the same directory
and fsyncs that directory. This is a namespace handoff, **not retirement**. It retains
the original reservation bytes and all receipt/journal evidence. A later Core may
claim a fresh `active-pair.json` without adopting the pending owner or epoch. A lost
ACK can be retried idempotently without touching a newly claimed active owner.

The next normal catalog and native host-ready packet expose
`pendingOwnedExits?: Array<{id,code:'owned_exit_pending',principalCount}>`, sorted by
owner UUID, with no path, epoch or proof. The catalog notice is nonblocking and lists
all preserved pending owners. The exact translation key is
`tauriPreparation.code_owned_exit_pending` (both EN/PT, coordinated frontend owner):

> Principal-process exit has a receipt; child processes are unvalidated; a new terminal
> may share native resources (such as the OpenCode database) with them.

The list is bounded to 64 pending owners and a 4096-entry directory inspection budget.
On the 65th preserved Quit, namespace handoff is **denied in the current transaction**:
`shutdownOwned` remains `uncertain` with `retirement_unavailable`, the app/Core stay
open with inline error, and nothing is removed. The current active reservation and its
new exit marker remain preserved. This does not prohibit a fresh launch solely because
64 complete pending owners exist, but a crash before that current active owner is
handed off still leaves an honestly blocked active reservation. There is currently
**no user interface to reduce preserved pending owners**; verified retirement of their
unvalidated descendants and manual evidence-backed administration remain an open gap.
No automatic deletion, expiry, eviction or forced takeover is provided.

Fault-injection tests cover failure before rename, after rename/before directory fsync,
and after fsync/before ACK. Inspection sees the old active blocked state or the coherent
new pending state; original bytes and exit marker remain. These are synthetic syscall
failure checks, not hardware power-loss acceptance.

The code conveys no new launch/recovery authority for the old owner. Reservations, receipts, signed source
bindings, offline-recovery gates, provider sandbox/approval defaults and observer isolation
remain intact. No content, credentials, keys or prompts enter the marker or diagnostics.

Source and fixture checks do not accept native focus, provider exit/descendant containment,
Quit presentation or the next-start warning UI. Combined independent security review and
native/provider acceptance remain required before declaring the integrated flow complete.
