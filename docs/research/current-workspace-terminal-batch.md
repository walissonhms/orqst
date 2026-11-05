# Current-workspace terminal batch — 2026-11-05

## Reference review and reuse decision

Re-inspected Anywh at `546f189c04415c3c5af5f40e3931a0a90b9aba31`:
[architecture](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md),
[Agent Host](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md),
[runtime contract](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md),
and [`AgentHost.spawnAgent` / `serialize`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/agentHost.ts).
The host creates an exact agent ID, serializes its startup and calls `forget` on
startup failure. Its managed structured Codex/Claude processes can resume sessions
and send messages; this is not the independent native PTY admission contract.
Its dependencies include its runtime/process drivers, event log and registry.

Decision: keep and compose ORQST's existing immutable preparation plans, scoped
catalog selections, admission inspection, Core enrollment and signed native Open.
Do not copy Anywh's failure cleanup or implicit resume: ORQST must retain uncertain
writes/admission and must not submit tasks while preparing independent terminals.
The exact [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
is Apache-2.0; the pinned tree has no root NOTICE and the inspected source header
adds no grant restriction. No upstream implementation or dependencies are copied;
NOTICE is unchanged. Tucano messaging and Overclock assets/layout are outside this
increment; their historical audits remain intact.

## Implementation and security boundary

`prepareTauriBatch` composes existing `prepareTerminalCreation` plans; it is not a
new runtime owner. Each plan binds the exact existing Workspace/Feature, executable,
model evidence and paths. A batch reviews each distinct CLI once, before writes,
then consumes one existing native preparation commit latch. All selected model IDs
are revalidated around review and before each provision; catalog scope alone is
insufficient because model source evidence has its own opaque identifier.

The Core pool remains eight. New manifests are prepared before Feature assignment,
so the batch does not invalidate its own original catalog revision halfway through.
Assignments use the original Feature revision and existing CAS, never a newly
adopted revision. Native admission uses the original host/epoch and the exact
post-ACK admission snapshot for each next member. It never reads and adopts an
unrelated host. The first ACK expands the saved layout once; subsequent ACKs retain
names already saved in this batch. Uncertain files remain recorded, and earlier
accepted members are never silently rolled back.

The IPC adds bounded IDs and per-item outcomes, not paths or authority. Native
source/focus checks, generation/input revocation, path containment, symlink rejection,
private file modes, CLI startup authorization and incomplete-admission latches stay
in place. There is no new HTTP/WebSocket surface or network call. Tests use labeled
synthetic files only; actual AppKit/provider acceptance and renderer wiring are
separate. Multi-workspace creation and account profiles are explicitly unsupported.
