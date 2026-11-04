# V6 private Feature foundation

This is a Core/protocol/SQLite increment, based on `89bd625`, with the owner-supplied
V6 package read in full. The current main's `docs/design/v6/source/` contains the
preserved specification. UI, native focus and central release/checklist documents
are separate coordinated work. No desktop/dashboard/Rust/script change belongs to
this delivery. The earlier legacy editor experiment is preserved separately in
`preserve/team-config-editor-696` at `f9d31aa`; it is not part of this branch.

## Domain and persistence

The hierarchy is Workspace → Feature → stable terminal UUID → independently owned
agent session. `packages/protocol/src/features.ts` exports:

- `FeatureScope`: `{ workspaceId, featureId }`. Workspace IDs use the existing
  protocol ID vocabulary; Feature IDs are UUIDs generated once by Store.
- `WorkspaceFeature`: `{ schemaVersion: 1, workspaceId, featureId, name,
description, status, revision, terminalIds, createdAt, updatedAt }`.
- `FeatureStatus`: schema values `planned`, `active`, `blocked`, `completed`,
  `archived`. These describe explicitly edited Feature metadata, not process/task
  outcome evidence.
- `FeatureCreate`: `{ workspaceId, name, description?, status? }`; default
  description is empty and status is `planned`.
- `FeatureUpdate`: `{ expectedRevision, name?, description?, status? }`; at least
  one editable field is required. Omitted values are preserved.

Names reuse the existing 48-character safe display-name schema; descriptions are
bounded to 2048 characters. Timestamps are milliseconds from the actual metadata
command, not inferred CLI activity. Feature revisions start at 1. A terminal UUID
can belong to only one Feature in this private catalog. Assignment is metadata;
it neither enrolls a runtime adapter nor migrates an existing process.

`Store.features()` adds opt-in `feature_configuration_schema`, `features`,
`feature_terminal_assignments` and `feature_configuration_events` tables. It reuses
Store's SQLite/WAL/transactions and leaves observer `user_version`, workspaces,
events, journals, queue, grants and legacy JSON unchanged. Feature metadata has a
1024-record bound, an eight-terminal ceiling and 32768 bounded audit rows. Capacity
failure is explicit; there is no automatic deletion or eviction. Newer schema
versions fail closed. Events validate through `featureConfigurationEventSchema`:
`feature.created`, `feature.updated`, `feature.archived`, `feature.terminal_added`.
They are metadata audit records, not observed-source events or provider receipts.

Team proposals reuse `Store.terminalTeams(featureId)` and the existing strict
member/layout schemas. Layouts reuse `Store.terminalLayouts(featureId)` with a
separate key namespace. Full current Feature membership is checked atomically with
configuration access. An empty Feature reads null layout/null team revision 0.
Legacy unscoped layouts/teams remain readable by their existing APIs; no legacy
record or process is silently assigned to a Feature. Feature layout restoration
never imports an unscoped JSON layout or restores input/ownership authority.

## Trusted composition API

`packages/core/src/terminal/feature-configuration.ts` exports:

```ts
const config = featureConfigurationDatabase(privateAdmissionDirectory, workspaceId);
config.list();
config.read(featureId);
config.create({ name, description, status });
config.update(featureId, { expectedRevision, name, description, status });
config.assignTerminal(featureId, reviewedTerminalId, expectedFeatureRevision);
config.readTeam(featureId);
config.saveTeam(featureId, { expectedRevision, configuration });
config.readLayout(featureId);
config.saveLayout(featureId, terminalLayoutRecord);
config.routingProposal(featureId, terminalId, livePanes, expectedTeamRevision);
config.events(featureId, afterSequence);
```

The native host fixes the private directory and trusted workspace. The terminal
Core uses `stableId('workspace', reviewedConfig.project)`, matching the observer
adapter's existing namespace for the same canonical path. The older structured
pair's `terminalDigest(project)` namespace is unchanged. Never infer a mapping or
migrate its journals from names/path similarity. A new Feature composition passes
its validated exact workspace/Feature IDs to the structured runtime.

