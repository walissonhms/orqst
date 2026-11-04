# Security model

## Live native terminal manifest selection — 2026-11-03

The Desktop application menu alone opens a parented native file chooser and a
Cancel-default full-manifest review. There is no new preload/IPC, renderer path,
HTTP, WebSocket, cookie or static-serving capability. Main binds the transaction
to the observer window/session/frame/generation and focused document (including
the trusted local offline page); blur permanently invalidates that review.
Navigation, destruction, 60-second expiry and source/config/blocker/inode drift
fail closed. Existing strict schemas, no-follow/canonical owner/mode checks and
executable hashes are reused. Oversized reviews are refused, never truncated.

Registration stores only memory, with no Core, journal, provider, reservation claim
or native-data access. An explicit Open revalidates and latches the selection
before the existing pair factory can create a Node Core/journals. The same Desktop
user-data admission domain remains authoritative; no state/profile reset, append,
adoption, capacity release or retry after initialization failure is introduced.
An existing startup-argv pair disables selection. New live selections require the
same provider across slots; existing MCP pair/workspace opt-ins and separately
signed task grants remain. Provider startup still uses the current native signed
broker. Blocked OpenCode manifests remain blocked, with no Core/journal.
All brokers are fenced until every window in the pair loads. Initialization failure
closes only its private router/Core connections and destroys partial windows while
preserving disk/admission evidence and the no-retry latch. No provider signal or
external-window cleanup is added.
Journals created before failure remain reserved and block reuse after restart;
absence of a provider dispatch is not an automatic journal-release permission.

Tests use temporary synthetic state and intercepted native dialogs/focus. They do
not accept human-modal visibility or real provider behavior. Same-user malicious
replacement races and lack of process/descendant containment remain disclosed.
The [startup investigation](../development/opencode-startup-safety.md) does not
establish an inference-free OpenCode launch. Native identity, sessions, databases,
quarantines and running external processes remain outside this change.

## Structured Desktop composition review — 2026-11-03

The [Managed agents client](../development/managed-agents-client.md) adds an explicit
native document over the existing signed runtime/communication contracts. The
dashboard preload can only open that view after transient user activation; main
requires the exact live observer main frame/session and native focus. It cannot
start a provider or grant agent authority. The dedicated sandboxed document has its
own memory-only session, no Node/network/navigation/window/download permission,
strict versioned request/reply schemas, and a separate preload. Mutations require
transient activation, exact current frame/generation/session and native focus both
before and after a complete native confirmation. Native-selected manifests never
arrive from page fields. Main alone signs short-lived one-use Ed25519 challenges.

A pinned Node helper owns new private SQLite metadata and the existing process
handles. Existing journals are rejected before Store opens; no observer DB is
opened/migrated. Results use exact-scope bounded memory and inert text. Closing
happens without reclaiming uncertain process capacity: a flushed private admission
marker in Desktop user data blocks another pair across app lifetimes until
explicit signed retirement verifies every dispatched native exit (or proves no
process was dispatched) and valid terminal
and communication owners. This is distinct from task outcome: unknown remains
unknown. Original admission/process/task metadata is flushed to an exclusive
retirement preparation archive before fencing, then the runtime is fenced before
process capacity is released;
results/prompts remain memory-only. Archive and directory sync precede removal of
the active marker. Archive failure leaves ownership intact for another native
review; failed finalization can only reuse the same verified archive and marker
after fencing, never retrying provider work. Failed/partial archive attempts are
preserved; archive preparation alone never proves completed release. A changed
owner or invalid archive cannot authorize a new process. Previous-lifetime markers, crash and ownership loss have no automatic or
manual client reset; owner evidence reconciliation is still required. There is no
TTL/PID takeover. Closing
hides the live view; document/transport loss disconnects with uncertainty and no
implicit signal. No resume, retry, PID adoption or journal reset exists. Native
shared auth/config/MCP effects, advisory cost limits and lack of hard containment
are disclosed in the client and guide. A sticky lifetime indicator and native
menu/tray status remain available while hidden; hide explicitly offers stay or
continue, and quit acknowledges that disconnect does not stop providers. Native
retirement review uses the same activation/frame/session/focus/signature gates as
other structured actions; the legacy PTY broker rejects retirement challenges.
No HTTP, WebSocket, cookie or static-serving
security control changes. Real startup/delegation and external-source preservation
remain unaccepted; shared `history_changed` remains inconclusive.

