# Tauri structured agent client

The opt-in `managed-agents` native window reuses `managedAgentsRequestSchema`,
`managedAgentsReplySchema` and the existing `DesktopManagedAgents` composition.
This is a private native command, not an observer HTTP/WebSocket endpoint.

Only the exact `orqst-agents://local/index.html` document in the `managed-agents`
window receives `allow-agents-request`. `agents_request({ request })` accepts the
existing version-1 actions: snapshot, start, routing, delegate, stop and retire.
The document cannot choose paths, a signer, host entry, executable, IPC operation
or admission directory. Prepared manifests are selected explicitly at app startup.

The browser adapter validates requests/replies and requires transient user activation
for every mutation. Rust independently checks document identity, visible focus,
load generation, permanent reload fencing, one concurrent mutation and at most eight
pending calls. Node validates the request again and serializes mutations. Snapshots
read actual Core state and do not confer focus or authority.

A mutation prepares the existing Core challenge. The private Node service sends
Rust an exact review bound to the pending request, with format controls escaped.
A review longer than 4,096 characters is denied, never truncated. Native default,
Escape and dismissal cancel; only the explicit approval button can approve. Blur,
hide, close, reload, expiry or pipe failure invalidate an outstanding authorization.
The Node service signs only after current-generation approval; Core still consumes
its one-use challenge and validates manifest, revision and ownership.

The parent-only newline JSON transport permits request, confirm and revoke
messages. Input is bounded to 128 KiB, output frames to 512 KiB and the Node output
queue to 1 MiB. A review waits at most 30 seconds. Existing host RPC calls retain
their 65-second bound; Rust allows 230 seconds for preparation, review, mutation
and the following snapshot. Timeout fences the document without retrying work.
Replies expose the existing public snapshot, never proof signatures or private keys.
The pipe is not a transport contract for external clients.

Directed routes start empty; roles remain descriptive. Grants, admission and dispatch
reuse the existing matrix, hop/TTL, idempotency and cycle checks. Mention resolution
uses the attributed Tucano parser only on explicitly submitted task text. Completion
requires structured CLI/Core evidence, not PTY writes or inactivity. Source/worker
results and correlation IDs use the existing SQLite journal and scoped content store.
No schema or observer-event change is introduced. Payload bodies remain memory-only;
restored metadata does not restore processes, grants or delivery authority.

Hiding retains the window, draft and owned hosts. Reload permanently fences commands.
Quit requires native disconnect consent and requests private host shutdown. If both
PTY and structured windows are configured, cancelling either quit review clears
earlier quit approvals for both surfaces. Descendant
containment and durable process recovery remain unaccepted. After signed retirement,
new prepared profiles require a fresh preview launch; no automatic reselection exists.

See [run instructions and checklist](../development/tauri.md#structured-agent-communication--2026-11-04)
and [component review](../research/tauri-agent-communication.md).
