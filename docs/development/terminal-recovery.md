# Experimental Terminal recovery — 2026-11-03

Current update: the owner-authorized [embedded native Terminal](../development/managed-codex-terminal.md)
selects a trusted/same-user contract and composes the library behind a private Node
Core. It supersedes the blanket immutable-binding/container gate in this historical
engineering note; it does not claim hard isolation or real-provider acceptance.

The owned-terminal library now supports a durable metadata journal through the
existing SQLite `Store`. This is implemented engineering code, not an enabled
managed Codex terminal. Normal Core/Bridge/Desktop startup and the native PTY lab
do not open this journal. Codex remains observation-only; Claude Code and OpenCode
remain contracts. No provider was executed to validate this increment.

## Private composition

Trusted composition can pass `store.terminalJournal(authority.epoch, { recover:
false })` as the fourth `TerminalSupervisor` argument. The authority's fresh random
epoch must match the journal. Omission preserves the existing in-memory synthetic
lab. This method has no API, WebSocket, preload or renderer exposure. Opening it
creates feature-scoped schema version 1 in the same database/writer, without changing
observer `PRAGMA user_version` (2). Existing observer and Analytics readers keep
their schema contract. Do not open a user database merely to exercise this feature.

An occupied journal rejects another owner by default. Only explicit trusted
recovery with a **new** epoch and `{ recover: true }` replaces the owner. There is
no inactivity/PID-based takeover. The replacement transaction changes old
`prepared` records to `start_failed`, and `starting`/`running` to `ownership_lost`.
Confirmed exits and earlier lost ownership stay unchanged. Old grants, attachments,
input and signals cannot cross epochs; synchronous backend effects hold the same
SQLite owner lock. This serializes journal ownership, not filesystem execution.

The supervisor commits preparation and then `starting` before calling its backend.
An admission/commit error prevents the backend call; consumed consent is never
retried. `running` and `exited` require backend callbacks and successful journal
updates. A thrown start, lost transport, persistence failure after an effect or
late callback keeps uncertainty. Caller-owned outer transactions are rejected so
they cannot later roll back an already executed launch. WAL uses `synchronous=FULL`;
hardware/filesystem durability and hostile same-user processes remain outside this
engineering guarantee.

Explicit shutdown revokes local controls, records unstarted attempts as failed and
live attempts as lost, then releases the journal owner. No shutdown, recovery or
retention path signals, reattaches, retries, resumes or adopts a process. The journal
stores no PID or process handle. A stored instance is not an attachment capability;
the existing broker still accepts only instances it prepared in its live document.

## Data and budgets

Only random instance/epoch IDs, enrolled client/project references, a manifest digest,
lifecycle state, wall-clock metadata timestamps and confirmed exit code/signal are
stored. Full profiles, paths, executable argv, input, output, prompts, environment,
credentials, challenges, signatures and input leases are excluded. These records
are separate from observed agent events and never fabricate sessions or statuses.
Metadata remains private; references and digests are not anonymous identifiers.

Durable admission is atomic across the writer's current and previous epochs: at most
two `starting`/`running`/`ownership_lost` instances globally, at most one per exact
project reference. Lost ownership reserves its slot permanently until an independently
reviewed reconciliation mechanism exists. It cannot be released by inactivity, a
new supervisor, late exit or manual-looking provider output. There is deliberately
no erase/reconcile operation exposed by this increment.

The journal has a 10,000-attempt cap. On preparation it removes only `exited` and
`start_failed` records older than 30 days; prepared/live/lost records are never
pruned. At the cap it rejects preparation. The existing supervisor additionally
retains its stricter 128-attempt memory cap and bounded inert output ring. This is
metadata retention/admission, not descendant, CPU, memory or provider containment.

## Validation and remaining Codex gates

Run from an isolated checkout with Node 24 and pnpm 10:

```bash
pnpm exec tsx --test tests/terminal-journal.test.ts tests/terminal-supervisor.test.ts tests/terminal-native-broker.test.ts tests/terminal-runtime.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Tests use disposable SQLite databases and synthetic in-memory handles. One fixed
Node helper exits abruptly without closing its database; the parent verifies WAL
recovery in a new process. It does not launch a provider or read user credentials,
configuration, history or projects. This is synthetic persistence/fencing evidence,
not live Codex survival, human native consent or production recovery acceptance.

| Gate                             | Current result / required next evidence                                                                                                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Immutable admission              | Still blocked. Hashing/realpath followed by path-based `node-pty.spawn` leaves executable/cwd replacement races. A frozen JavaScript manifest does not bind OS execution.                                                                                |
| Authentication and authorization | Existing private one-use signatures, separate input/paste/stop grants, strict sender/focus/document checks remain. Durable epoch fencing adds no enrollment, provider login or credential import. Production native-client provisioning is still absent. |
| Codex credentials/config/history | Still blocked. A separately authorized disposable managed home and authentication provision are required; external homes and credentials are never reused.                                                                                               |
| Containment/lifetime             | Still blocked. Choose trusted native execution with explicit OS-user privilege limits or a validated container/VM backend; PTY groups and cwd are not sandboxes.                                                                                         |
| Recovery                         | Durable metadata/fencing implemented and synthetic-tested. No independently proven survivor identity, descendant cleanup, stored-PID signaling, safe resume or lost-slot reconciliation.                                                                 |
| Provider acceptance              | No managed Codex trial. Pin the actual admitted binary and validate start/sandbox/approval/readiness/interrupt/exit individually after the previous gates. Claude Code and OpenCode require separate implementation and evidence.                        |

The next deployment decision is concrete: trusted native execution needs a proven
immutable executable/project binding and an explicit privilege contract; hard
containment needs a container/VM supervisor with reviewed mounts, resource limits
and authentication. Neither option is silently selected by this library. No push,
service restart, provider run or real-data migration is part of these tests.