## Passive CLI preflight — 2026-11-03

The developer-only [local CLI preflight](../development/local-cli-integration.md)
uses bounded PATH metadata and canonical executable paths, never provider commands,
credential/config/session content, Keychain lookup or inherited token injection.
Symlink launchers are discovery evidence only; later native admission still uses
the existing no-follow/hash/owner checks. A candidate is not authorization or proof
of identity, readiness, authentication or provider capability. The setup defaults
to no writes while isolated existing-auth reuse is unavailable. Legacy separate-login
provisioning/real acceptance require an explicit authentication choice. No observer
API, WebSocket, cookie, filesystem-serving or renderer authority changes.

## Current embedded Terminal exception — 2026-11-03

The [managed Codex Terminal](../development/managed-codex-terminal.md) is an explicit
Desktop opt-in, under the owner-selected native trusted/same-user contract. This
section supersedes the uncomposed-library description in the historical paragraphs
below. It does not broaden the observer, public API, WebSocket or observation cookie.
External sessions remain read-only and have no execution capability.

Electron main holds an ephemeral Ed25519 key bound to one dedicated document. An
independent pinned Node Core receives only its public key through a private inherited
parent/child transport; it owns grants, a separate private metadata journal, lifecycle
and PTYs. No enrollment socket or renderer signing API exists. Strict bounded RPC
exposes only existing supervisor methods, never arbitrary executable/cwd/environment,
prompt or resume parameters. Transport loss rejects pending calls without retries
and conservatively releases ownership. Desktop remains a database client. Input
leases/sequences and one-use operation signatures retain their existing scope.
Both native processes use the trusted OS clock for short shared expiry; clock
changes are not a hardened time boundary.

Setup creates new state only, outside the project, with private homes/config/auth
storage and no credential/session imports. Canonical paths, no-follow reads,
owner/mode checks and pinned hashes detect accidental drift before dispatch.
They do not close path-replacement races against malicious same-user actors, who
are outside this trust model. The admitted provider/user retain OS user privileges.
Codex sandbox/approval flags are startup defaults, not immutable ORQST enforcement.
CPU/RSS/descendants are not hard-contained; container/VM is a separate backend choice.

xterm runs in a separate sandboxed document, preload and memory-only session. Only
fixed local HTML/script/CSS requests are accepted; permissions, navigation, downloads,
remote connections and window opening are denied. Output is terminal text, never HTML.
OSC clipboard/title/link effects and automatic terminal replies are disabled.
Trusted keyboard events and separately native-reviewed exact paste are input paths.
Bounded output parsing precedes the next read; a replay gap stops reconstruction/input.
xterm dynamic styles require inline CSS in this document; script/observer policies
remain unchanged.

The owned PTY host's 30-minute TERM/5-second KILL lifetime is disclosed in native
start consent. Closing the view hides it; quit/loss never implicitly signals from
journal data. Detached hosts retain the original deadline. Survivor adoption,
stored-PID signaling, automatic resume/retry, lost-slot release, structured delegation
and multi-agent result delivery remain absent. Synthetic acceptance is scoped;
real provider and human-modal acceptance require separate authorization.

## Historical observer and engineering-library baseline

The experimental [owned terminal library](../development/terminal-owned-lab.md)
is not composed into the application. Its signed one-use grants and leased,
sequenced owned-handle I/O are tested with in-memory doubles and an explicit
synthetic fixture. No native gesture/signing service, enrollment, IPC, execution
endpoint or production recovery is implemented. The later optional
[metadata journal](../development/terminal-recovery.md) provides synthetic-tested
epoch recovery outside normal startup. Existing read authentication
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
- Only exact `/`, `/overview`, `/workspaces`, `/agents`, `/models`, `/artifacts` and `/settings`
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
admit only the configured IPv4 loopback origin, root, six exact view paths and
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

## Opt-in terminal journal review — 2026-11-03

The [experimental recovery library](../development/terminal-recovery.md) uses the
existing Store writer, owner-only database permissions, feature-scoped schema and
strict metadata-only records. Normal Core/Bridge/Desktop and the native lab do not
open it. No API, WS, cookie, static-file policy, credential or external-session
authority changes. Signed native operation grants are still required; epoch
ownership is an additional fence, not authentication or consent.

