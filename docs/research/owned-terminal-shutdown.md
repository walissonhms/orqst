# Owned terminal shutdown — 2026-11-05

This increment follows single CLI authorization `541ebf0dd768be5b35606e1eba3c5b642b26ef79`.
No source/assets/dependencies are incorporated from another project.

## Required lifecycle research and reuse decision

Before implementation, the following pinned source was inspected:
[Anywh AgentHost.close / endProcess / onExit](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/agentHost.ts#L1024-L1075),
[bounded drain and shutdown](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/agentHost.ts#L1255-L1334),
[Agent Host contract](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md),
[architecture](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md),
[runtime contract](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md).

Observed: Anywh serializes per-agent shutdown, drains turns, terminates owned processes
and awaits `proc.exited`. It also has hibernation/restoration, process-tree sweeps and
provider-specific runtime dependencies. Decision: **keep ORQST**, adapting only the
bounded wait/idempotent-intent approach. Do not import sweep, adoption, resume, automatic
escalation or a parallel manager. Its exact [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
is Apache-2.0; the existing pinned tree audit records no NOTICE. No copied source means
no new attribution/dependency/license closure. The earlier
[Tucano permissions/router review](single-cli-authorization.md) remains applicable;
connector/tool approvals do not authorize owned shutdown or provider approval bypass.

The ORQST equivalent already exists:

- `TerminalSupervisor.requestStop/stop` consumes a current Core proof and calls only the
  owned handle's `signal`; it has no PID lookup/adoption API.
- `pty-backend.ts` forwards a bounded private signal request to `pty-host.ts`.
- `pty-host.ts` calls the owned PTY's `kill(signal)`. Its `onExit` records/fsyncs the
  lifecycle receipt before sending the exit event.
- The supervisor records the journal exit before publishing `state: exited` and its
  receipt. A receipt/journal write failure remains ownership loss.
- Existing `shutdown()`/`closeAndWait()` alone do not prove provider exit. Previously,
  a generic RPC timeout disconnected Core; that behavior must not undo uncertain shutdown.

## Owner decision, 2026-11-05

The human explicitly chose **exit while preserving the pending record** when the
OpenCode principal has a genuine exit receipt but descendants remain unvalidated and
retirement is refused. This is distinct from a missing receipt/transport timeout.
The new exclusive, private, fsynced `exit-pending-<owner>.json` record binds current
admission owner/Core epoch and complete exit/nondispatch evidence. The original `active-pair.json` bytes are retained by an owner-specific
`pending-pair-<owner>.json` rename in the same directory after quiescence and durable
exit evidence, followed by directory fsync. Lifecycle receipts and journals remain intact.
The active namespace is then available to a new independent Core; no old owner is adopted. No retirement or cleanup is claimed.
The next catalog/host-ready packet exposes a nonblocking `owned_exit_pending` notice
for every preserved owner (deterministic UUID order, limit 64). A new independent Open
is allowed; it may share native resources with unvalidated descendants. An incomplete
pre-rename handoff still blocks honestly. The 65th preserved Quit stays open/uncertain
and removes nothing; a pending-reduction UI remains unimplemented. The notice grants
no recovery, takeover or process authority over any old owner.

## Acceptance boundary

Tests use synthetic handles, fake inherited IPC peers and disposable real SQLite and
receipt files. Native Quit/Dock/Cmd+Q/CloseRequested wiring, inline warning presentation,
real provider/descendant behavior and packaging require separate coordinated acceptance.
No Cargo/build/resources or running Preview files are changed by this source increment.

## Native Retire-before-Quit alternative — 2026-11-06

The owner requested in-app evidence-backed release or a native offer to Retire
before Quit. Reuse ORQST's existing attached-window Quit review, coordinator,
OwnedTerminalShutdown, signed retirement transaction and receipts. The native
review precedes SIGTERM and discloses attempted retirement plus the
already owner-authorized durable preserved-exit fallback. Retirement or the full
preserved handoff/close ACK is required; incomplete evidence stays fenced/open.
The 2026-11-05 decision remains effective and is not silently revoked.
The successful old protocol moves active-pair into pending-pair with exact bytes
and directory fsync. A residual active-pair alone therefore does not identify the
actual failing Quit stage in the owner's old package. No real marker/recovery or
running app was touched during source work.

Pinned Anywh `546f189c04415c3c5af5f40e3931a0a90b9aba31` re-inspected:
[Agent Host architecture](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md),
[AgentHost.close/serialize/endProcess](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/agentHost.ts#L1286)
and [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE).
The host drains/intercepts turns, hibernates or stops owned agents and closes its
socket; relay restart intentionally preserves host processes. Its lifecycle can
use group/SIGKILL cleanup and different descendant assumptions. Dependencies are
its agent queues/runtime drivers/registry/process handles. These do not satisfy
ORQST's signed durable reservation retirement or kernel-recovery policy. Decision:
keep the existing ORQST proof circuit and adapt only native consent/exit policy.
Apache-2.0; no root NOTICE, new copied code/assets or dependencies. Prior research
of Tucano communication and Overclock UX adds no reusable native retirement proof.
