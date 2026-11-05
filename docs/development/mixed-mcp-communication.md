# Mixed MCP communication — 2026-11-05

This source increment permits two successive, individually native-authorized single-use
MCP exchanges on an already owned pair. It does not activate MCP by default or change
the bilateral preparation, provider configuration or native task authorization.
The stdio relay accepts protocol revisions `2025-06-18` and `2025-11-25` and echoes
the supported revision. An unknown well-formed revision receives `2025-11-25`; a
missing or malformed version is rejected. The exposed methods remain limited.

Each native review creates a fresh grant and challenge. A cancelled or expired review
can be followed by another review; a completed or timed-out broker remains terminal.
The new broker is installed only after native proof and while both sockets are idle.
A request is bound to the broker current when the socket receives it; an in-flight
request never moves to a later broker. Results must match the current task ID. After a
new grant is installed ORQST cannot determine when a model conceived a request; a
request received then belongs to the newly authorized grant. There is no queue, retry,
persistence or PTY injection. Disconnect, ownership loss, exit, dispose or invalidation
permanently close the pair's MCP authority.

The authenticated socket allows three calls per role per confirmed grant and closes
on a fourth; an unconfirmed review does not reset its budget. At most 16 grants may
be authorized for the lifetime of a pair. Reaching that limit denies further grants
without closing the pair. Authentication, one connection claim, bounded framing and
connection-attempt limits remain. One grant still has a maximum 120-second deadline;
held-open calls, native provider approvals, model delays and the review consume time.

The synthetic Tauri test and manually invoked synthetic acceptance script split replay
of an old grant from a request for a new native grant. The latter always opens a new
confirmation and cancellation cannot authorize it. They do not prove real provider
MCP connectivity, native UI acceptance, model execution or answer quality. The
script was not run as part of this change. For human acceptance, use a separately
authorized new package, opt both providers into MCP, confirm their tools are connected,
review a native grant, and correlate A → B → A task IDs and `completed` Core state.
Repeat only with a new native grant; record unavailable evidence honestly.
