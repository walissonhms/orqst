# Native terminal client boundary

## Studio generation notifications and polling — 2026-11-05

`FeatureNativeSnapshot.generation` is the Core metadata/view revision counter;
the existing `orqst-terminal-dock` DOM event has a separate `detail.generation`,
the native layout/input presentation fence. Neither an ordinary `snapshot` poll
nor a successful `arrange` advances either counter. A cancelled/invalidated native
mutation may still advance the fence without changing SQLite; this revocation
must not be relaxed to eliminate a visual retry.

Every native fence advance/invalidation now schedules a dock notification directly
for main and feature-workspace, independently of a later host layout frame being
accepted. Its generation is current; geometry is hidden while waiting for a valid
Studio arrangement. Obsolete epoch/generation callbacks are dropped. A callback
that runs after a newer accepted layout in the same generation publishes current
state without hiding that layout again. Metadata-only notification does not
focus, resume, grant input, change membership or start a process. If a document is
not yet loaded it still needs its initial snapshot/reconciliation; no event
replay or native acceptance is claimed.

An arrange whose facade generation is stale returns a validated snapshot. The
Node presentation-change branch now also includes its current snapshot. Native
security refusals and rejection of an obsolete out-of-order reply cannot promise
a current snapshot: callers may re-read a passive snapshot and retry geometry
once, under all existing document/focus/generation guards. Never replay creation.

The preparation `catalog` uses the separate Studio helper, not the selected Core's
feature facade. No Core is valid (`preparation_admission = None`); an active Core
may cause `busy`/refusal during preparation, enrollment, review, full pool or
changed admission identity/presentation/revision. Reading the catalog does not
bypass those checks. A catalog failure is distinct from feature snapshot startup
unavailability; the exact owner-reported invocation remains untraced.

## Studio readiness and hidden geometry — 2026-11-05

A snapshot can return `unavailable` before a terminal Core exists, `busy` during
metadata/enrollment, or be invalidated by a native generation change. Callers must
refresh read-only snapshots after those states; this is not permission to replay
creation or any mutation. The native host initializes the facade before ready.

The native Studio requires the existing `arrange` with `layoutVersion: 2` and
validated chrome, viewport, exact owned slots and current generation. Before the
first valid arrangement, or after context/generation invalidation, PTY views are
hidden with no keyboard focus request. Rejected arrangements never reveal default
v1 rectangles. Rust enforces this independently of Node. The full-window chrome
can remain visible while loading and receives focus only in the already-focused
main window, so arrange still passes the actual first-responder check. No PTY
input is granted; hiding does not stop or terminate a process.
Standalone legacy layout producers retain their existing behavior. No API shape
or authority is added. Native/provider acceptance remains separate.

## Feature orchestrator label — 2026-11-05

Feature snapshots may include `features[].orchestratorTerminalId: UUID | null`.
Save it with the existing Feature `update` request and
`input: {expectedRevision, orchestratorTerminalId: UUID | null}`. Core accepts
only an assigned member of that Feature, uses revision compare-and-swap, and
persists the label independently of role, grants and routing. Old snapshots may
omit the field. This metadata does not launch, message or authorize any agent.
The native document, focus, generation and mutation fences remain in force.

## Slot scope and unknown agent state — 2026-11-05

The version-1 Feature snapshot now emits `slots[].workspace: {id, name}` and
`slots[].agentState`. Both fields are optional in the schema for
compatibility with older hosts. On this single-workspace host Rust and Node
require the slot workspace to equal the enclosing workspace. `unknown` is not a
process status: neither a live PTY nor an exited receipt proves an agent turn.
This increment does not enable multi-workspace enrollment, batch creation or
turn notifications. The native host's pool capacity is eight slots.

Security review: these are bounded display metadata, not a request, path or
execution capability. No HTTP/WS route, origin policy or native authority changes.

### Owned Claude turn projection

On a current, receipt-backed owned Claude session, the existing exact transcript
binding may additionally expose `canvas.entries[].agentState` and `turnId` (the
UUID of a validated user record). A matching `snapshot.slots[].agentState` is
`running` after a user record or a `tool_use` response, `completed` only after
an assistant `stop_reason: end_turn`, and `failed` only for an assistant record
marked `isApiErrorMessage`. These are turn observations, not process or task
outcomes. Missing, malformed, partial, unsupported or unbound evidence is
`unknown`; Codex and OpenCode remain `unknown`. Neither a process exit nor tool
execution establishes completion. No raw prompt or assistant text is sent.

The transcript does not reliably expose a pending permission/question prompt;
`waiting_for_user` is not emitted by this reader. Notifications and provider or
native acceptance are pending. Claude hooks would need a separate owned
`--settings` design and must never edit the user's settings.

## Versioned Studio arrangement — 2026-11-05

Only the authenticated `feature-workspace` document gets
`window.orqstFeatures.arrange(request)`. It accepts:

```ts
{
  contractVersion: 1, generation: snapshot.generation,
  action: 'arrange', layoutVersion: 1,
  mode: 'mosaic' | 'columns' | 'rows' | 'focus' | 'list' | 'free',
  viewport: { width: number, height: number },
  panes: [{ slot: number, terminalId: string, visible: boolean, z: number,
            rect: { x: number, y: number, width: number, height: number } | null }]
}
```

Version 2 uses the same shape, with `layoutVersion: 2` and the required strict
`chrome: { sidebar: 0 | 46 | 155, top: 36 | 81, bottom: 34 }`. Version 1
must omit `chrome` and retains its existing automatic insets. For example,
`chrome: { sidebar: 0, top: 36, bottom: 34 }` gives the Studio the full
window width; returning to a sidebar sends a new version-2 frame with sidebar
46 or 155 and the corresponding content viewport. No new process or view is
created when switching chrome.

