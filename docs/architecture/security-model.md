# Security model

The experimental [owned terminal library](../development/terminal-owned-lab.md)
is not composed into the application. Its signed one-use grants and leased,
sequenced owned-handle I/O are tested with in-memory doubles and an explicit
synthetic fixture. No native gesture/signing service, enrollment, IPC, execution
endpoint, durable audit or recovery is implemented. Existing read authentication
and observer behavior are unchanged; laboratory signatures cannot establish native
consent or production execution safety.

The [managed terminal design](managed-terminal-design.md) proposes a future separate
native authorization and owned-process boundary; it is not an implemented execution
API. The opt-in [synthetic PTY probe](../development/terminal-pty-acceptance.md) runs
fixed disposable fixtures outside the runtime. It grants no control over observed
sessions and adds no API, IPC, credential, database or renderer capability.

ORQST runs on a developer machine and reads agent sessions that may contain
source code, prompts, tool output, file paths, and accidentally pasted secrets.
The security model is therefore conservative: local-only, read-only, minimal
data, and no implicit trust in captured content.

The sections through the initial review note describe controls in the current
code. The final planned-controls section records Phase 0 design requirements,
not implemented protections. This is not a security certification.

## Trust boundaries

The additive `GET /api/analytics/models` route uses the existing observation
authentication/trust checks and no-store/CSP headers. Its allowlisted response
excludes contribution evidence, source paths, event/session identifiers and captured
messages/results; it retains aggregate model labels and query metadata. Strict
query validation and fixed session/event/byte admission precede JSON inspection.
A separate read-only SQLite connection runs in a disposable Node worker, never
through a second Store/writer or a migration. WAL snapshots permit concurrent
ingestion; workers select only metric/identity/provenance fields and return only
the summary allowlist. Full contributions/provenance stay worker-local, one session
at a time. Existing file permissions and loopback controls remain unchanged.

