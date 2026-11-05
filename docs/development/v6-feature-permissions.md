# V6 Feature agent permissions

This increment adds a restrictive Core/protocol/SQLite policy for managed delegated
tasks. It reuses the existing Feature assignments, reviewed routing, native grants,
communication journal and structured runtime. It adds no transport, process manager,
CLI approval mechanism or dashboard/native editor.

## Default and scope

The preserved [V6 MASTER, line 286](../design/v6/source/ORQST_MASTER_SPEC_FEATURES_ATUALIZADO.md)
places automatic communication inside the Feature by default, and explicitly says
that the Orchestrator role grants no privileges. Accordingly, **a known, unarchived
Feature without a policy row has revision 0 and null configuration: the policy
layer is neutral**. Existing route, native grant, ownership, binding, capabilities,
provider and queue checks still decide access. Worker and Orchestrator have exactly
the same access under identical identities and grants.

A saved policy is a strict AND restriction. An operation must appear in the exact
stable source-terminal/target-terminal rule as well as satisfy every existing
check. Empty `rules` revokes all operations. No wildcard, role, title, handle, PID,
path, session, provider text or saved team can grant authority. Policy allow never
configures a route, issues a grant or starts a process.

Missing policy differs from missing evidence: an unavailable reader, corrupt policy,
future schema, unknown/archived Feature, mismatched Workspace/Feature, foreign or
missing terminal identity and exhausted storage limits deny. Legacy panes without
`featureId` retain the exact-grant contract and can never reach Feature-scoped panes.
Cross-Feature/Workspace authority is still unavailable.

## Contract and operations

`packages/protocol/src/feature-permissions.ts` defines strict version-1 schemas:

- `FeaturePermissionConfiguration`: `{ schemaVersion: 1, rules: [{
sourceTerminalId, targetTerminalId, operations }] }`.
- `FeaturePermissionOperation`: `delegate`, `execute`, `view`.
- `FeaturePermissionState`: `{ schemaVersion: 1, workspaceId, featureId,
revision, configuration }`. Only revision 0 has null configuration.
- `FeaturePermissionSave`: `{ expectedRevision, configuration }`.
- `featurePermissionEventSchema`: scoped, ordered metadata audit with trusted
  actor ID, actual timestamp, previous/current revision and configuration.

`delegate` admits the existing `task.request`. `execute` additionally permits its
adapter dispatch; both are required. Execute is not a command sandbox and cannot
approve Bash, files, network, a CLI tool call, terminal input or manual launch.
`view` allows only the existing actor/grant-scoped delegation metadata and result
references. It grants no transcript or PTY access. A task can dispatch without view;
its status, events, inbox and notifications are then unavailable to that client.
Idempotent resend cannot reveal a completed result when view is denied.
The local human owner's existing administrative access is unchanged.

Rules reject self targets, duplicate pairs/operations, delegate cycles and more
than 56 directed pairs. Store checks every referenced UUID against the current
Feature's at most eight assignments in the same transaction as saving the policy.

## Trusted composition only

```ts
const config = featureConfigurationDatabase(privateDirectory, trustedWorkspaceId);
config.readPermissions(featureId);
config.savePermissions(featureId, trustedActorId, { expectedRevision, configuration });
config.permissionEvents(featureId, afterSequence);
const service = new PaneCommunication(journal, resolver, Date.now, config.permissionReader);
```

The host fixes directory, Workspace and actor from authenticated native context.
These methods are not exposed to agents or over HTTP, RPC, renderer, Tauri invoke
or MCP. A Feature-scoped service must receive the trusted reader; omission denies,
not an inference that the catalog has no policy. Unscoped compositions remain valid.
Loading the configuration restores no grants, adapters, processes or ownership.

`routingProposal` filters denied delegate/execute edges after validating exact live
identities. Standalone Feature proposals require the policy callback. A proposal
still needs native route review and an independent task grant before use.

## Enforcement and revocation

Authorization snapshots the exact policy revision into the in-memory grant.
Admission checks delegate/execute and that revision before content resolution,
idempotency or insertion. Dispatch checks again before content resolution and
before claiming dispatch. Revoked work remains queued/pending without submit,
retargeting or retry. A policy edit, including reallowing identical rules, never
resurrects an old grant. A fresh native authorization and explicit `reauthorize`
are required for existing undispatched work.

Status, inbox, event filtering and notifications check view against the current
scope and revision. Notifications check again inside their queued microtask,
immediately before invoking the listener. Already-dispatched provider evidence
continues to be validated and persisted after revocation; revocation does not erase
facts or manufacture cancellation/exit.

`CodexStructuredRuntime.prepareRootTask` checks the same delegate/execute decision
and binds `policyRevision` into the native signed plan/digest. `runRootTask` checks
it again before consuming proof or starting the root provider turn. Role does not
participate in any of these decisions.

## Persistence, bounds and verification