Admission is committed before backend start and checked atomically across retained
uncertain work. Synchronous effects serialize with owner replacement; foreign
uncommitted transactions are refused. Explicit recovery changes only durable facts
and the owner epoch. It cannot grant attachment, signal a PID, adopt or retry work.
Pending preparations fail; previously started work stays ownership_lost even after
late callbacks. Retention removes only old reconciled terminal records, never lost
ownership. Storage errors revoke local effects without claiming that side effects
were undone. Synthetic crash/restart evidence is not production containment,
immutable executable/cwd admission, provider credential isolation or live recovery.

Revoking/destroying the native Terminal document also disconnects the dedicated
Core channel. Core then revokes its enrolled public key and closes its journal;
revocation is not confined to Electron's local signer. A normal view hide only
revokes input, preserving that live document/Core. Proposed xterm APIs are disabled.

## Artifact source-library review — 2026-11-03

The shared route allowlist adds exactly `/artifacts`, with no arbitrary subpaths or query
parameters. Bridge serves the same static bundle; Desktop retains exact origin/frame,
sender/document and lifecycle revocation checks. No API/WS/authentication or native grant
is added. The library uses existing bounded event reads, validates each page and offers
only valid retained Codex message selections within extraction limits. Search/content stay
in renderer memory; excerpts and provenance stay inert plain text. Opening a source uses
the existing session navigation and independently identity-checked extraction contract.
Capacity, partial coverage, stale/offline/error data and retention remain explicit. See the
[contract review](../api/artifacts.md#source-library-security-review--2026-11-03).

## Experimental structured communication boundary

The optional Core library has no public API, socket, IPC or MCP transport and is not
constructed by observer startup. Trusted composition alone may register ownership,
issue/revoke clients and enroll structured adapters. Private clients scope actor,
workspace, source/targets and expiry; observation cookies and provider output cannot
create authority. Content resolution must authorize the exact scope and is limited
to opaque local IDs with byte/hash validation, without a file/URL implementation.
Provider evidence must match task/message/correlation/attempt and managed instance/
epoch. Queue admission never implies execution; uncertainty blocks unsafe retries.
Recovery fences old writers and does not restore grants or adopt processes. Existing
HTTP/WS protections and external read-only boundaries are unchanged. No runtime
activation or real-provider security claim follows from synthetic tests.
See [the threat boundary and missing gates](../api/pane-communication.md).

## Structured Codex existing-login boundary — 2026-11-03

The explicit developer-only structured path can keep the native user HOME and
CODEX_HOME. ORQST checks directory metadata, never reads or copies authentication
files, accesses Keychain, forwards inherited secret environment variables, starts
login/logout or resumes/adopts existing sessions. The native executable alone
loads/refreshes its login. `account/read` uses `refreshToken:false`; only supported
login availability is retained, never account identity/plan fields. Missing or
unsupported login prevents thread/task creation. Threads must confirm ephemeral
mode and the exact requested model; new manifests require shared-config
acknowledgment and are denied by the legacy PTY profile builder.

Per-slot SQLite/log/temp state and metadata journals do not isolate the shared
native auth/config/skills/cache/requirements roots. Native configuration can start
MCP servers; an empty table override does not disable them. ORQST does not inspect
full native configuration responses that could contain secrets. Native overrides
request disabled hooks/remote-plugin-catalog/shell-snapshots/history/telemetry and no inherited shell environment,
but are not hard containment or a guarantee of zero native shared writes. Config
and binary trust are same-user. No HTTP, WebSocket, cookie, static-serving or
normal-startup authority changes. See the [full contract](../development/local-cli-integration.md).

A read-only same-user agent can still read credential paths; native MCP tools are
not constrained by the command sandbox. Prompt restrictions and rejection of
unexpected native tool items in acceptance do not prevent those effects. The
slot config is only an admission canary for reuse, not the native active config.
Remote catalog disabling does not disable every installed plugin. Shared auth
refresh can race other CLI instances; ORQST never closes them to avoid a race.

Structured startup diagnostics are allowlisted local phase/reason/method labels,
not native error payloads or account/configuration fields. IPC backpressure does
not authorize retransmission; queued writes retain a 512 KiB budget. Diagnostic
visibility does not restore lost authority, release journals or establish process
exit. Uncertain historical state stays quarantined pending a separate reviewed
reconciliation decision; absent OS listings are not exit evidence.

## Future structured lifecycle receipt review — 2026-11-03

The explicit structured backend creates a private exclusive receipt before fork,
syncs its directory and inherits only its descriptor to the host. The host syncs
lifecycle metadata before IPC and continues after disconnect. Bounded read-only
inspection checks identity, ordering, permissions and file type; it never opens
journal ownership or grants process authority. No credential/content/PID is stored.
Signal-only exits preserve the observed signal without fabricating a code. Feature
journal schema 2 fences old writers, preserving existing lost reservations and
attempt metadata. No public API, WebSocket, cookie or static-serving path changes.
Same-user tampering, storage/host failure, hard containment and descendant cleanup
remain outside this evidence guarantee. Earlier lost attempts cannot be repaired
retroactively. See [the detailed contract](../development/codex-lifecycle-receipts.md).

## Structured startup counter review — 2026-11-03

Future explicit starts expose bounded private in-memory byte/callback counters at
parent, host, pipes, IPC and parser boundaries. Stderr is drained and discarded;
only its byte count is retained. Its optional read errors are discarded locally;
stdin, stdout, IPC and receipt errors retain their own handling. Replacing the old
`/dev/null` sink with a pipe permits native `EPIPE` if the host dies first. Diagnostic
frames share IPC contention with data/lifecycle frames, so backpressure is not
evidence exclusively of data pressure. Strict versioned host metadata excludes payloads
and extra fields; malformed diagnostics cannot revoke or restore authority.
Counters are sampled, saturating and frozen at startup outcome, not durable proof
of native parsing or cleanup. No public API, observer access or ownership policy
changes. Historical timeouts remain unproven. See [the counter contract](../development/codex-startup-diagnostics.md).

### Native focus refusal feedback — 2026-11-03

The private managed-agents opener returns bounded status acknowledgments; the
current authorized terminal document can receive `focus_required` before signing.
The dashboard displays localized refusal feedback and supports older void-returning
version-1 preloads. These replies expose no paths, keys, prompts or provider facts.
Sender/session/main-frame/generation and native window/content focus gates remain
required. Invalid document identity remains denied; no renderer focus command,
automatic retry or post-dialog focus override is added. Native reopening restores
a minimized live view and requests focus without granting execution authority.
REST, WebSocket, observation cookies, static serving and journal/recovery policy
are unchanged. Active OS focus/modal acceptance remains unvalidated.

### Native interactive pair admission

The explicit checkout PTY client routes a single restricted Electron IPC channel by
native main-frame identity to at most two independent documents. Renderer slot or
instance claims cannot select another document's broker. A single private Node Core
owns separate per-slot supervisors/journals; the observer HTTP/WebSocket/cookie is
not an execution grant. Existing-login PTY remains blocked. The PTY and structured
surfaces share a sticky reservation, claimed after signed start admission. Signed
retirement requires all dispatched owned exits and fences both slots before releasing
only the unchanged marker; old/lost ownership is never reconciled automatically.
Metadata-only PTY receipts use an exclusive private file and inherited descriptor;
receipt or IPC failure is uncertainty. Native same-user execution is not hard
containment or protection from a malicious process running as the same OS user.

### Experimental per-instance MCP transport

The explicit synthetic library can create per-role Unix sockets, mode `0600` in a
new canonical `0700` directory. It binds no TCP/HTTP port and is absent from observer
startup, Bridge and provider invocation. Independent capability secrets live only in
private single-link files and the private stream, never argv/environment/diagnostics.
The relay validates capability/socket path, owner, permissions and identity; frames,
connections, attempts, pending calls and deadlines are bounded. An enrolled native
signature binds the exact source/target/epoch and one-use delegation scope. The
worker can wait/submit only for its fixed task; transport loss is unknown task outcome,
never process exit or permission to retry. No MCP method writes task text into a PTY.
Same-user malicious replacement is outside this contract. See the
[security review and provider gates](docs/development/interactive-cli-mcp.md).

### Explicit Codex native-login PTY profile

A new manifest-only opt-in acknowledges shared native session writes independently
of structured reuse. Native start still needs the unchanged focused, document-bound
confirmation and signed one-use launch. Reuse exposes no separate-login profile;
ORQST never reads/copies credentials. HOME/CODEX_HOME and native config/MCP/session
roots remain shared, and native credential refresh/new session writes are possible.
No resume/adoption or initial task is supplied. Private SQLite/log/temp paths and
read-only/on-request startup defaults do not provide hard containment. This path has
synthetic evidence only; it does not claim real-provider or per-instance MCP acceptance.

The PTY IPC router validates document/schema before returning `focus_required` for
unfocused mutations; it prepares no grant on this path. Window reopening requests
focus but cannot authorize work. The sender predicate and post-modal checks are
unchanged. Locked-console detection exists only in the explicit developer acceptance
script, not in the trust boundary. No new Bridge/API, WebSocket or network listener
is introduced. Existing journals, quarantines and external sessions are preserved.

### Desktop per-instance MCP composition review

The explicit `--interactive-mcp` PTY opt-in uses one disposable pair hub with
distinct per-role capabilities and no task authorization during startup. Launch
manifests bind each pinned relay and its endpoint paths. Native-only inherited RPC
prepares/confirms the later grant against two actually dispatched, owned running
UUIDs in one workspace/epoch. The renderer, Bridge and observation sources cannot
enroll, sign, select identities or authorize tasks. Handle loss/disposal/exit and
authenticated disconnect invalidate the exchange without inventing an exit or
releasing uncertain process capacity. There is no PTY task injection or retry.

The additional random Codex MCP table merges with native MCPs; no native config is
written. Paths are visible in argv, generated capability contents are not. Relay
startup is required and can block TUI startup. Filesystem/hash checks remain a
native same-user contract; shared auth/config/session writes, provider permissions
and malicious same-user races are not hard containment. Synthetic composition and
independent QA do not establish installed-provider or human-focus acceptance.

## Explicit Claude native launch — 2026-11-03

The separate Desktop native surface now accepts an exact-version/hash Claude manifest.
Shared native identity/configuration/session writes require acknowledgments; optional
strict MCP requires a distinct acknowledgment because it excludes native MCP definitions.
Native start/focus/proof, private IPC, last-boundary hash checks, sticky admission and
one-dispatch session UUID fencing preserve the owned-process boundary. No credentials
are read/copied by ORQST, and no observer endpoint gains execution authority. Native
CLI hooks/plugins, policy, credential refresh and state writes remain provider-owned,
without hard containment. OpenCode launch stays blocked. See the
[security review and acceptance limits](../development/claude-interactive-terminal.md#validation-scope-and-security-review).

## OpenCode Desktop explicit native startup opt-in — 2026-11-03

The [Desktop factory](../development/opencode-desktop-terminal.md) now accepts
a hash/version-pinned OpenCode 2.2.5 standalone manifest through private native RPC.
Review manifests are blocked before Core/journal/admission; explicit startup plus
migration/activity acknowledgments and a signed focused start grant are required.
HOME/XDG/DB selectors stay native; ORQST never opens/copies native credentials or DB.
The CLI itself may write shared SQLite/WAL, permissions, migrations and credentials
and execute native startup plugins/hooks/MCP/provider activity. Ledger and pending
migrations are unknown. Only TUI lifecycle has synthetic evidence; descendant exit
and concurrent native DB access are unvalidated. Capacity retirement is refused
for OpenCode selections. No observer API/WS/cookie/static changes or global config
writes; no real startup, DB inspection or inference occurred in this increment.

## Embedded Terminal panels — 2026-11-03

Interactive terminals share the main native window through separate
`WebContentsView` documents, never dashboard iframes or shared preloads. Each
retains its private session, exact frame/generation binding, local resource
allowlist and sandbox. The native broker verifies the view's WebContents plus
parent-window/view focus and visibility. Switching views or hiding revokes input;
view reload/crash/destruction closes that broker. The layout-only IPC accepts no
process operation or authority. Observation cookies and the dashboard preload
remain ineligible for execution. Core/PTY/native authentication and MCP policies
are unchanged. See [review and limits](../development/embedded-terminal-panels.md).

### Studio layout boundary (2026-11-03)

Terminal A/B navigation, orientation, maximize/restore, focus and proportional resizing
use the same dedicated terminal sender validation. Main accepts a fixed action
allowlist or an exact 25–75 integer percentage, binds the source slot natively and
requires the current reserved frame/session/generation plus visible native focus.
The observer preload and public HTTP/WebSocket remain unchanged. Layout notifications
contain only orientation/proportion/visible slots/count. Layout actions revoke input
leases and never grant execution, start a provider, restore a process, stop a task
or rewrite session data. Tab labels come from reviewed manifests, not provider output.

## Native pair provisioning and pre-Core recovery — 2026-11-03

The [creation wizard](../development/cli-team-recovery.md) expands only trusted
Electron main-process file selection/provisioning. Parent-bound native focus,
document generation, five-minute preparation and 60-second final consent, complete
bounded review, exact binary pins and O_NOFOLLOW/canonical checks precede new private
state. Source identities and empty project are revalidated before publication.
No renderer/IPC/HTTP creation method is exposed. Existing shared native identity is
selected without reading/copying credentials or configuration. OpenCode startup stays
blocked. Orphan staging is preserved inert; admission is untouched by creation.
Fresh volatile session partitions are allocated per opening attempt; failed-session
protocol handlers are removed before the no-effect proof. Only a typed failure
after complete cleanup with no admission/Core entry can unlock
a fresh review. Unknown effects/reservations, structured/PTY state separation and
the existing same-user threat model remain intact. Native capacity feedback reveals
no sensitive paths and authorizes no reconciliation. No observer boundary changed.

## Reviewed native CLI tool PATH — 2026-11-03

New Desktop terminal manifests may contain an explicit `toolPath`, derived by the
same passive canonical directory policy used for CLI discovery. The native creation
review discloses the common PATH once; both private manifests persist its exact
value. Root/current-user directory ownership, no group/world write bits, trusted
ancestors, device/inode deduplication, 128-directory/32-KiB bounds and repeat
validation precede dispatch. Empty/relative/NUL environment entries and unsafe environment/installer directories
are excluded, not converted into cwd lookup; explicitly selected directories block
creation when unsafe or unavailable; unsupported metadata/budget truncation
blocks creation. A canonical PATH target containing its delimiter is excluded.
Unsafe exclusions and env/fallback origins are visible in developer preflight.

This expands the local tools a native CLI or its MCPs/hooks can resolve. Those
subordinate tools are not individually hash-pinned or contained: the native
same-user trust contract still applies. The provider and private Node host keep
canonical absolute paths and SHA-256 pins; no API keys, loaders, shell profiles or
arbitrary environment variables are inherited. No shell/login/version/provider
probe, credential/configuration read, public API/WS/cookie change or new task grant
is introduced. Old manifests keep the fixed system PATH. Native identity/session
acknowledgments, Claude's exact reviewed pin and OpenCode's startup/database/activity
consent remain separate. See [runtime comparison and limits](../research/native-cli-runtime-comparison.md).

### GUI PATH precedence and path-only launch identity

For a GUI-minimal system-only PATH, reviewed selected native executable directories
precede installer fallbacks and system stubs. A custom absolute PATH preserves its
explicit order. The complete result is disclosed before provisioning. Unsafe
environment/installer entries can be excluded with diagnostics; an unsafe, missing,
noncanonical or unrepresentable explicitly selected directory blocks creation with
a safe reason. Bounds remain mandatory.

Current canonicality, ownership and permissions are checked again on manifest read
and child environment construction. Device/inode snapshots protect only creation
review-to-provision, not later launches: only the PATH string is persisted, so a
trusted replacement at the same canonical path is not detected. Native provider and
Node hashes are separate content pins; subordinate tools have no continuity or hash
guarantee. Drift diagnostics are specific but path-free. Existing same-user trust,
provider consent, environment whitelist and no-auto-retry boundaries remain.

## Fresh native selection after signed retirement — 2026-11-03

The Desktop selection latch now resets only after the existing signed Core retirement
success, verified owned exits, archival/fencing/capacity release, destruction of every
old view, action/router/IPC/protocol cleanup and confirmed Core exit. Cleanup uncertainty
keeps the latch closed. Closed journals, lost ownership and unknown reservations cannot
be reclaimed; a late exit receipt does not repair ownership. New selections use fresh
identities/state; no journal reset, PID adoption or signal to an unknown process exists.
OpenCode descendant retirement remains refused. Two-cycle Electron acceptance uses only
synthetic processes and intercepted dialogs/focus, not native-provider acceptance.

A separate Cancel-default OpenCode creation review explicitly names shared SQLite/WAL,
permissions, possible migrations, credential refresh and configured native startup
hooks/plugins/MCP/network/provider activity. Only its checked affirmative choice adds
the existing three startup acknowledgments to a fresh manifest, followed by a second
complete review. Generic CLI/login consent is insufficient. This flow starts nothing;
real native effects were neither authorized nor run. Focus/expiry and later signed
start/task gates remain. Filesystem roots are now refused as tool PATH entries.
No HTTP, WebSocket, cookie, static-serving or environment-whitelist authority changes.
