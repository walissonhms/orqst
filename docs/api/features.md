# Private Feature configuration contract — v1

The schemas live in `packages/protocol/src/features.ts` and `terminal-team.ts`.
The existing inherited Node IPC (`terminalPairRPCSchema`) supports Feature list,
read, create, update, reviewed-slot assignment, team read/save and layout read/save.
The owned Core fixes workspace from the reviewed project; callers cannot choose
paths, process identities or alternate workspaces. This adds no HTTP/renderer API.

See the [exact fields, replies, bounds and composition requirements](../development/v6-feature-core.md#private-inherited-node-ipc).
Feature metadata is saved intent, not a session, execution grant or provider state.
Concurrent metadata/team edits use expected revisions. Assignment is exclusive;
archive with assigned terminals is refused until lifecycle review exists.

Communication pane/message/audit schemas accept optional `featureId` for legacy
v1 compatibility. When present it is immutable on pane identity and must match
source/target/grant throughout admission, dispatch and result visibility. An absent
Feature remains legacy scope; it never matches an explicit Feature. Cross-Feature
operations and qualified aliases are denied until an explicit workflow exists.
Restoration never activates adapters or grants. These additive fields may be
rejected by older strict readers; downgrade requires explicit compatibility review.
