# Terminal layouts in SQLite — 2026-11-04

Electron and Tauri retain their existing layout controls, stable reviewed terminal
UUIDs and private preference directory. Layout writes now use
`terminal-layouts/preferences.sqlite`. Both shells use their existing `managed-agents` admission-directory root.
Electron still reads its original `userData/terminal-layouts` JSON location. This does not
merge their application profiles or open any execution journal.

The existing Store owns SQLite, transactions and its ordinary schema. An opt-in,
version-1 `terminal_layout_schema` / `terminal_layouts` extension stores validated
visual metadata keyed by a hash of the sorted UUID selection. It is not part of
observer startup or the HTTP/WebSocket API. This extension leaves Store's existing
`user_version`, event data and terminal/communication journal tables untouched.
The owned Core opens/closes its metadata connection synchronously for each
private inherited-IPC operation; there is no long-running additional process or second execution writer.

## Compatible import

On first load for a selection, read SQLite first. If no record exists, read and
validate the existing private `<selection-hash>.json` through the existing bounded,
canonical `O_NOFOLLOW` reader. Import the complete record in one transaction with
first-writer preservation. Keep the original file byte for byte; never rename,
delete, rewrite or mark it migrated. Later SQLite reads ignore stale JSON.
Fresh saves create no JSON files. A failed/corrupt import leaves the original and
existing selections intact. A later valid original can still be imported.

Order, shown panes, active/maximized UUID, names, columns, axis and split percentage
survive reopen and manifest reordering. Each distinct UUID set has its own record.
The strict protocol rejects foreign/duplicate identities, unsafe names and unknown
process/grant fields. Limits are eight members, 1024 layout records and 16 KiB per
record. Capacity failure preserves existing data and uses the existing memory-only
saving indicator; there is no automatic deletion/eviction. Unknown newer layout
schema versions fail closed without downgrade. Private directory/database modes
are 0700/0600. Database and existing sidecars reject symlinks, hardlinks and other
owners/non-private modes before SQLite opens them.

Restoring visual metadata does not recover a process. Opening/hiding a retained
native document, attaching output to an existing live owned attempt, resuming a
provider process and retiring a confirmed owned attempt remain separate operations.
No PID, input lease, provider capability, queue authorization, reservation or
`ownership_lost` state is restored/cleared by this preference adapter. Reload fencing
and signed native start/attach/stop/retirement remain authoritative.

## Delivery checklist

- [x] Shared pure strict layout-record schema and existing Store transactions.
- [x] Both current Electron/Tauri hosts use SQLite through the same adapter.
- [x] One-time non-destructive JSON import, reopen and UUID reordering tests.
- [x] Corrupt import, future schema, capacity, atomic rejection and filesystem guards.
- [x] Synthetic test proves layout access creates no terminal owner/attempt tables.
- [ ] Persist full team identity/handles/roles/directed permission configuration.
- [ ] Unify PTY and structured composition and remove the fixed structured pair.
- [ ] Native WebKit/provider/restart recovery acceptance and platform distribution.

These unchecked items remain required by the master specification. Restored team
configuration must undergo live identity/capability/permission checks before use;
visual preference import must never activate a saved route.

## Verification

Focused command:
`pnpm exec tsx --test tests/terminal-layout-store.test.ts tests/terminal-layout-sqlite.test.ts tests/tauri-terminal-layout.test.ts`:
14 passed. It includes the preserved legacy-reader/writer regression tests. All
fixtures are private synthetic directories and labels; no providers are launched.
The complete suite passed 675 tests with
`pnpm exec tsx --test --test-concurrency=2 tests/*.test.ts`. `pnpm lint`,
`pnpm typecheck`, `pnpm build` and `pnpm build:tauri-resources` passed.
`pnpm accept:tauri-terminals --authorize-synthetic --panes=8` passed with the staged
Node, eight real disposable PTYs, retained xterm documents, SQLite inspection,
resize, revocation and signed retirement after owned exits. Native IPC/focus/dialogs
were simulated; no provider or native WebKit acceptance is implied.

The first Electron integration reached SQLite inspection before the asynchronous
Core save committed (columns 2 instead of the required 3). The integration now waits
for the exact durable value before retaining all original order/name/mode/instance
assertions; it does not loosen any expected result.

Two additional regression tests cover obsolete asynchronous save replies and live
view preservation after save failure; both passed in the 15-test Electron/Tauri
layout regression run. The corrected eight-PTY Electron integration passed:
`pnpm accept:terminal-team --authorize-synthetic-pty`. It retains cross-slot denial,
partial-retirement refusal, all-owned-exit retirement and stable documents/instances.
The existing installed Electron executable was reused explicitly to avoid a duplicate
binary download; its profile, bridge and source roots were disposable synthetic data.
Final lint and typecheck passed again after these tests/documentation changes.

An initial full suite found one failure (674 passed / 1 failed): adding the database
workspace as a Desktop dependency violated the existing client-only guard. The
implementation was corrected to keep the writer inside the owned Core and use its
private inherited RPC. The guard was preserved; the temporary dependency was removed.
An initial typecheck during that correction caught an optional-value assertion in a
new synthetic test; it was corrected without changing runtime behavior.

No ingestion changed. Real-data validation, real providers, human native acceptance,
Rust/native compilation and cross-platform installers are outside this increment.
Electron remains available. Rollback must preserve both SQLite and original JSON;
reverting code reads the old JSON and does not copy newer SQLite edits back into it.
A reverse preference export requires a separate explicit migration, never deletion
of the database or execution reservations.

Pinned source review: [research and security differences](../research/terminal-layout-sqlite.md).

The shared layout status now says saving is **not confirmed** while metadata remains
in memory. The same existing state covers pending Core acknowledgments and failed
writes; it must not report a write failure before the asynchronous acknowledgment
arrives. Both shipped locales use this evidence-qualified wording. Save revision
handling and the durable-success indicator are unchanged. The existing locale,
terminal-document and Electron/Tauri layout suites passed 20 tests for this wording
follow-up; lint, typecheck and build passed again. The complete 678-test run belongs
to the immediately preceding identity increment; it was not repeated for text only.
