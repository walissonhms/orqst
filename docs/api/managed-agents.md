# Private Desktop managed-agents boundary

This contract is implemented in `packages/protocol/src/managed-agents.ts` and
composed only by the [native Desktop view](../development/managed-agents-client.md).
It is not a REST/WebSocket/MCP API. The observer remains read-only.

## View opener

The observer preload exposes frozen `orqstManagedAgents`, version 1, with only
`open(): Promise<void>`. It checks transient activation; main verifies its exact
window/main frame/session, URL and native focus. The only effect is opening or
focusing the dedicated view. It cannot pass task, file, identity or proof fields.
The native menu offers the same view without granting a provider start.

## Dedicated document

The separate sandboxed preload exposes only frozen
`orqstManagedAgentsClient.request(request)`. Requests are strict version-1 objects:

| action     | Additional fields                                                        | Effect                                                                                            |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `snapshot` | none                                                                     | Read current owned-pair facts; no provider command                                                |
| `start`    | `slot`: 0 or 1; `model`: nonempty trimmed string, at most 128 characters | Native file selection on first start, complete manifest confirmation, signed new process/thread   |
| `delegate` | `text`: 1–2048 characters; `task`: 1–1024 characters                     | Separate native review of exact generated root prompt, B task, identities and 120-second deadline |
| `stop`     | `slot`: 0 or 1                                                           | Separate native confirmation of SIGTERM through the live owned handle                             |

All mutations require transient activation and native document/focus checks before
and after the dialog. Complete native confirmation text is capped at 4096 characters;
oversized manifests/plans are refused, never truncated or silently approved.
No renderer-selected path, executable, provider, cwd,
environment, target pane, correlation, signature, approval, resume or retry field
exists. A chooses only the exact B task/target authorized by the native plan; agent
content cannot issue native confirmations or enlarge its grant.

Replies have `status` (`ok`, `cancelled`, `busy`, `denied`, `unavailable`) and an
optional strictly validated `snapshot`. `ok` reports completion of the client
operation, never inferred completion of a provider task. A task submission returns
promptly; snapshots carry its later verified/unknown outcome.

Snapshots include project, two nullable slots, up to sixteen worker message facts,
and the latest root. Slots carry immutable instance/pane identity, lifecycle,
startup phase/failure, new native thread, reported model and availability. Messages
keep message/task/correlation/source/target IDs, independent delivery/task states
and nullable verified result text. Root state is `running`, `completed` or
`outcome_unknown`; completion requires the existing native delegation receipt and
root result. No provider account identity, credential, raw RPC/error or startup
payload is exposed. Results are untrusted inert text, never HTML or instructions.

## Private host and persistence

Electron main alone selects manifests and holds the ephemeral signing key. Its
pinned Node helper receives the public key over inherited local parent/child IPC;
there is no listener or token exchange. Strict bounded private messages expose
only preparation, signed launch/task/stop and snapshots. Startup/transport errors
reject without retry. Private metadata journals are new; existing databases are
rejected before Store opens. Exact-scope prompt/result content remains bounded in
memory and is never copied to the observer database or audit records.

A flushed owner-only admission marker in Desktop user data blocks replacement
across client lifetimes until known native exits and task outcomes permit release.
It has no timeout/PID takeover. Loss preserves uncertainty and never signals an
external process. Real-provider acceptance remains pending; no fixture or client
snapshot proves shared source preservation. See the
[security review](../architecture/security-model.md#structured-desktop-composition-review--2026-11-03).