`Store.featurePermissions()` lazily adds version-1 `feature_permission_schema`,
`feature_permissions` and `feature_permission_events` to the existing preferences
Store. It leaves observer `user_version` and historical migrations intact. Policy
CAS, revision increment and audit insert commit atomically; failed audit rolls back
the policy. Reads cross-check the latest audit/configuration/revision and retained audit
count; a missing saved row or incomplete history never reverts to the neutral default.
See [data model](../architecture/data-model.md#feature-agent-permission-policy--2026-11-05).
There is no product downgrade or automatic data deletion.

Synthetic tests use disposable SQLite and in-process adapters, including both roles,
absent/restrictive policies, stale grants, microtask revocation and root turn gates.
The focused command is:

```sh
pnpm exec tsx --test tests/feature-permissions.test.ts tests/feature-permission-enforcement.test.ts tests/feature-configuration.test.ts tests/pane-communication.test.ts tests/terminal-team.test.ts
pnpm lint
pnpm typecheck
```

Native policy editing, interactive MCP enforcement, real-provider/native acceptance
and explicit cross-Feature authorization/audit are separate pending increments.
No provider, application, Cargo, build or packaging acceptance is established here.
See [pinned source decisions](../research/v6-feature-permissions-reuse.md).

## Production composition wiring — 2026-11-05

The Tauri managed-agents bootstrap now passes the fixed native app-data catalogue
`core/orqst.db` and preferences root `managed-agents` to its existing Node host.
`structured-agents` remains a separate admission directory. The native-owned Node
host reads both private, validated manifests and resolves their stable workspace
and Feature IDs through `resolveTerminalPreparationContext`; it then forwards a
strict private bootstrap object to the existing Core IPC child. Renderer and
operational IPC request schemas have no bootstrap fields and no policy writer.
Rust does not parse a second copy of the manifest/catalogue contract.

Both manifests must name the same project, canonical workspace, Feature and
preparation fence, use the exact native paths and have distinct terminal UUIDs
assigned to that unarchived Feature. A mixed pair, missing native context or
mismatched IDs refuses composition. The captured pair IDs/fence are checked again
before preparation and launch; runtime manifest validation/signing remains intact.
A manifest without a Feature binding stays explicitly legacy even if the native
view has selected a Feature. Existing processes retain their captured scope when
the view changes; their delegation checks read current policy/membership without
requiring the old Feature to remain selected.

`DesktopManagedAgents` injects the Feature facade's real permission reader into
`PaneCommunication`, passes workspace/Feature into runtime preparation and scoped
mention resolution, and uses the Feature facade for team intent/proposals. A
reader failure never becomes revision 0. Saved team intent still needs native
routing review and exact task authorization, and cannot override policy denial.

Workspace ID domains are mapped explicitly from the same validated project:
`stableId('workspace', project)` identifies the catalogue/Feature communication
scope; `terminalDigest(project)` retains the historical execution journal and
unscoped team/communication domain. No IDs or stored rows are rewritten, copied,
merged or searched under an alternate ID. Feature policy/team reads never fall
back to legacy keys. Existing journals still require fresh private slots; this
increment does not reopen, adopt or reconcile an old runtime.

`tests/managed-agents-desktop.test.ts` executes the production argv parser/factory
and real Desktop/Core/SQLite composition with in-process synthetic transports.
It covers neutral absence, strict restrictions, stale plans, archive, malformed
policy, future schema, foreign workspace, unavailable reader, divergent ID domains,
legacy-row preservation, native-root mismatches, missing context and navigation.
This is executable source/composition evidence, not real native/provider acceptance.
Electron's legacy caller remains unscoped; it cannot launch Feature-bound manifests
without an equivalent trusted bootstrap. Native policy editing and interactive MCP
integration remain pending. No app/provider, full Node suite, build or packaging
run is implied by these checks.

Current source verification: 107 focused Node cases passed; `pnpm lint` and
`pnpm typecheck` passed. Pinned offline Cargo check, test (149 passed, 2 existing
fixture-dependent tests ignored) and all-target Clippy with `-D warnings` passed;
direct pinned `rustfmt --check` passed for the changed Rust file. Cargo check/test
reported a non-fatal toolchain `rust-objcopy`/missing `libLLVM.dylib` stripping
warning. The `cargo fmt` shim could not find `cargo-fmt` for its default 1.99.0
selection, so formatting was checked with the explicitly pinned 1.99.1 `rustfmt`.
No full Node suite, application/provider, package or build was run for this wiring.

### 2026-11-05: trusted-root validation order

The structured host parses both private manifests before comparing their preparation
bindings with the native-owned roots and scope. Only matching bindings may reach
catalogue, preferences, executable and fence validation. The parent before fork,
child composition and runtime revalidations use the same pair check; errors deny
preparation rather than becoming neutral policy. A bound manifest without native
context is refused. For bindings with no selected Feature, the private bootstrap
separately carries the native roots to the child and revalidates the pair and fence
at preparation and launch. These remain unscoped, use the legacy workspace digest
and have no Feature policy reader. Manifests without preparation bindings remain
legacy. Synthetic tests cover both bound modes and alternate roots without side
effects; they do not establish native UI or provider acceptance.

### 2026-11-05: native host manifest snapshot

The native host reads the private manifest once with the existing bounded,
canonical, no-follow file reader. It compares that snapshot's digest to the
inherited lifecycle receipt before parsing or validating the manifest, including
before any catalogue or preferences access. The same bytes are parsed and all
existing validation is applied; the receipt is checked again and armed before
spawn. A digest mismatch leaves the receipt and alternate roots untouched.
Synthetic tests replace a parent-validated manifest before host preparation and
compare recursive names, contents and mtimes, with a spawn stand-in. They also
exercise the unchanged valid snapshot; this is not real provider or native UI
acceptance.

Reuse decision: retain ORQST's private receipt and manifest validation. The
pinned [Anywh AgentHost](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/agentHost.ts)
`restore` and `spawnAgent` use its host registry and runtime process machinery,
not ORQST's inherited receipt/config digest contract. The pinned root license is
Apache-2.0 and no root NOTICE exists; no upstream code or dependency is copied.
Replacing ORQST's lifecycle would not close this receipt-specific ordering gap.