Supply every current Feature member exactly once, using its current slot and UUID.
The viewport is the native content area in integer logical pixels: for version 2,
window width minus `sidebar` and window height minus `top` and `bottom`; for
version 1, whole window less left 155px (46px when window width ≤720px), top
81px and bottom 34px. Node derives and validates these against its native window
size, and Rust independently validates the allowed insets, native viewport and
all final bounds before applying the frame. Changing chrome revokes current input
leases; existing focus and generation checks continue to apply. Rects
are logical pixels relative to that content area's top-left, and must be finite,
positive in size and fully inside it. The rectangle is the native **terminal
content** region; account for the Studio card header and toolbar in the renderer.
`visible:false` requires `rect:null` and hides the retained Webview without stopping
or terminating its process. In `list` all Webviews are hidden; `focus` accepts at
most one visible pane. Only `free` permits overlap. Lower z is behind; ties preserve
the submitted pane order. z is an integer 0–255. Geometry is rounded at edges for
native presentation. Out-of-bounds, duplicate/foreign membership, stale generation,
stale viewport, and subpixel rectangles rounding to zero are refused as a whole.
The pure renderer's mosaic can exceed the viewport when its minimum rows do not fit;
the renderer must fit or hide those regions before sending them.

The bridge limits dispatch to at most one request per 17ms and one in flight; a
newer queued frame replaces an older queued frame, which resolves `busy`. It retries
only an explicit `busy` refusal at most twice, never an uncertain transport. The
native endpoint separately limits accepted attempts to one per 16ms. Layout changes
are ephemeral; on window resize all arranged child views hide until the renderer
sends a fresh viewport and frame. Existing metadata/document/epoch/presentation,
Quit and input-revocation fences remain in force. The actual focused child can move
to the front; its native first-responder status is checked, and focus does not
grant an input lease. `orqst-terminal-dock` exposes the current active pane so the
renderer can keep its own free-mode stack synchronized. No Webview is recreated.
An `ok` reply confirms host acceptance; native application is asynchronous and a
concurrent viewport or presentation change may still fence that frame. The renderer
must react to resize/context changes and send a fresh frame, not infer a paint ACK.

Rust/Node contract tests do not establish AppKit visibility, drag behavior, or
native keyboard acceptance. Those remain separate owner/provider tests.

## Workspace view commands — 2026-11-05

The existing `feature_request` metadata channel adds strict version-1 requests:
`pane` with `slot`, `terminalId` and a closed `command` allowlist (focus, hide,
maximize, restore, move-earlier/later); `renamePane` with slot/UUID/name; and
`movePane` with both source and target slot/UUID pairs. All include the existing
contractVersion/generation. The Core facade validates current Feature membership,
identity, presentation, scope and persistence before acknowledging success.

Security review: exact document/origin, native focus, generation, bilateral
metadata/review exclusion and Quit fences are retained. New commands contain no
process operation, path, executable, input text, proof or authority. The existing
capability is unchanged; no HTTP/WS route is added. Layout controls revoke input;
view changes never silently restore it. The 81px top inset is checked by Rust.

The native dock event now also carries `panes`: ordered current-Feature entries
with bounded display slot/label/provider and minimized/visible/active/maximized
booleans. `hidden` means not in the validated layout shown set, not merely absent
from the visible page. It contains no terminal UUIDs, grants or runtime proofs.
Display names are not handles. See [workflow](../development/studio-terminal-workspace.md).

## Tauri incremental dock metadata — 2026-11-05

The private Node host's initial and enrollment `pane` values include a `title`
and localized `provider` label. Native enrollment requires nonempty strings of
at most 48 and 32 UTF-8 bytes respectively, without control characters, before
appending the document, label and provider vectors together. The dock projects
only hidden slot, label, provider, count and native generation; these display
fields grant no process, input, routing or restore authority. The existing exact
receipt, document, owner, generation and restore checks remain unchanged.

Native and private host resources must be packaged together. This does not add
an observer HTTP/WebSocket route or change the public terminal request schema.

## Tauri native client — 2026-11-04

An opt-in Tauri client reuses this request/reply contract, `TerminalNativeBroker`,
`connectManagedTerminalCore` and the existing Core/PTY hosts. `terminal_request` accepts
only the public request; Rust derives the slot from the native window label and exact
`orqst-terminal://local/<slot>/index.html` document. Only these local windows receive
the command capability. The remote observer receives none; no HTTP or WebSocket
execution route is added. `terminal_view` handles local hide, dashboard, maximize,
restore and existing-tab selection, with no execution data or proof.