`routingProposal` returns `PaneRoutingUpdate` only; it issues no grant and changes
no route. It checks exact live managed UUIDs, bindings, ready state and Feature.
The caller then uses its existing signed native route review and exact task grant.
The caller must validate Feature membership against the reviewed manifest before
`CodexStructuredRuntime.prepare({ workspaceId, featureId, ... })`. A persisted
assignment alone is not launch authority. The existing per-instance journals,
admission, process limits, uncertain-state fencing and retirement remain required.

## Private inherited Node IPC

The exact schema is `packages/core/src/terminal/rpc.ts:terminalPairRPCSchema`.
`packages/core/src/terminal/host.ts` composes the facade in the existing owned Core.
Every request contains `id: UUID`; replies retain the existing
`{ id, ok: true, value }` / `{ id, ok: false }` contract.

| `kind`              | Additional fields                             | Successful `value`             |
| ------------------- | --------------------------------------------- | ------------------------------ |
| `featureList`       | none                                          | `WorkspaceFeature[]`           |
| `featureRead`       | `featureId`                                   | `WorkspaceFeature`             |
| `featureCreate`     | `input: { name, description?, status? }`      | `WorkspaceFeature`             |
| `featureUpdate`     | `featureId`, `input: FeatureUpdate`           | `WorkspaceFeature`             |
| `featureAssign`     | `featureId`, `slot: 0..7`, `expectedRevision` | updated `WorkspaceFeature`     |
| `featureTeamRead`   | `featureId`                                   | `TerminalTeamState`            |
| `featureTeamSave`   | `featureId`, `input: TerminalTeamSave`        | updated `TerminalTeamState`    |
| `featureLayoutRead` | `featureId`                                   | `TerminalLayoutRecord` or null |
| `featureLayoutSave` | `featureId`, `record`                         | null                           |

Workspace is fixed by the Core's reviewed project. `featureAssign` derives the
stable terminal UUID from the selected slot; the request cannot provide a different
terminal UUID, workspace, path, PID or proof. Unsupported slots fail closed.

No renderer/preload/Tauri invoke/HTTP endpoint is added for these commands. The next
native UI increment must provide a narrow metadata facade authenticated to the exact
current native document, with focus/activation and generation fencing, bounded
requests and current capabilities. Preserve selection-wide MCP/retirement exclusion.
Do not expose the entire inherited RPC transport. Feature selection belongs to the
presentation layer: changing the selected UUID must not start/stop/restart sessions.
No global active Feature, fabricated `feature.activated` event or process recovery
is introduced here. `events` remains a trusted direct Core API in this increment.

## Communication isolation and compatibility

`communicationPaneSchema`, `paneSendSchema` and `communicationAuditSchema` have
optional `featureId` for v1 compatibility. Missing remains legacy; it is never
backfilled. Pane workspace, Feature and stable terminal UUID are immutable after
enrollment. Journal uniqueness for handles is now workspace + exact Feature scope.
Display IDs remain workspace-scoped and are not recycled.

`PaneCommunication.resolveMention(workspaceId, text, featureId)` resolves one exact
handle only in that Feature. Omitting the Feature resolves only legacy panes.
Qualified references such as `@auth/backend` remain whole unmatched tokens: this
increment does not support cross-Feature execution and must not resolve a prefix
as a local alias. Existing attributed Tucano code/code-span/email exclusions remain.

The same Feature is required at route configuration, grant creation, queue admission,
dispatch, ancestry, status/result visibility and audit. Explicit Feature and legacy
scopes cannot interact. `authorizedDelegation` and structured start/task scopes
carry Feature IDs through the existing queue/adapter/grants, with no second dispatcher.
This is tested with synthetic adapters; native Feature/runtime composition and real
provider delivery are not accepted by these tests.