One worker may run per bridge, with no queue, a 10-second watchdog and bounded
V8 heap. Success requires confirmed cleanup within the deadline. The watchdog
can return timeout while termination is pending; the slot remains occupied until
termination is confirmed. Disconnect/shutdown cancel the query, and shutdown awaits
a separate cleanup promise even after a timeout response. Budget/timeout/busy/cancel/
unavailable errors return no partial sums and no SQLite diagnostics or paths.
Native SQL cleanup and OS/event-loop scheduling can delay termination or the
watchdog callback; heap limits are not an RSS guarantee. No control authority, public
bind, telemetry or schema change is introduced. The unrestricted local library
report remains sensitive. See [route limits](../api/rest.md#get-apianalyticsmodels).
Synthetic API/worker tests exercise these controls; they do not certify arbitrary
archive performance, multi-user isolation or full data redaction.

| Boundary                      | Trust                                                                   |
| ----------------------------- | ----------------------------------------------------------------------- |
| Codex session files           | **Untrusted data.** Parsed defensively, never executed.                 |
| Dashboard input               | **Untrusted.** Validated with zod and bounded.                          |
| Browser page                  | **Untrusted origin** until Host, Origin, and cookie checks pass.        |
| Local network                 | **Not trusted.** The server binds loopback only.                        |
| Other OS processes            | **Outside the model.** Same-user processes can obtain a session cookie. |
| OS account and filesystem     | **Trusted.** Filesystem permissions are the access control.             |
| Dependencies and Node runtime | **Trusted via lockfile**, subject to normal supply-chain risk.          |

ORQST assumes one trusted OS user on a personal machine. It is not a multi-user
service, not a hardened server, and not designed for shared hosts.

## Network exposure

- The HTTP server calls `listen(port, '127.0.0.1')`. There is no option to bind
  another interface.
- The default port is `4317`; `ORQST_PORT` is constrained to `1024`–`65535`.
- There is no TLS. Traffic stays on loopback.
- Running ORQST behind a reverse proxy, in a container with a published port,
  or on `0.0.0.0` is unsupported. It would expose an API that has no user
  authentication beyond a per-process cookie.

## Request authentication

On startup the bridge generates a random 32-byte secret, hex-encoded, held only
in memory.

- `GET /api/bootstrap` sets `orqst_session=<secret>` with `HttpOnly`,
  `SameSite=Strict`, and `Path=/`.
- The cookie has no `Secure` attribute because the server speaks plain HTTP on
  loopback. It has no `Max-Age`, so it is a browser-session cookie.
- Every `/api/*` route except bootstrap requires the cookie. Comparison uses
  `timingSafeEqual` and a byte-length check.
- The `/ws` upgrade requires the same cookie.
- The secret is per process. Restarting the bridge invalidates all existing
  cookies; the dashboard re-bootstraps and reconnects automatically.

Bootstrap is intentionally unauthenticated because there is no user account.
Local processes, including those of other OS users, can request a cookie. That is
consistent with the single-user threat model and is called out as a residual
risk.

## Host, Origin, and cross-site protection

Every request must pass `trusted(request)`:

- the `Host` header must exactly match `127.0.0.1:<port>` or
  `localhost:<port>`; in development mode, the Vite hosts
  `127.0.0.1:5173` and `localhost:5173` are also accepted;
- if an `Origin` header is present, it must be `http://<trusted host>`;
- if a `Sec-Fetch-Site` header is present, it must be `same-origin`,
  `same-site`, or `none`.

The WebSocket upgrade is stricter: it requires a valid `Origin` in addition to
the cookie and a valid non-negative cursor.

These checks mitigate DNS rebinding (a rebound domain sends its own `Host`) and
cross-site requests (`SameSite=Strict` plus `Origin`/`Sec-Fetch-Site`). There is
no separate CSRF token; the combination above is the CSRF defense. JSON writes
also require `Content-Type: application/json`, which a simple cross-site form
cannot send.

## Input validation and limits

- Request bodies must be `application/json` and are limited to 8 KiB.
- Body size is counted while streaming; oversized bodies are rejected.
- Query parameters and bodies are parsed with zod:
  - `after` integer ≥ 0, `before` integer ≥ 1, `limit` 1–500,
  - `sessionId` ≤ 200 characters,
  - workspace `name` 1–100 and `path` 1–4096 characters,
  - workspace association ID 1–200 characters or `null`,
  - preferences must match the exact boolean schema.
- Server request and header timeouts are 10 seconds.
- WebSocket frames from clients are capped at 1 KiB (`maxPayload: 1024`);
  clients are not expected to send application messages.
- Slow WebSocket clients with more than 1 MiB buffered are terminated.
- A heartbeat pings every 15 seconds.

Invalid input returns a 4xx response; it never reaches SQLite unvalidated.

## Static dashboard serving

The bridge serves the built dashboard from `apps/dashboard/dist`.

- Asset request paths are URL-decoded and resolved under the dashboard root.
  Valid dashboard routes select the fixed index file before filesystem mapping.
- A resolved path outside the root is rejected.
- Any asset path segment beginning with `.` is rejected, as are NUL bytes.
- The canonical path is resolved with `realpath` and must remain under the root.
- The target must be a regular file.
- Only exact `/`, `/overview`, `/workspaces`, `/agents`, `/models` and `/settings`
  paths and `/overview/sessions/<encoded-id>` validated by the shared protocol
  schema fall back to `index.html`. Session segments must be canonical, bounded
  and free of separators, residual percent signs, controls and dot-only values.
  They select the fixed index file, never a source/static path. Unknown
  extensionless/nested routes, trailing-slash aliases and noncanonical route
  spellings fail. Assets retain the existing containment/realpath checks.
- Only a small MIME allowlist is used; everything else is
  `application/octet-stream`.
- If the bundle is missing, the response is `404 {"error":"dashboard_not_built"}`.

Static assets are served without the session cookie, because the browser needs
the shell before bootstrap. They are still loopback-only and contain no user
data.

## Response headers

Every response sets:

```
Content-Security-Policy: default-src 'self';
  connect-src 'self' ws://127.0.0.1:* ws://localhost:*;
  img-src 'self' data:; style-src 'self'; script-src 'self';
  frame-ancestors 'none'; base-uri 'none'; object-src 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Cache-Control: no-store
```

`connect-src` permits loopback WebSocket connections on any port because the
dashboard may connect through the Vite dev proxy. It does not permit external
hosts.

## Source-file access

The Codex observer treats the session root as a hostile input directory:

- recursive walk limited to depth 5;
- only regular files ending in `.jsonl` are considered;
- symlinks are skipped during the walk;
- each file is opened with `O_NOFOLLOW`;
- the canonical path must remain inside the canonical session root;
- files are opened read-only and never written, renamed, or deleted;
- each file is read with a fixed 8 MiB budget per scan, so a huge history
  cannot starve active sessions;
- lines longer than 2 MiB are discarded and counted, then reading continues;
- malformed JSON lines are counted and skipped;
- only complete, newline-terminated lines are processed;
- checkpoints are committed only after complete lines are handled.

This prevents path traversal through symlinks, unbounded reads, and a single
corrupt line blocking later events.

## Data minimization and redaction

Before text is stored:

- `safeText` extracts strings or content arrays, caps them at 32,000
  characters, and runs `redact`.
- Redaction removes common shapes: PEM private keys, `sk-` keys, GitHub tokens,
  Slack tokens, AWS access key IDs, `Bearer` tokens, JWTs, `password`/`secret`/
  `token`/`api_key` assignments, and credentials embedded in URLs.
- Raw logs, encrypted reasoning, account/identity fields, and environment or
  configuration blocks are not copied into SQLite.
- Captured text is rendered with React text nodes and `<pre>`; it is never
  interpreted as HTML or Markdown.

Redaction is pattern-based. It cannot guarantee removal of every secret,
especially unusual formats, secrets split across records, or secrets encoded in
ways the patterns do not recognize. Users should still avoid pasting secrets
into agents.

## Filesystem permissions

- `process.umask(0o077)` is set before the store opens.
- The data directory is created with `0700` and forced to `0700`.
- The database file is forced to `0600`.
- Symlinked data directories and database files are rejected.
- WAL and shared-memory files inherit the directory permissions.

There is no encryption at rest. Anyone who can read the files as the OS user or
root can read the database.

## Browser features

- Sound is generated with the Web Audio API only after a user gesture. If the
  browser blocks or suspends audio, the dashboard says so instead of claiming a
  sound played.
- Browser notifications are used only when the Notification API exists and
  permission is `granted`. Denied or unavailable permission produces a visible
  notice.
- Notification preferences are stored locally and gate which live events alert.
- Imported history never raises an alert.

## What is not protected

- Same-user local processes obtaining a session cookie.
- A compromised browser, extension, OS account, or root user.
- Plaintext storage of captured prompts and tool output.
- Perfect redaction.
- Public network exposure.
- Denial of service by a local user.
- Supply-chain compromise of npm packages, Node, or the OS.
- Any future feature that renders Markdown, follows links, or executes tools.

## Security-sensitive change checklist

Review any change that touches:

- the HTTP server, routing, or static file handling;
- the WebSocket upgrade, cookie, Host, Origin, or fetch metadata checks;
- path resolution, symlink handling, or file opening flags;
- redaction, text limits, or what is persisted;
- the database file location, permissions, or migrations;
- dependency additions;
- anything that would send data off the machine.

A change in these areas needs a short security note in the pull request
explaining the new trust boundary and why the control still holds.

## Reporting

See [SECURITY.md](../../SECURITY.md). Do not open a public issue for a
vulnerability.

## Review note — initial implementation

The local trust boundary was checked for missing cookies, disallowed origins/fetch metadata, invalid query/body input, dotfile access and WebSocket authentication. The implementation uses byte-length checks before constant-time cookie comparison, contains static assets under the canonical build directory (including macOS `/tmp` canonicalization), rejects malformed upgrade URLs, handles WebSocket protocol errors and bounds buffered data. Browser checks confirmed captured markup is displayed as text.

These are scoped checks, not a penetration-test certification. Loopback bootstrap can be called by any local process, including processes of other OS users; the app is intended for a trusted single-user machine. Redaction, browser permissions and plaintext SQLite limitations remain as documented.

## Planned controls — Phase 0 design only

See [ADRs 015–024](decisions.md), [lifecycle contracts](../api/lifecycle-contracts.md)
and [ROADMAP](../../ROADMAP.md). No control API, Electron renderer, terminal,
permission store, secret backend or remote transport is introduced in this phase.

| Future boundary                      | Required control before implementation                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Observation to managed execution     | Explicit managed ownership, supported operation and Core-authenticated principal; observation cookie alone is insufficient                     |
| Client to Core                       | Validated versioned request, resource scope, expiry, revocation and idempotency; default deny for control                                      |
| Electron renderer to privileged code | Isolated/sandboxed renderer, no Node integration, narrow preload methods, sender/argument validation, restricted navigation and external links |
| Core to process/PTY                  | Authorized executable/arguments/cwd/environment and resource bounds; user privileges and provider sandbox/approval policies remain in force    |
| Agent to agent                       | Structured task protocol, durable admission, scoped delegation, bounded depth/fan-out/concurrency/budget and uncertain-effect reconciliation   |
| Session resume or reboot recovery    | Check native session availability, ownership and active process identity; do not blindly repeat uncertain commands                             |
| Credentials                          | Headless-compatible OS secure storage; no secrets in renderer state, events, native-history copies, logs or delegated payloads                 |
| Local content to remote client       | Explicit pairing and grants, end-to-end protection and revocation; no public exposure of the current observation bootstrap                     |
| Relay/control plane to persistence   | Explicit metadata allowlist; no code, conversation, session/terminal content or payload-bearing diagnostics in Cloud stores/logs/backups       |

Terminal output, model replies, task results, adapter events and native history
remain untrusted data. Their contents cannot authorize commands, resolve provider
approvals or expand grants. A terminal emulator is not a security sandbox and a
validated request does not replace OS/provider enforcement. Never run a terminal
service as root to bypass user permissions.

Revocation must be checked on admission and execution. Undispatched operations
must stop; active-work cancellation requires an explicit tested policy. Bind
approval responses to the exact provider request, task/attempt and resource;
transport acceptance is not proof that an approval or command was executed.

A future Core must not require Electron to keep credentials usable when the UI
closes. Select and test an OS backend for its actual headless/user-session
context; reject insecure/unavailable secret-store fallbacks rather than silently
storing plaintext. No backend or cryptographic protocol is selected here.

Data minimization must cover summaries, task inputs/results, terminal buffers,
source references and cached excerpts, not only complete transcripts. Any change
to existing copies/retention requires an approved migration and backup policy.
Redaction does not authorize a Cloud upload or satisfy the no-content-storage
requirement. See [Cloud privacy](../commercial/cloud-architecture.md).

Before release of any future control capability, test denied/expired/revoked
scopes, stale approval IDs, invalid IPC origins, malformed/version-mismatched
requests, duplicate/reordered delivery, unsafe source references, disconnection,
process exit, recovery and uncertain results. Document scope and limitations;
architecture approval is not evidence that these controls have passed.

## Review note — durable Analytics evidence

Schema 2 adds an explicit SQL allowlist for metric/model observations and provenance;
no full envelope or arbitrary payload enters the compact table. It excludes prompts,
messages, tool arguments/results, cwd and credential blocks. Observed labels, IDs,
source paths and hashes are still untrusted sensitive local metadata, retained without
automatic expiry alongside canonical totals. This is not secret-proof storage or a
transcript cache. Existing detail/summary/backup policies are unchanged. No source
access, external transport, telemetry, new endpoint or permission is introduced.

Only Store migrates/writes. Backfill and schema version commit atomically; failure
rolls back, closes the connection and leaves the previous version retryable. It reads
only surviving event rows and never reconstructs previously expunged provenance.
Worker connections stay read-only/query-only, support schemas 1/2 explicitly and
retain budgets/deadline/cleanup. The summary allowlist still strips individual
evidence, source paths and captured content. No source file or installed database is
modified during development checks. Installed upgrade needs review, backup and tests;
there is no destructive downgrade or automatic rewrite of backups.

## Local lifecycle/reference projection review

The additive Phase 1 schemas and Core queries validate numeric version and bounded
sequence before reading one retained event. Strict allowlists exclude captured bodies,
result excerpts, tool input/output and cwd; fixed error messages expose no validation
input or path. Invalid identity/provenance fails closed. Source references remain
sensitive untrusted metadata and are explicitly not rechecked; shape validation is
not filesystem containment verification or permission to open a path. No source-root
grant, file access, rendering, export, endpoint, authentication change or control
capability is introduced. Existing source-read-only protections, v1 transports and
single-writer persistence are unchanged. Provider control and future dereferencing
require their own evidence and security design.

## Initial Electron observer client review (before tray increment)

Historical scope: the statements below describe that increment before native file
export. The subsequent [native Markdown boundary](../api/artifacts.md#native-desktop-save-contract)
adds one isolated preload/save IPC channel and explicit destination authority; the
earlier absence of those capabilities is not a claim about the current client.

The macOS checkout client is a separate unprivileged HTTP consumer of the existing
Bridge. It imports no Core/database and starts/stops no service or agent. Its renderer
has sandbox/context isolation/webSecurity enabled, Node integration disabled and no
preload, IPC or webview. An in-memory session disables cache; permission checks/requests,
device permissions, downloads, new windows, subframes and external navigation are denied.
A network allowlist restricts requests to the selected IPv4 loopback origin and `/ws`;
configuration accepts only a bounded integer port. Captured content and local-listener
responses remain untrusted. The fallback protocol serves only fixed localized escaped
text with `default-src 'none'`; it exposes no filesystem or privileged bridge.

No cookie/header rewriting, CORS exception, authentication bypass or CSP relaxation is
introduced. The same trusted-local-user limitation applies: bootstrap is not proof of
server identity, encryption or authority for agent control. The initial window slice had no filesystem content API, shell opening, native
notifications or execution. The later native alert boundary is reviewed below. Closing/quitting it cannot
stop or preserve a crashed Bridge; observation belongs to that independent process.
Electron has its own bundled runtime and no SQLite/native-addon ABI dependency here.
Packaging, fuses/signing/notarization, updates and native permission flows require a
separate distribution review; the checkout command is not a signed release. See
[Desktop development](../development/desktop.md) for setup/version sources.

## Tray/native notification review — 2026-11-02

Historical scope: the statements below describe that increment before native file
export. The subsequent [native Markdown boundary](../api/artifacts.md#native-desktop-save-contract)
adds one isolated preload/save IPC channel and explicit destination authority; the
earlier absence of those capabilities is not a claim about the current client.

The Desktop main process now reads only the fixed bootstrap/snapshot routes through
its existing in-memory Electron session and authentication cookie. No REST/WS shape,
Host/Origin check, CSP, cookie policy, loopback allowlist or Core/SQLite ownership changes.
Fetches reject redirects and have a five-second timeout and 8 MiB streamed-body limit.
Validated bounded projections and identity/source/status joins gate supported Codex
alerts; startup/reconnect/cursor reset/long pauses baseline without delivery. History
and source records never become renderer-supplied native payloads. Main-process native
text is fixed localized category text only. No OS errors/captured payloads are logged.

No preload/IPC, generic native notification method, filesystem access, agent control,
service management or new renderer permission is introduced. Clicks revalidate against
a fresh authenticated session list; a bounded hash can select only a current dashboard
session identity. Tray opt-in is process-local, while existing category/sound preferences
remain Bridge-owned. Native errors are surfaced without claiming delivery; macOS signing,
app identity, permission and Focus limitations remain explicit. OS delivery and packaging
require separate acceptance. The existing trusted-local-listener limitation still applies;
source shape validation does not re-open or authenticate a filesystem source. See
[Desktop details](../development/desktop.md).

## Manual Artifacts boundary review — 2026-11-02

Historical scope: this is the extraction/copy slice before native file export.
The subsequent [native Markdown boundary](../api/artifacts.md#native-desktop-save-contract)
adds the narrowly granted save/overwrite/open capability; pending language below
records the state at this earlier review.

The separate strict `orqst.artifacts` v1 contract adds a read-only authenticated POST
for one exact retained message. Every requested identity and source hash must match
the same validated event that supplies its reference and body. JSON/request limits,
Host/Origin/cookie/fetch-metadata checks, no-store and sanitized errors are preserved.
The 32768-byte UTF-8 content ceiling rejects oversized bodies without truncation.
No metrics/summary reconstruction, filesystem dereference, new writer or migration exists.

The panel renders untrusted strings only through React text nodes and fixed limited
block elements: no active HTML, anchors, media, remote loads or privileged renderer.
Drafts remain in memory and cannot mutate retained originals or sessions. Clipboard
writes require explicit gestures and failures are visible. No Desktop permission
exception, preload or IPC is added. File save grants/overwrite/editor authority remain
pending a separate review. See [contract and limits](../api/artifacts.md).

## Native Markdown destination boundary — 2026-11-02

The later Desktop Artifacts slice adds exactly one isolated preload method and one
IPC handler, `saveMarkdown` / `orqst:save-markdown`. Renderer sandbox, context isolation,
Node-off, CSP, network/cookie checks and deny-all browser permissions remain intact.
Main accepts no path/URL/executable/grant, reextracts source-backed original through the
fixed authenticated API, validates its full identity and bounds both UTF-8 text and
HTTP response. Draft text is explicitly separate untrusted content, never original.
Main validates live window/webContents/session/main-frame/origin/document identity;
navigation, close, crash and quit revoke pending operations. Transient activation in
the isolated preload is additional defense, not the authority. Only a native chooser
and concrete default-Cancel replacement warning grant file effects. One operation is
admitted without queueing or persisted/reusable grants. No Core/schema/service changes.

Main accepts `.md` only, canonicalizes the selected parent, bounds existing files to
32 KiB, rejects nonregular/executable/multiple-link/symlink targets and rechecks the
same descriptor, pathname, parent, timestamps and bytes after confirmation. New files
use `O_EXCL|O_NOFOLLOW`/0600; existing files are never opened with `O_TRUNC`. Cancellation
writes nothing. The only external-open operation is the same explicit Save-and-open
gesture, after verifying the freshly written file; its internal path alone is handed
to `shell.openPath`. No open-history/source path, arbitrary URL, shell string or chosen
executable exists. Files contain plain UTF-8 Markdown; content is not executed by ORQST.
The default application remains an OS choice, not a verified editor launch.

This is not atomic pathname CAS, atomic overwrite, crash recovery or isolation from a
noncooperating same-user writer. Descriptor checks prevent following substituted
symlink targets; observed changes fail closed. A local process can still race checks
or the OS handoff. In-place I/O failure can leave partial content and is reported as
`write_failed` without opening or automatic rollback. Main logs no file paths, payloads
or OS diagnostics. Browser clients state that native export requires Desktop; clipboard
denial remains unchanged. See [exact contract and limits](../api/artifacts.md#native-desktop-save-contract).

## Confirmed Live Metrics review

The additive local authenticated session-metrics GET uses strict identity/output schemas,
parameterized indexed reads, metadata admission before materialization and bounded output.
It reads no source file or captured body, adds no writer/IPC/control capability and keeps
existing Host/Origin/cookie/CSP/no-store controls. Invalid proof returns sanitized
unavailable reasons. Sensitive compact provenance stays local and inert in the UI.
See [security review and fixed query budgets](../api/live-metrics.md#security-review-note).

## Browser aggregate Analytics export review

The browser export projects only a bounded, runtime-validated aggregate response
associated with the current filters/cursor and connection generation. Actual response
bytes are capped before decoding/parsing; file admission and output have separate
limits and never truncate. Individual evidence and private query identities are
excluded. Arbitrary model IDs can still contain private information or secrets; a
visible warning precedes the gesture and no complete redaction guarantee is made.
CSV literal prefixes/visible encoding and typed large integers address formula and
rounding hazards; Markdown keeps dynamic text inside inert code spans with encoded
structural characters. External reprocessing can change interpretation. Browser
settings control destination/replacement and the UI does not claim disk-save success.

The later native increment adds one strict Analytics IPC and destination grant,
keeping routes/authentication/worker/database/source contracts unchanged. Electron
still denies downloads; its dedicated capability refetches/validates a bounded
aggregate and compares digest/query/version/cursor to the displayed reading before
and after native permission. Live context and document generations revoke pending
operations; context updates bypass the file-operation gate. Late acknowledgments
cannot revive an old reading. The fixed empty-events cursor query admits 4096 bytes
without retrieving sessions or captured bodies. HTTP/body deadlines are finite.

Only native dialog paths reach the shared destination writer, with exact format
extension, single-link/nonexecutable/size checks, descriptor/parent/path identity,
O_EXCL/O_NOFOLLOW and explicit concrete overwrite confirmation. Artifacts keeps its
own DTO/channel and 32 KiB Markdown grant. One operation is admitted across both;
Analytics has no external-open action or reusable grant. Filesystem writes and final
source validation are not one atomic operation; partial I/O and races remain explicit.
See [fields, exact encodings, native contract and review](../api/analytics-export.md).

## Partial session model history review

The authenticated additive GET reads only an indexed bounded compact-evidence window
on the existing Store connection. All row identities and provenance are validated before
any result; SQL size admission precedes metadata materialization. The output excludes
source paths and captured bodies; actual HTTP bytes are bounded before client parsing.
No cache/credential/source read, migration, new writer or process authority is added.
See [admission, privacy and client cancellation](../api/model-history.md).

## Observed usage evolution review

The additive `/api/analytics/models/evolution` read inherits aggregate authentication,
Host/Origin/fetch controls, one-worker deadline/admission limits and no-store headers.
It adds no writer, source-file reader, schema migration or Desktop grant. Runtime
schemas bound and reconcile at most 64 windows; individual evidence stays worker-local.
Aggregate query/model metadata keeps the existing privacy limits. See the
[contract and detailed security review](../api/analytics-evolution.md).

## Review note — retained tool evidence view

The session Observed tools view only projects already-loaded Codex tool events.
It adds no API, IPC, execution capability, process ownership or session adoption.
Output and arguments remain untrusted React text; terminal/direction controls are
shown visibly without an emulator or active links. Per-field and record-window
limits bound rendering, and each record retains its source reference. Historical
returns never prove process exit, success or current liveness. See the
[terminal boundary](../development/terminal-boundary.md) for unresolved managed
authorization, executable/argv/cwd/environment, lifecycle and PTY decisions.

## Experimental native terminal boundary — 2026-11-03

The [native terminal broker](../api/terminal-native.md) and Electron helpers are implemented but
uncomposed. No application IPC/API/control surface, observer permission or provider
capability is enabled. Strict requests, private exact-action signatures, native
sender/document/focus checks and lifecycle revocation have synthetic coverage;
actual native gesture, independent enrollment/transport, immutable admission,
containment and durable recovery remain acceptance gates. External sessions are
never adopted. Explicit supervisor teardown retains uncertain live ownership
without signaling, retrying or claiming process exit.

## Clean-route security review — 2026-11-03

The dashboard uses the existing History API, without a router dependency or new
API/IPC operation. Electron main-frame navigation and live sender authorization
admit only the configured IPv4 loopback origin, root, five exact view paths and
strict session-path schema listed above; query strings, credentials, other
ports/hosts and arbitrary paths remain denied. Legacy fragments carry no authority. Session selection still requires an
identity present in the authenticated Bridge snapshot. IPC continues checking the
expected live webContents, Electron session, exact main frame and current URL;
navigation still revokes pending native grants through the existing generation.

The Bridge's former generic extensionless fallback is narrowed to those protocol
schemas. Direct session entry/reload now sends the existing ID in its HTTP path,
as the existing session APIs already do. No request URL logging is implemented;
`Referrer-Policy: no-referrer` remains in force. URLs contain no new session
content or workspace paths and IDs must not be treated as anonymous. Legacy
identities unsafe for a path preserve their fragment form instead of being
rewritten to a fabricated identity. Static routes issue no authentication cookie
and expose only the bundle;
bootstrap, API and WebSocket cookie/Host/Origin/fetch-metadata checks, CSP and asset
containment are unchanged. Automated negative cases cover unknown/nested/encoded
paths, unauthenticated APIs and untrusted Host/Origin/fetch metadata. Native
Desktop close/quit/reload and native notification loads still bypass renderer
draft confirmation; no durable draft recovery is introduced.

## Isolated native Terminal acceptance application — 2026-11-03

Only the [explicit synthetic lab](../development/terminal-native-acceptance.md)
registers the native Terminal IPC/preload contract. Production observer main,
Bridge, API/WS/cookie/static-file controls, dashboard routes and external-session
permissions remain unchanged. The lab has a private session, exact three-resource
allowlist, restrictive CSP, no network and strict bounded request/reply validation.
Native sender/document generation is rechecked after asynchronous work; navigation
permanently revokes the broker and blur invalidates pending consent/input. Private
keys/proofs/leases stay outside the renderer. A separate Node host executes only a
fixed credential-free fixture; transport loss is uncertain ownership, never inferred
exit. The fixture's lifetime bounds are not a production process sandbox/recovery
policy. Real transport checks passed with intercepted dialogs; genuine human
consent, immutable provider admission, independent authentication, containment and
durable Core ownership remain gates before enabling Codex.