The private parent pipe carries bounded correlated requests/replies, native revoke/close
events and native dialog results. Signed proofs, keys, leases and attachments remain
inside Node and its existing private Core IPC. Public shape errors return `denied`
without closing unrelated terminals. Native transport timeout/reload fences the affected
document rather than retrying an uncertain mutation. Hiding retains the document/process;
quit closes the owned hosts. Native retirement is not ported. MCP consent now has a
native-menu-only path, described below; native/provider acceptance remains pending.
See [workflow and acceptance limits](../development/tauri.md#prepared-managed-terminals--2026-11-04).

### Interactive MCP native menu

For two opted-in profiles, Rust sends only private
`{kind:'authorizeMcp',id,slot,focused}` after deriving the current native reviewing
document. This is not a `terminal_request` action and introduces no renderer/API
capability. Node responds with a correlated `confirm` containing `requestId`, slot,
translated labels and complete bounded grant metadata. Only the native modal can
send `{kind:'confirm',id,accepted}`; default/Escape cancel. Native request/document/
generation/focus and Node revocation/deadlines are rechecked before signing.

The native-only reply contains status, never a proof, task payload or grant. Core
remains the authority for both owned running UUIDs, source/worker roles, workspace,
epoch, replay, 120-second maximum and 4/8-KiB task/result limits. Neither reviewing
terminal selection nor a menu click swaps roles or sends a task. Reload/destruction
calls Core `closeSlot` to invalidate the channel; hide only revokes pending consent
and keyboard authority. Transport ambiguity fences the document without retrying.
No observer HTTP/WS/cookie changes. See the
[security and source review](../research/tauri-interactive-mcp.md) and
[reproduction/remaining gates](../development/tauri-interactive-mcp.md).

## Codex/OpenCode pair exception — 2026-11-03

The shared manifest inspection permits exactly one Codex and one OpenCode in either
order, in the same canonical project. All other mixed selections are refused,
including 3–8-member teams. Native review uses this same Core validation. No wire
schema, process profile, environment or signing capability changes; startup and MCP
task grants remain separate. A pair containing OpenCode cannot retire capacity,
even after owned TUI exits, while descendant exit is unvalidated.

## Bounded team private transport — 2026-11-03

The interactive Desktop composition now supports 1–8 same-project/provider slots
(default maximum two). This supersedes fixed-pair wording in the historical notes
below. The native version-1 process request/reply schema is unchanged. Private
Electron-to-Node RPC slot indices and ready identity arrays are bounded by the
shared eight-slot transport ceiling; the configured selection maximum is enforced
before Core creation and again in Core. Unknown/noninteger/out-of-range slots fail
closed. Renderer process calls still never choose their slot.

New manifests optionally carry `identity:{terminalId:UUID}`. Ready replies expose
the persisted terminalId and `alias:P-<UUID>`, checked against the reviewed manifest;
legacy state paths have a deterministic metadata UUID fallback. Metadata IDs do not
authorize control or address the separate communication registry. Exact slot attempt
UUIDs, epochs, frame/session checks, grants and ownership remain independent.

Layout IPC additionally accepts only a strict `{tab:integer}` within the shared
ceiling, and native main checks it against actual available views. Legacy A/B action
strings remain valid. Only two views are split at once. Retirement still signs and
archives every attempted slot, fences all supervisors and refuses any uncertain
member. MCP remains the two-member contract. See
[terminal team operation](../development/terminal-teams.md) and ADR-036.

Current opt-in composition: the [embedded managed Codex Terminal](../development/managed-codex-terminal.md)
uses this unchanged strict wire contract in a separate Desktop document/preload.
Main keeps signing keys/leases private and calls a Node-owned supervisor through
bounded inherited IPC. No observer HTTP/WebSocket endpoint or dashboard capability
is added. The following historical library notes describe the earlier uncomposed
baseline; real Codex/human-modal acceptance remains separate.

The later [durable recovery increment](../development/terminal-recovery.md) adds an
optional private Store journal to the supervisor. It does not change this wire
contract, compose a provider or enable a production control surface.

Implemented engineering code, **not an application API**. No `/api` route, WebSocket
message, normal Desktop IPC listener, observer preload or dashboard registers this contract. Core's
public entry point does not export the experimental supervisor or broker. There is
no enabled provider, generic shell, external-session adoption or credential import.
See [provider research](../adapters/managed-terminal-research.md) and the
[managed design](../architecture/managed-terminal-design.md).

## Same-window Desktop composition — 2026-11-03

The interactive Desktop pair now uses two `WebContentsView` siblings in the main
window. Each retains its own partition, reserved main frame, preload and broker.
Sender validation uses the exact view's `webContents`, session, frame and document
generation; focus requires the containing native window and that visible view.
The dashboard document never qualifies as a Terminal sender. Window/view blur and
hide revoke input; view navigation, crash and destruction permanently close that
slot's client. These events do not grant renewal or imply process exit.

The separate `orqst:terminal-view` channel accepts only `dashboard` and `hide`
layout actions. Its isolated preload requires user activation; main validates the
native sender and focus. It accepts no slot, command, process ID, path or proof and
cannot start/stop/delegate. Native menu commands retain the existing fixed slots.
See [composition, behavior and evidence](../development/embedded-terminal-panels.md).

## Native ownership and request contract

`TerminalNativeBroker` consumes the strict, version-1 `terminalNativeRequestSchema`
from protocol. Trusted composition supplies a separately enrolled Ed25519 private
key, authority, supervisor, immutable native document identity and host. The host
must validate the actual current document and native focus, and invoke the native
confirmation helper. A renderer-provided click, cookie, origin or focus flag never
substitutes for those checks. This is not persistent enrollment or a production
cross-process authenticated transport. Use a unique enrolled client ID for every
broker/document: `close()` revokes that ID globally in its authority, so sharing
an ID would revoke other clients.

| Action     | Accepted request fields beyond version/action | Authority/effect                                                             |
| ---------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| `start`    | `profileId`                                   | Exact prepared immutable manifest, native confirmation, one-use signed start |
| `attach`   | `instanceId`                                  | Native confirmation for the broker's own known instance, read attachment     |
| `input`    | `instanceId`                                  | Native confirmation, up to two-minute input lease                            |
| `write`    | `instanceId`, `sequence`, `text`              | Current focus and lease, exact next sequence, supervisor byte/rate limits    |
| `paste`    | `instanceId`, `sequence`, `text`              | Separate confirmation bound to exact text, attachment, lease and sequence    |
| `resize`   | `instanceId`, `columns`, `rows`               | Existing attachment; supervisor dimensions/rate limits                       |
| `read`     | `instanceId`, `cursor`                        | Existing attachment; defensive bounded bytes and explicit gap                |
| `snapshot` | `instanceId`                                  | Owned library lifecycle evidence, independent of agent statuses              |
| `detach`   | `instanceId`                                  | Remove attachment and lease; no signal                                       |
| `stop`     | `instanceId`, `signal`                        | Separate exact `SIGTERM` or `SIGKILL` confirmation; no inferred exit         |

Unknown fields/actions are denied, including executable, argv, cwd, environment,
credentials, raw proofs, adoption, resume and provider approval. Instance IDs are
random attempt identities, never provider/session/PID aliases. The broker only
knows attempts it prepared: navigation recovery or another document's attachment
inventory is not implemented. Native composition cannot recover it from a PID.

Replies are `ok`, `denied`, `cancelled` or `busy`. Success contains the instance ID
and a snapshot or inert output bytes/cursor/gap. It never returns signatures,
challenges, keys, attachment/lease IDs or backend diagnostics. `ok` means the request
was processed; a snapshot may still report `starting`, `start_failed` or uncertainty.
Neither successful stop nor dispatch success proves process exit.

Only one request is in flight per broker, without an offline queue. After sender
and request-shape validation (and native focus validation for effects in the IPC
router), an already occupied transport/broker may return `busy` before inspecting
the instance's input lease. `busy` is a rejected, unqueued request, not an
authorization decision or a promise to execute later. A revoked write submitted
when idle is denied; a concurrent snapshot does not renew it. Synthetic
characterization verifies zero written bytes and no additional confirmation across
that transition. This clarifies existing behavior, not a changed reply contract.

Native confirmation starts only from a current focused document. Expiry, enrollment,
document and revocation generation are rechecked after the asynchronous dialog
and synchronously before signing/dispatching the effect. Native blur/transport loss
must call `revokeInput`; navigation/destruction calls `close`. Re-focus never renews
authority. A running broker requires its native host to observe every relevant
focus/transport event; polling a focus Boolean alone cannot detect blur/refocus.

## Electron helpers and gesture limits

`authorizedTerminalSender` requires the exact native window/session/main-frame
objects, matching document generation, reserved dedicated URL
`orqst-terminal://local/index.html`, and focus when requested. The observer URL,
subframes, stale reload generations and other windows/sessions are refused. The
scheme/document is reserved, not registered or served by this increment. Generation
must be maintained by trusted native lifecycle code before new dispatch; frame
object identity alone is insufficient for reload protection.

`confirmTerminalAction` calls Electron's native `showMessageBox`, with Cancel as
both default and dismissal result. It displays the exact frozen instance/profile,
policy, signal and quoted paste, escaping controls. It refuses details beyond 4096
characters and paste beyond 1024 characters instead of asking approval of a
truncated preview. The Core paste limit remains 16 KiB; larger native review needs
a trusted scrolling surface. Native dialog visibility/layout, focus interactions,
accessibility and an actual human gesture have not been accepted on a machine.
The helper is implemented and tested with a dialog double, not claimed as live
native authorization evidence. Translations exist in en-US and pt-BR.

`bindTerminalNativeLifecycle` wires blur to input revocation and main navigation,
renderer loss, WebContents destruction or window closure to permanent client close.
Every main-frame navigation, including same-document navigation, revokes the client;
the fixed terminal document has no in-page navigation. Disposal closes the client
and removes listeners. Modal-focus behavior needs native acceptance on every target
platform: if the modal does not restore native focus, a legitimate confirmation may
be denied. A focus loss fails closed, including while confirmation is pending.
Transport loss remains the composition owner's explicit revocation responsibility.
The observer document never receives Terminal IPC authority.

## Lifecycle and shutdown

Closing a broker revokes its enrollment, pending grants, attachment and input,
without stopping Core-owned work. It does not destroy the supervisor or claim exit.
Explicit `TerminalSupervisor.shutdown()` denies further preparation/start/attach,
invalidates attachments and marks live work `ownership_lost`, releasing listeners
without a signal. Unstarted preparations become `start_failed`. It is idempotent;
late callbacks cannot erase uncertainty. This conservative teardown policy is not
durable crash recovery, descendant cleanup or a guarantee that work survives.

The optional [metadata journal](../development/terminal-recovery.md) now provides
conservative epoch recovery outside this lab. There is no immutable executable/cwd
binding, resource sandbox, lifetime timer, safe relaunch, signed packaging or credential
provisioning. These production gates still prevent runtime composition. Automatic tests
use only in-memory doubles; the explicit synthetic PTY lab now exercises this broker
against a real fixed Node PTY with a synthetic confirmation host. That host is not
a genuine native user gesture and no real CLI is exercised.

## Security review note

No existing local API, WebSocket handshake, cookie or static-file policy changes.
The schema adds no reachable control surface. The experimental boundary rejects
command/env/grant injection, document substitution, concurrent confirmations,
expired/revoked pending consent and external-instance adoption. Output remains
bounded inert bytes; no emulator, automatic terminal reply, clipboard action, link,
HTML interpretation or persisted transcript is introduced. A compromised renderer
with an active keyboard lease can still abuse typed input; it cannot be prevented
by a schema. Restricted documents, trusted event classification, isolated signing
and production transport/enrollment must be validated before enabling any control.

## Native integration lab — 2026-11-03

The [explicit acceptance application](../development/terminal-native-acceptance.md)
now composes these helpers with a dedicated document/session/preload and
`orqst:terminal-native` handler. Normal Desktop/Bridge startup remains unchanged.
Replies use a strict bounded wire schema (output bytes as at most 64 KiB integer
arrays); unknown fields and backend diagnostics are denied. One request is in
flight; preload adds transient-activation checks and has no generic IPC or queue.
Enrollment/signing stays in the disposable native main process, with a separate
Node host owning only the fixed synthetic PTY. Host transport loss now invokes
`lost()` and preserves `ownership_lost`, including after late exit callbacks.

Real Electron/preload/IPC/Node-host/PTY acceptance passed with intercepted native
dialogs. This is not genuine human-consent acceptance or a production Core control
transport. The lab cannot enable Codex, Claude Code or OpenCode. Immutable
executable/cwd admission, separately provisioned credentials, containment/lifetime
and durable long-lived ownership recovery still block provider activation.

## Interactive pair transport

The native Terminal request/reply schema remains document-scoped: a renderer never
supplies a slot, executable, cwd, environment or proof. A single main-process handler
routes by the exact bound native frame to one broker per document. The private Node
pair RPC separately binds slot 0/1 and supports signed retirement; it is not an
HTTP/WebSocket or renderer capability. Core-issued terminal identities are separate
from process-instance UUIDs. See [interactive MCP boundary](../development/interactive-cli-mcp.md)
for the independent synthetic-only stdio task/result contract.

The dedicated PTY IPC reply additionally permits `status: "focus_required"` for a
valid current document whose start/attach/input/paste/write/stop request lacks
native window or content focus. It returns before preparing a grant or process;
invalid documents/schema still receive `denied`. The native sender predicate,
post-modal revalidation and blur revocation remain unchanged. The observer API
has no corresponding operation.

### Private Desktop MCP composition

The inherited Node pair RPC now additionally accepts `prepareMcp` and
`authorizeMcp` with the existing strict one-use native proof shape. They accept no
slot, source/target identity, task, command or environment. These are native-only
operations, absent from renderer IPC, HTTP and WebSocket. The optional pair Core
binds actual dispatched instance IDs, workspace and epoch and requires both slots
to remain owned/running. The native menu confirms exact grant metadata separately
from each launch. MCP tools remain the bounded synthetic-only contract described
in [interactive CLI/MCP](../development/interactive-cli-mcp.md).

## Version-scoped Claude Desktop profile — 2026-11-03

The private Node pair RPC accepts `claude-terminal-v1` alongside the two fixed
Codex profile IDs; ready identities can label `codex` or `claude`. The renderer
request/reply schema and observer API are unchanged. Native document routing still
selects the slot, and only signed native grants authorize new owned starts. A
version-2 Claude manifest is hash/version pinned and admits one dispatch with a fresh
UUID. The subsequent OpenCode opt-in below extends profile/ready-provider selection. See
[configuration, authorization and evidence limits](../development/claude-interactive-terminal.md).

## Version-scoped OpenCode Desktop profile — 2026-11-03

The private inherited Node RPC now accepts `opencode-terminal-v1` for `prepare`
and `opencode` in ready identities. It grants no authority from a renderer or
observer API. Version-3 manifests preserve native HOME/XDG/database selectors;
review manifests are blocked before Core, journal or admission creation. Explicit
startup authorization, migration/activity acknowledgments and the existing focused,
one-use signed start grant are required before dispatch. Only `--standalone` is
permitted; no prompt, resume/session/adoption or login profile is supplied.

The signed confirmation includes the selected native paths and ORQST state without
credentials; details over 4096 characters (including long paths) fail closed without
truncation. Optional v2 inline MCP configuration merges with native definitions and
retains separate task authorization. TUI receipt exit is not descendant-server exit:
`prepareRetire` and `retire` refuse selections containing OpenCode and leave sticky
capacity reserved. See [setup, side effects and authorization](../development/opencode-desktop-terminal.md).
Real startup/login/DB/migration/descendant/MCP/inference acceptance was not run.

### Native Studio layout messages

The dedicated terminal preload's separate `orqstTerminalPane.show` capability now
accepts `dashboard`, `hide`, `tab-a`, `tab-b`, `split-columns`, `split-rows`,
`maximize`, `restore`, `focus-other`, or exactly `{ percent: integer }` (25–75).
It still requires transient user activation. Main binds the sender slot and rechecks
the exact reserved document, frame, session, generation, visibility and native focus;
there is no arbitrary target identity, executable, path or task field. Invalid shapes
return false. No public API/WebSocket or observer preload capability is added.
`onLayout` receives only axis, percentage, visible slot indices and configured count.
Layout mutations revoke input, never grant it, and preserve the existing PTY/process.
Pair-only actions are disabled with one manifest. Preferences are memory-only.

## Studio preparation facade

The local observer preload exposes `orqstStudio` contract version 1 with a strict
`request({action})` enum: `snapshot`, `createMixed`, `create`, `select`, `resumeReview`,
`open`. The bounded reply contains status and optionally count/limit, opened/prepared,
canCreate/canSelect and busy. It exposes no filesystem paths, grant or CLI operation.
Native sender/focus/gesture validation and the existing native review chain are mandatory.
See [Studio preparation security review](../development/studio-preparation.md#security-review).
This is not an HTTP or WebSocket execution API.

## Layout-only native IPC — 2026-11-04

The dedicated terminal preload exposes `orqstTerminalPane.show` only to the reserved
native document. Its existing user-activation, exact-sender, main-frame, native-focus
and visibility guards still precede `orqst:terminal-view`. New layout-only messages
are `show-all`, `move-earlier`, `move-later`, `{columns:0|1|2|3}` (0 = adaptive),
`{moveTo:slot}` and `{name:string}` (trimmed, 1–48 characters, no Unicode control,
format or surrogate characters). Objects accept exactly one field. Slots remain
integers 0–7 and must exist; move changes only the sender's place in the display
order. It accepts no path, process operation, identity or authorization proof.

`orqst:terminal-layout` now reports the display projection: axis, percent, column
preference, slot order, open group (`shown`), physically visible page (`visible`),
selected slot (`active`), maximized slot or null, display names, prepared-document
count and whether preferences were saved. These are view facts, never agent task
states. A false save result is shown as memory-only operation. No REST/WS shape,
terminal-native execution request or Core ownership contract changes.

## Tauri retained workspace — 2026-11-04

The dedicated native client now uses sibling webviews in one `terminal-workspace`
window. Existing `terminal_request` requests and broker grants are unchanged.
`terminal_view` accepts the existing bounded layout-only action contract and an
identity-scoped `layout` snapshot query. Neither command accepts a renderer slot.
Native identity remains the exact terminal label and custom-protocol document;
macOS mutation focus checks the owned WKWebView's native first responder.

The private Node pipe adds validated layout-action/open/focus/suspend/resize records
and returns layout state plus native bounds. These are not observer HTTP/WS routes.
Preferences reuse the existing private UUID-keyed JSON store; no process recovery
or authority is persisted by layout. See the [review](../research/tauri-terminal-workspace.md).

## Native Tauri retirement — 2026-11-04

The private inherited native/Node pipe accepts exactly
`{kind:'retire', id:UUID, slot:0..7, focused:boolean}`. Only the native menu sends
this message after exact-document/native-focus validation. Renderer
`terminal_request` does not accept retirement and no Tauri command, REST/WS route
or permission is added. Existing native confirmation messages carry the bounded
Core evidence; proofs never cross the pipe.

The correlated result is `{kind:'retirement', id, status, fenced}` with status
`retired`, `denied`, `cancelled` or `busy`. `retired` requires signed Core retirement
and confirmed Core exit. `fenced:true` also accompanies post-proof uncertainty;
denial alone never proves whether archival completed. A bounded timeout/lost result
keeps native execution fenced. The existing Core RPC/admission schemas and journal
states are unchanged. See [workflow/security review](../development/tauri-terminal-retirement.md).

MCP consent and retirement are mutually exclusive across every selected pane,
including asynchronous preparation and native review. Retirement blocks public
requests and MCP preparation until explicit pre-proof cancellation/refusal, and
permanently after possible proof consumption. Revoking either document cancels a
pending selection-wide review. Focus chooses the reviewer only; it never swaps
MCP source/worker roles. No renderer permission or execution action is added.

## Private layout persistence RPC — 2026-11-04

The existing inherited parent/Core IPC now accepts `layoutRead`, `layoutSave` and
`layoutImport`, each with a UUID request ID. Save/import carry only a strict
version-1 `terminalLayoutRecordSchema` record. They accept no path, selection key,
process ID, command, capability or authorization proof. Core derives both the fixed
private metadata database path and allowed terminal UUID set from its reviewed
native configuration; foreign selections are denied. `layoutImport` fills an absent
selection atomically and returns the existing record if one already exists.

Desktop remains a client of SQLite. Only the existing owned Core opens the database.
The renderer's existing layout actions still undergo their sender/focus checks;
there is no new renderer-native command, observer HTTP/WS route or cookie change.
Layout calls never touch terminal journals, ownership, admission or signed process
operations. Async acknowledgments report the current save revision and cannot reopen
hidden documents, change focus or activate a restored route. A rejected metadata
operation leaves the view usable with the existing memory-only indicator.
See [migration and limits](../development/terminal-layout-sqlite.md).

## Native consent detail presentation — 2026-11-04

The macOS private `confirm` review now keeps complete title/message/detail in a bounded native plain-text scroll view. Cancel remains default/Escape; only the distinct Authorize button response can approve, followed by existing focus/document/generation/revocation checks. The private payload, authority and deadlines are unchanged. See [source and acceptance limits](../research/native-consent-scroll.md).

## Account limits — 2026-11-05

Successful `snapshot` and `canvas` replies can include `accountLimits: { readAt, accounts }`.
Each account is `{ id, provider: 'codex' | 'claude' | 'opencode', index,
plan?, updatedAt?, locked, windows }`; each window is `{ id, label,
usedPercent?, resetsAt? }`. Timestamps are epoch milliseconds and percentages
are 0–100. `plan` is at most 16 characters and `label` at most 24. Empty or
absent evidence never becomes zero. The native and protocol validators enforce
bounded fields and lists.

`{ contractVersion: 1, generation, action: 'accountLimits', command: 'refresh' |
'lock' | 'unlock', accountId }` refreshes or updates a local ORQST preference.
The only presently supported account ID is `codex-default`, index 1. Locked state
is persisted in the private preferences database and must be excluded by any
future account suggestion logic; suggestions and account profiles are not yet
implemented. Unknown IDs are denied. A refresh rereads existing local evidence;
it does not call or start any provider.

Only the default `~/.codex/sessions` root is supported when it is also the active
observer's configured root. The host consults up to 256 observed token events,
then reopens at most 8 MiB of source bytes with existing containment, no-symlink,
file identity, complete-line and SHA-256 checks. It shows an observed `codex`
account bucket (or the legacy single bucket without an ID), with windows keyed
by their evidenced duration. Equal-time contradictory readings are unavailable.
The current observer indexes `token_count` only when its cumulative token usage is
valid; a limit-only record with missing usage is not in this projection.
The timestamp describes when Codex wrote the record, not current provider state.
The directory identifies the ORQST profile, not the provider's current login;
old rollouts can belong to a previous login. Other roots, managed profiles,
Claude and OpenCode are omitted until a profile-bound local source is supported.
The reader retains no transcript text or credentials. Source/provider/native UI
acceptance and renderer refresh/lock button wiring remain separate checks.
Security review: this extends the existing authenticated native Feature command;
it adds no HTTP, WebSocket, network, credential-reading or renderer-supplied path
capability. Account IDs are allowlisted before preference changes, and the native
side validates the complete bounded reply before returning it to the renderer.

## Owned turn OS notifications — 2026-11-05

The private terminal host samples receipt-backed owned Claude transcript evidence
every two seconds, with one in-flight sample, independently of renderer requests.
Codex/OpenCode remain `unknown`; process liveness/exit is never a turn outcome.
Only a same-turn observed `running` → `completed`/`failed` transition qualifies.
First attach, lost/invalid data, a gap/sample above ten seconds, and shutdown do
not bridge transitions. A turn that starts and finishes between samples may not
notify. `waiting_for_user` still requires the separately reviewed owned hook work.

Private Node → Rust frame (not a renderer action or WebSocket event):

```ts
{ contractVersion: 1, kind: 'owned-turn-alert', epoch: UUID,
  slot: 0..7, terminalId: UUID, turnId: UUID,
  category: 'completed' | 'failed', silent: boolean, observedAt: epochMs }
```

The host rereads `core/orqst.db`'s existing notification preferences read-only:
`completed`, `failed`, and `sound`. Invalid/missing preferences suppress the sample.
Transitions are deduplicated by `(terminalId, turnId, category)` in Node and Rust and consumed per category when disabled.
The existing per-run native-alert toggle and fresh observer connection are also
required; both observer and owned notifications share the twenty-attempt run cap
(the plugin retains waiting threads). The dedupe sets and native queue are bounded.
No prompt, transcript text, path, title, or credential enters the OS notification.

A notification click restores the existing main window and requests passive
Feature/terminal navigation through the same current owned host. Rust validates
the host epoch, slot and shutdown/enrollment/presentation fences; Node revalidates
exact terminal membership and current layout generation. Stale/replaced hosts or
blocked presentations cannot reopen a pane. Selection revokes input grants; click
is never Start, keyboard authorization, approval, or prompt delivery. The background
poller stops on host shutdown. No HTTP, WebSocket or renderer capability is added.

Synthetic Node/Rust tests are distinct from macOS Notification Center, background
banners, Focus settings and real-provider click/focus acceptance, which remain pending.

## Composer mentions v1 — 2026-11-05

`window.orqstFeatures.request({contractVersion:1, generation, action:'mention',
from:{kind:'user'}|{kind:'terminal', terminalId}, to:[terminalId…1..8], text})`
records one attempt in a private append-only journal (`composer-mentions/`, 0700
directory, 0600 files, `O_EXCL|O_NOFOLLOW`, single-link owner check) and replies
`{status, snapshot, mention:{id, outcomes:[{terminalId, delivery, reason}]}}`.

- Targets must be exact current terminal IDs and members of the active Feature
  (or of the unassigned view). Otherwise `denied` with `unknown_terminal`,
  `not_member` or `cross_feature_denied`.
- A valid target is always `unsupported` + `no_structured_route` in v1. The MCP
  grant authenticates the source CLI and cannot speak for the user, so no composer
  delivery route exists yet. Nothing is typed into a PTY.
- The origin never carries a grant. Rust accepts only these closed outcomes.
- A failed record answers `unavailable`; the attempt may or may not exist.

The dashboard shows "Recorded · delivery to terminals is not available yet" or
"Not allowed" accordingly. An authorized v2 route (for example a target-side MCP
inbox read with the target's own grant) needs its own design and review.

## Current-workspace batch preparation — 2026-11-05

The owned main Studio facade accepts this additive request (facade contract v1):

```ts
{
  action: 'create-batch', generation: number,
  workspaceId: string, featureId: string | null, catalogId: string,
  requests: Array<{
    id: string, workspaceId: string,
    provider: 'codex' | 'claude' | 'opencode',
    modelId: string | null, name: string, accountId?: string | null
  }>
}
```

`id` is a unique request UUID. `modelId` is an exact opaque catalog choice, or null
for that provider's single evidenced CLI-default choice. Names use the existing
plain-text 1–48 UTF-16-unit rule. The array contains 1–8 requests; the total retained
Core pool remains **8**, including terminals outside the selected Feature. Only the
current Workspace is supported; foreign Workspace and non-null account requests
are refused individually. The native parent supplies available capacity and trusted
admission context; the renderer cannot increase the pool or supply paths/owners.

A completed invocation returns one result per input ID, in input order:

```ts
{
  status: 'batch',
  items: Array<{
    id: string, status: 'accepted' | 'refused' | 'unknown',
    reason: 'core_enrolled' | 'workspace_unsupported' | 'account_unsupported' |
      'capacity_exceeded' | 'selection_unavailable' | 'catalog_changed' |
      'review_cancelled' | 'context_changed' | 'preparation_failed' |
      'opening_uncertain' | 'not_attempted' | 'focus_required' | 'busy',
    effects: 'not_started' | 'possible', terminalId?: string, slot?: number
  }>
}
```

Accepted means the existing Core start/enrollment and native presentation ACK
succeeded. It includes the exact owned terminal UUID and slot (0–7); it does not
claim a provider launch, effective model or completed agent turn. Refused has
`effects: 'not_started'` and no terminal UUID/slot. Unknown preserves possible
writes/admission, may include a proved terminal UUID, and never reports an accepted
slot. An invalid/stale caller or lost transport can still receive the existing
`denied`/`unavailable` response; it must not infer rollback or retry from that.

One immutable native preparation review is used per distinct CLI, followed by one
commit latch. Existing provider start/input authorization is unchanged. Earlier
accepted members survive a later failure; no automatic deletion, retry, new host
adoption or PTY task submission occurs. Prepared-but-uncertain manifests remain
private evidence. Partial results are not an all-or-nothing transaction.

See [source/reuse and security review](../research/current-workspace-terminal-batch.md).
Renderer integration, actual native mixed-provider batch acceptance and the
separately reviewed multi-workspace design remain pending.

### Owned MCP communication projection — 2026-11-05

Successful `snapshot` and `canvas` replies may include:

```ts
communication?: {
  events: Array<{
    id: string; // UUID, stable for the same recorded transition
    from: string; // exact stable terminal UUID
    to: string; // exact stable terminal UUID
    kind: 'delegation' | 'result';
    at: number; // Core event epoch milliseconds
  }>; // at most 50, oldest first within the bounded current-pair audit
};
```

Both endpoints must be distinct members of the active Feature and present in the
owned snapshot slots. Duplicate IDs, other Features, raw bodies and `message`
events are refused by the Feature reply schema and Rust validator. The generic
composer projection schema still permits `message` for compatibility; this facade
only exposes the two journal-proven MCP transition kinds. Permission-review
snapshots stay free of this optional display evidence.

No pair/audit proof means the field is absent. An initialized safe pair with no
matching events returns `{events:[]}`. Queued tasks and unsupported/denied mention
attempts do not animate as deliveries. Disconnect never produces a result.
`delegation` proves broker handoff to the waiting worker; `result` proves exact
result submission, not provider/task success. Feature revision changes after grant
preparation suppress further audit records for that grant. Past records are shown
only while both terminals remain current members. Existing native input,
ownership, admission, grants, revocation and process fences are unchanged.

The Core stores a private metadata-only current-epoch audit in
`mcp-communication/<epoch>.jsonl` under its admission directory. It does not read a
separate structured-agents host journal or restore an old epoch. Pair capacity is
16 grants / 32 events; unsafe files or the 64 KiB read budget omit evidence without
changing accepted MCP operations. See the [reference review](../research/mcp-pair-communication-projection.md).

## Claude owned hook state — 2026-11-05 (source candidate)

New native-prepared Claude TUI 2.1.318 manifests opt into `ownedHooks: true`.
Their reviewed launch adds `--settings <state>/claude-hooks-settings.json`; the
settings and original ORQST writer script are immutable private 0600 files, and
the CLI authorization scope explicitly includes `orqst-owned-hooks-v1`. Nothing
writes to user/project Claude settings. Existing manifests and 2.1.178 MCP retain
their previous launch shape. Managed/user settings may disable hooks; ORQST does
not override that policy.
Only after the existing exact owned session/transcript proof, canvas entries may
project `agentState: 'waiting_for_user'` as well as running/completed/failed/unknown.
For these new manifests `turnId` is the explicit hook `prompt_id` UUID. It is not
mapped to a transcript user-record UUID by time, text or proximity. Session binding
and the three activity labels still use the existing canonical transcript evidence.
The private channel `claude-hook-events.jsonl` is selected empty before dispatch,
pins its file identity and append-only prefix, and reads at most 128 KiB. Its records
contain only `{version:1,sessionId,promptId,event,at}`. UserPromptSubmit and explicit post-tool callbacks establish
running; Notification permission/idle events establish waiting; Stop establishes a
finished-response signal; StopFailure establishes failed. Subagent events, foreign
session IDs, missing prompt IDs and unrelated notifications are ignored. A trusted
session/prompt with divergent cwd or transcript path records metadata-only `unmatched`
and becomes unknown until the next explicit new prompt; no divergent path is stored. Malformed/partial/replaced/rewritten/unsafe files establish
no state. Hook input is limited to 64 KiB, consumed in memory and never copied to
the channel; prompts, tool inputs, notification/response/error bodies and credentials
are not persisted or sent to the facade by this route.
Stop is a response hook, not an exit receipt or proof that a delegated task is done;
other configured hooks may continue work. Policies disabling hooks, exhausted read
budgets or missing exact-session proof remain unavailable. No CLI is probed or
started by the observer. Actual pinned-provider behavior remains native acceptance.
Waiting transitions from a previously sampled running state use the existing
`intervention` preference and fixed localized native body. Native pipe category
`waiting_for_user` maps internally to intervention; epoch/slot/generation/input
revocation and click-routing guards are unchanged. Dedupe remains terminal+turn,
including disabled transitions, so an idle notification cannot replay a completed
turn alert. No notification is inferred solely from initial/missing evidence.
revocation and click-routing guards are unchanged. Node and Rust dedupe each
terminal+turn+category, including disabled transitions. A permission alert or disabled
intervention preference cannot consume a later completion/failure category. No notification is inferred solely from initial/missing evidence.

See [pinned merge/source review](../research/claude-owned-hooks.md).

#### Owned hook review adjustments — 2026-11-05

Repeated post-tool progress is coalesced while the last metadata record for the
same prompt is prompt/progress, using a bounded 512-byte tail read. A callback
following waiting still records progress and resumes running. The channel remains
bounded to 128 KiB; exhaustion makes state unknown. This reduces writes for long
tool runs without promising unlimited session lifetime or inferring progress.

Esc/interruption does not emit Stop: the last running evidence can remain until
another observed hook/new prompt; ORQST does not infer interruption from silence.
An explicit idle_prompt after Stop changes displayed completed to waiting for input;
that completed→waiting edge does not emit a new notification (running is required).
Stop/`completed` means **response completed**, never a whole delegated task. Owned
completion notifications use `desktopShell.alert.responseCompleted`; the frontend
owner supplies English/Portuguese translations. Observer copy keeps its existing key.

### Studio hosted-document membership barrier — 2026-11-05

An accepted Feature snapshot also establishes a hide-only native member set for
its current Core epoch/presentation. Selected Feature membership is resolved by
exact terminal UUIDs to current slots; the unassigned view excludes every assigned
terminal. Non-members are hidden and their input revoked without stopping any
process. The native retained dock projection excludes those slots even if the next
geometry frame is refused. Later frames in that generation must carry exactly the
same member set; viewport, revision, ordering and input fences remain required.
A fresh native generation clears the prior display constraint for the next owned
context operation; it does not restore input, grants or processes.
Tauri Studio documents (initial and enrolled) additionally use
`main[data-chrome="studio"]` to activate the existing compact CSS. Open terminal,
Connect output and Enable keyboard input remain outside the hidden duplicate
header and keep their existing native authorization. Legacy/Electron documents
retain their existing header. No renderer request or runtime authority is added.
