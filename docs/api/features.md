# Private Feature configuration contract — v1

The separate chrome-only `terminal_restore` command accepts an existing hidden
`slot` and its Dock `generation`. Rust captures the exact chrome document before
the pipe lock, then validates current generation, slot, suspension, presentation
fences and document under that lock. The document mutex remains held through the
write. Its private `layout-action/reopen` envelope includes `generation`; Node
rejects missing/stale generations before any reopen or layout preference save.
This is visual metadata only and grants no process authority.

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

## Narrow native metadata facade — v1

`window.orqstFeatures.contractVersion === 1` provides `request(input)` on the
owned native dashboard/chrome only. `featureNativeRequestSchema` and
`featureNativeReplySchema` are the strict runtime definitions. Every input has
`contractVersion: 1` and optimistic `generation` from the latest snapshot:

| action     | Additional fields                                                         |
| ---------- | ------------------------------------------------------------------------- |
| `snapshot` | none                                                                      |
| `create`   | `input: { name, description?, status? }`                                  |
| `update`   | `featureId`, `input: { expectedRevision, name?, description?, status? }`  |
| `assign`   | `featureId`, `slot: 0..7`, `expectedRevision`                             |
| `select`   | `featureId` (UUID or null), `expectedRevision` of the persisted view      |
| `organize` | `command`: `restore`, `show-all`, `columns-1`, `columns-2` or `columns-3` |

Replies have `status: ok | denied | stale | busy | unavailable | archive_blocked`
and optional `snapshot`; `ok` requires the snapshot. It contains
`contractVersion: 1`, `storage: core`, `generation`, the fixed Workspace `{id,name}`,
Feature records, the CAS preferred `view`, the actually presented `activeFeatureId`, reviewed `slots: [{slot,terminalId,provider}]` and
`layoutSaved`. Names are presentation, never an address/identity. Null view means
unassigned terminals. `activeFeatureId` changes only after a valid presentation commit;
a preference saved after native invalidation may differ until the next explicit
selection. Snapshot reads do not apply that late preference to the live view.
Missing current-selection members remain metadata only.

The Rust command derives label, parent window, URL, native document generation
and wire UUID. Metadata requests/replies are bounded to 128 KiB with at most eight
pending requests; the service caps a snapshot at 96 KiB and reports unavailable
without closing the terminal Core if the catalog cannot fit (pagination is not
implemented). It forwards only `{kind: feature-request,id,document,source,request}`
on the existing private host pipe, receiving
`{kind: feature-reply,id,document,value: FeatureNativeReply}` in a separate bounded
pending namespace. These envelopes are not renderer APIs. No caller supplies a
workspace, path, process identity, execution proof or generic Core method.
A malformed metadata request with valid correlation fields receives a denial;
invalid correlation is ignored. Neither case shuts down the owned terminal Core.

The only Tauri command is `feature_request(window: Webview, request: Value)`.
`terminal::metadata_request(app, envelope, presentation)` is crate-internal;
`presentation` is captured by Rust before the native focus await, never accepted
from the renderer. Pending captures source/document/presentation. Exact main URL
capabilities and the dedicated local chrome capability are scoped to their single
Webview labels; Rust additionally checks parent and canonical URL. The custom
chrome is local in Tauri's ACL model, while the dashboard has a fixed remote
loopback origin. No capability is installed on terminal children or all Webviews.
Timeout, navigation/close and transport failure drop correlation without reusing
UUIDs; late/duplicate/different-kind replies resolve no new operation.
After the final asynchronous focus sample, source/document, presentation epoch
and Quit fences are rechecked together before any cache/publish/return decision.
The mutating latch remains held through that final sample for every reply outcome.
A command-scoped drop guard removes only its own pending UUID and releases only
its own latch on success, denial, error, timeout or future cancellation. A cancelled
mutation invalidates its pending presentation epoch; it renews no document, input
lease or authority. A snapshot or obsolete guard cannot release another mutation.

Example visual selection, after a fresh snapshot/review:

```json
{
  "contractVersion": 1,
  "generation": 4,
  "action": "select",
  "featureId": "e10636eb-3a12-4094-9123-49a4cdad27b8",
  "expectedRevision": 2
}
```

Native layout messages add separate `generation`, increasing `revision`, actual
`viewport: {width,height}`, exact `insets: {left,top,bottom}`, complete `state`,
`focus` and all reviewed `bounds`. Only native code can advance the presentation
generation via private `layout-generation`; the renderer cannot choose it.
Stale generation/revision/viewport or invalid geometry is ignored in full before
native state/visibility changes. Feature view/metadata revisions do not grant
execution or native input. See [workflow/security/limits](../development/v6-feature-ui.md).

The native insets are `{left:155,top:45,bottom:34}`, or `left:46` at logical width
720 and below; a non-chrome layout uses zero insets. All integer bounds are checked
against the actual native logical size before any state/geometry/show/hide change.
`!suspended && (workspaceChrome || visible.length > 0)` controls workspace visibility:
an empty Feature keeps its sidebar, suspension hides chrome as well, and no empty
pane receives input focus. A separate native suspension fence prevents an obsolete
ACK from reopening the workspace after dashboard/close/navigation/Quit.

## Trusted Feature permission composition — v1

The Core facade additionally exposes `readPermissions(featureId)`,
`savePermissions(featureId, trustedActorId, {expectedRevision,configuration})`,
`permissionEvents(featureId, afterSequence)` and `permissionReader(scope)`.
The host fixes Workspace, actor and private directory; these methods are not added
to inherited RPC or native/renderer/MCP transports. `permissionReader` returns one
transactional Feature/membership/policy snapshot for `PaneCommunication` composition.
A valid absent row is neutral; a saved policy only restricts existing route/grant
checks. `routingProposal` filters denied delegate/execute edges and never installs a
route or grant. See [the complete contract](../development/v6-feature-permissions.md).

## Canvas view action — 2026-11-05

The closed `canvas` request carries only `contractVersion: 1`, current `generation`
and `action: canvas`. It uses the same native document/focus/presentation/review/Quit
guards as view mutations. It revokes input and presents summary chrome with empty
PTY bounds while retaining saved `shown`, names and order. A current UUID-bound
`pane/focus` may resume the current view from the dashboard; foreign or stale
membership is denied before resumption. This grants no keyboard or process authority.

The inherited layout envelope now requires boolean `state.canvas`. When true,
`visible` is empty, all bounds are null and focus is null. It is ephemeral view
state, absent from SQLite layout preferences. Old/new native and host resources
must be packaged together; mixed strict envelopes are rejected. The display-only
Dock projection adds `canvas` and is also delivered to the owned dashboard. A
metadata snapshot republishes the current native display projection without
applying a late saved preference or changing process/input authority.

Session activities, effective models, durations and parentage are not added to the
native snapshot. The renderer explicitly displays their absence. No HTTP/WebSocket
endpoint, cookie, Host/Origin/CSP or observer control surface is added or relaxed.