## Limits and checklist fragment

- [x] Additive persisted Feature identity, metadata, revision, terminal assignments
      and bounded validated audit in the existing Store.
- [x] Feature-scoped team proposals/layouts; legacy data remains unassigned and intact.
- [x] Exact Feature-local aliases, duplicate rejection and runtime deny-by-default
      guards across Feature/legacy boundaries in the existing communication service.
- [x] Private inherited IPC proves six selected terminal configurations persist
      without agent launch, process attempts or admission reservation.
- [ ] Native V6 CRUD/selection facade and approved UI, docked/floating geometry.
- [ ] Native Feature/session enrollment and switch continuity acceptance.
- [ ] Cross-Feature explicit destination authorization and audit workflow; all such
      runtime traffic is currently denied, including qualified aliases.
- [ ] Remove/move/duplicate Feature/terminals and safe archive with assigned members.
- [ ] N-member structured execution, mixed-provider messaging, real-provider/native
      WebKit/restart/platform acceptance.

Archive with assigned terminals is refused because a lifecycle review is not wired.
There is no deletion, process adoption, uncertain reservation cleanup, provider launch,
automatic migration or restored grant. The structured native composition remains
exactly two Codex instances; PTY metadata retains the existing eight-member ceiling.

Verification results and exact commands are recorded with the delivery to the
orchestrator. Tests deliberately distinguish synthetic metadata/IPC/adapters from
native UI and real-provider acceptance. No Rust target is created for this change.

## Executed verification

Using Node 24.22.2/pnpm 10.34.9 in the isolated worktree:

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: passed. The existing Vite large-chunk
  advisory remains. No budget or check was weakened.
- `pnpm exec tsx --test --test-concurrency=2 tests/*.test.ts`: 692 passed, no
  failures/cancellations/skips. After the final team workspace-ID validator was
  aligned with the existing protocol vocabulary and an extra live-proposal test
  was added, `pnpm exec tsx --test tests/feature-configuration.test.ts
tests/feature-private-core.test.ts tests/terminal-team-configuration.test.ts`
  passed 14 tests. The entire suite was not repeated after those last changes.
- `pnpm build:tauri-resources`: passed with the existing pinned Node license and
  Rust toolchain on PATH. This stages Node/Core/dashboard and notices; it runs
  `rustc -vV`, but compiles no Rust target and validates no native WebKit window.
- The private integration bundles and runs the actual Core host in a disposable
  directory, assigns six reviewed synthetic terminal UUIDs, persists proposals and
  layout, checks stale/foreign requests, and verifies zero terminal attempts and no
  admission marker. No agent executable is launched.
- `git diff --check`: passed. The delivered branch has no app, Rust, script or
  central-document changes.

Earlier checks caught three fixture assumptions: a request deadline could exceed
its earlier grant by milliseconds; never-dispatched recovery correctly preserves
`queued/pending` rather than claiming unknown execution; an old roundtrip fixture
mutated its terminal UUID after enrollment. Fixtures now use a bounded earlier
deadline, assert the actual journal contract and enroll the stable UUID initially.
The immutable-identity and authorization guards remain. Initial resource staging
failed because `rustc` was not on PATH; using the existing toolchain resolved it.
The separate archived editor experiment had namespace/disabled-control test failures;
it is not included or claimed as a delivered V6 UI.

Not run for this delivery: literal `pnpm test` (the equivalent full test glob above
uses bounded concurrency), real-data ingestion validation, real providers/inference,
manual native UI, Rust tests/build, platform installers or SSH publication. Ingestion,
quarantine, `ownership_lost`, native provider state and global configuration were not
changed. Keep the worktree until the owner integrates/publishes and authorizes its
removal. Rollback must preserve SQLite, originals and journals; older strict v1
readers may reject new Feature fields, so downgrading journals needs explicit review.
