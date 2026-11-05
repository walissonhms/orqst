# Security model

## Studio arrangement boundary — 2026-11-05

The layout-only `arrange` action is accepted only from the current focused native
Feature chrome, through the existing epoch, document, generation, membership,
metadata-review and Quit fences. Node checks exact current slot/terminal UUID
membership; Rust independently validates the viewport, insets, geometry, overlap
policy and back-to-front order before applying any Webview bounds. Hiding a Webview
never stops a process. Native first-responder checks, rather than renderer focus
claims, govern click-to-front; the notice and geometry channel are rate-limited.
No resize or ordering action grants keyboard input or process authority.

## Renderer unavailable presentation fence — 2026-11-05

Renderer termination sets an app-lifetime unavailable latch and invalidates the
existing metadata presentation before hiding children. Queued native layouts and
later surface raises deny presentation while latched; there is no reset/reload
path. Generation advancement, suspension and input revocation do not stop, adopt
or alter ownership of Core processes. Synthetic scheduling tests cover admission;
AppKit stacking and WebKit callback delivery require separate native acceptance.

## Offline administrative recovery — 2026-11-04

Administrative recovery cannot inherit a runtime key or owner epoch. Trusted
native composition must independently persist its Ed25519 trust anchor, display
the entire review and sign only its exact recovery-domain challenge. The fixed
native sysctl boot UUID must differ from the durably captured pre-boot UUID;
app restart, sleep, PIDs, descriptor absence and generic consent never qualify.

Source files are canonical/private, O_NOFOLLOW and identity checked; enumeration,
per-file/aggregate reads, writes and review are bounded. Original SQLite/SHM is
never opened through SQLite: committed WAL is checksum/salt validated and overlaid
into a private immutable derived copy. All preserved attempt states must remain
prepared, enrollments complete and owners/schemas/manifests logically identical.
Private raw captures may contain sensitive metadata; they are not logs, exports
or telemetry. Native same-user tampering/rollback and unpatched binaries are
outside this boundary. Gate hooks are deny-only and no production entrypoint is
connected. See [contract](../research/offline-reservation-recovery-contract.md)
and [API/durability limits](../api/offline-reservation-recovery.md).

## Integrated opening diagnostics review — 2026-11-04

The reviewed integration adds only optional local diagnostic projection: no observer HTTP/WebSocket execution authority, no content-bearing generic log, and no reservation recovery. The standalone runner verifies FIFO rejection and append failure in disposable fixtures. Native document/request/owner fences and public Stop remain intact. See [integration and machine-evidence boundary](../development/tauri-opening-diagnostics-integration.md).

## Tauri webview policy — 2026-11-04

Supported new browser permission requests are denied by the global native callback;
browser downloads are rejected in all four document builders. Dashboard navigation
intersects the existing exact origin/credential/query/unavailable guard with the
protocol's current SPA/session paths. This is not resource interception or an OS
permission reset. Native save/open/export retain their existing signed/document/
focus policy. See [pinned APIs/defaults and remaining native evidence](../research/tauri-webview-policy.md).

OpenCode catalogue discovery collapses only candidates independently passing the
same exact reviewed native binary SHA-256, using existing canonical tool-PATH order.
This does not authorize execution: the exact chosen path/hash is disclosed in native
review, persisted in the manifest and revalidated before signed Start. Raw discovery
retains distinct installations; a changed chosen path is not substituted after
review. No provider probe, credential read or server is added. See [pinned review](../research/opencode-executable-equivalence.md).

OpenCode full TUI model selection uses only per-process `OPENCODE_CONFIG_CONTENT`,
composed with the existing generated MCP document. No inherited inline config or
global settings are rewritten. Model evidence is revalidated before dispatch;
native agent/managed settings, variant preferences and availability can override
the initial default. Effective selection remains unverified without CLI evidence.

## Tauri Studio preparation — 2026-11-04

Studio can invoke only the existing native preparation wizard through an exact
main-Webview capability and strict provider/count/review union. It cannot select
paths, supply process/proof/source fields, send tasks or call arbitrary Core methods.
Native AppKit focus, source/document generation, shared menu exclusion, commit and
opening latches, own-sheet handling and Quit fences remain authoritative. Bridge
HTTP/WS/cookie/CSP and source ingestion are unchanged. See the
[command-specific security review](../api/tauri-studio.md) and
[pinned reuse decisions](../research/tauri-studio-preparation.md).

## Tauri interactive MCP consent — 2026-11-04

The native menu authorizes one bounded grant through the existing Core, never through
the public terminal request schema or observer API. Exact native document, focus,
request ID and revocation generation bind Cancel-default review. Node rejects late,
cancelled, concurrent and expired consent before signing; Core revalidates owned
source/worker identities, epoch, workspace, deadline and replay. Task/result calls
remain in the existing private Unix/stdio transport. Neither approval nor writing
terminal output proves delivery or model completion.

Reload/destruction forwards `closeSlot` to Core to invalidate MCP. Hiding preserves
the owned process and cancels only pending consent/input authority. Unknown native
transport effects are fenced without retry; admission/quarantine is not reconciled
or released. HTTP/WS/cookies/CSP, captured sources, credentials and filesystem
permissions are unchanged. See the [component/security review](../research/tauri-interactive-mcp.md)
and [validation limits](../development/tauri-interactive-mcp.md).

## Tauri terminal retirement

The native menu alone can request selection retirement. The private host serializes
all panes, presents complete bounded Core evidence and signs its exact one-use
retirement challenge after native confirmation. Core alone rechecks journal and
reservation ownership plus owned process exits before archival/release. Success
also requires confirmed Core shutdown. A possibly consumed proof, missing reply or
unconfirmed cleanup never reopens old execution or the native preparation latch.
Startup-environment selections share the same single-use latch. This adds no
renderer execution operation or observer HTTP/WS endpoint and never reconciles an
uncertain reservation. See the [workflow/security review](../development/tauri-terminal-retirement.md).

## Tauri preview process boundary — 2026-11-04

The native terminal preparation menu adds only a fixed passive Node helper, not a
renderer execution API. It reuses the existing reviewed provisioner/selection for
bounded Codex/Claude manifests; native pickers, paged Cancel-default consent, binary
and directory revalidation, private state and separate write/open latches remain
authoritative. The original visible dashboard URL and page-load generation plus
bounded deadlines fence preparation; modal dialog focus is not provider authority.
The URL/generation are captured before queueing the blocking helper and focus is
rechecked before spawn. Another ORQST window gaining focus, or closing/destroying
the dashboard, invalidates that generation permanently for the pending transaction.
Returning to the dashboard cannot revive it. Native pickers/sheets do not count as
another Tauri window, and no native command or capability is added.
Starting a CLI retains the existing stricter native document/focus/signature checks.
Cancelled opening can review the same completed files; uncertain effects cannot
automatically retry or release reservations. New profiles disable ORQST MCP. See
[the exact private-pipe contract and limits](../research/tauri-terminal-preparation.md).

The native shell owns a fixed bundled Node executable and Bridge entry. The observer
has no Tauri capability, execution endpoint or signing-key exposure. The shell plugin is used exclusively from
Rust. The Core receives an allowlisted environment, separate private application
state and a stable native loopback origin (default port 4319). Port conflicts fail
startup without attaching to another process. Existing HTTP/WebSocket authorization and
CSP remain unchanged. Navigation cannot leave that exact origin, credentials/query
URLs are rejected and new windows are denied. Packaged `index.html` must be a regular
file before readiness. Source sessions remain read-only under existing controls.

Readiness is bounded and checked before creating the webview. A native single-instance
plugin prevents a second application startup from creating a second Core. Stdout and
stderr continue draining after readiness without printing captured diagnostics. Native
exit waits for its fixed stdin shutdown, then can kill only its retained child; EOF
also initiates Node cleanup. No stale PID, uncertain descendant or lost agent is
adopted or restarted. This is not hard containment against a malicious same-user
process replacing app resources. Reconnection and full-platform packaging remain unaccepted.

An explicit `ORQST_TAURI_TERMINALS` manifest array starts a second fixed Node entry
for managed execution. It reuses the existing private Core, PTY host and native broker;
it does not import execution into the Bridge. Only `terminal-*` local webviews receive
`terminal_request`/`terminal_view` capability. Native label and exact custom-protocol
URL bind the slot; renderer fields never select a slot, manifest, executable or proof.
The terminal document permits only its script/style and native IPC, denies frames,
network connections, links/new windows and forms, and renders CLI output through the
existing restricted xterm client. Native blur/hide revokes leases and pending grants;
reload permanently fences that document. Private pipe messages and output are bounded,
requests do not retry, and malformed renderer requests leave other slots usable.

Native dialogs show the existing exact manifest/action with bounded quoted paste.
On supported macOS the first and third buttons cancel; only the middle named button
approves. No renderer answer is accepted. Signing keys, attachment IDs and input leases
stay in the private Node broker. The Rust parent validates native focus/generation again
after the dialog before returning consent; the broker checks its own revocation generation
and challenge expiry before signing. The inherited pipe is the trusted native transport,
not an authorization mechanism available to the dashboard or another HTTP client.
Native consent/keyboard lifecycle acceptance is still incomplete; synthetic pipe consent
does not establish it. MCP-enabled profiles are refused until their separate consent is ported.

Security review: no observer endpoint, cookie, WebSocket/event shape, database schema
or source-access policy changes. The new boundary is native → inherited stdio →
existing Node Bridge. See [process contract](../api/desktop-sidecar.md),
[source/license audit](../research/tauri-core-reuse.md) and
[acceptance limits](../development/tauri.md).

## Codex/OpenCode pair security review — 2026-11-03

The only heterogeneous selection allowed is exactly one Codex and one OpenCode in
the same canonical project. The shared pre-Core inspection is authoritative for
native review and startup-argv/Core entry; 3–8 members remain homogeneous. No
profile/environment is merged: each adapter retains its selected native identity,
strict pins, independent state/journal, focused broker and signed per-slot grants.
OpenCode startup/database/activity acknowledgments and separate two-member MCP
task authorization remain mandatory. OpenCode descendant exit is unvalidated, so
the sticky reservation still cannot retire, even after both owned TUIs exit. No
observer API, WebSocket, cookie, static-serving, credential or schema change occurs.
Synthetic focus/dialog doubles establish wiring only; human/native/provider
acceptance remains separate.

## Bounded interactive terminal team security — 2026-11-03

The explicit interactive Desktop selection is bounded to 1–8 slots, default two,
validated before Core/journal allocation and by the Core's private IPC entry. Each
same-project/provider member keeps separate state, journal, native sender, signed
start/input/stop proofs and attempt identity. Numeric supervisor/journal admission
is **per domain**, not a global project/machine quota; Desktop supplies one domain
per slot. ADR-036 explicitly supersedes ADR-032's earlier project-wide wording.

A predictable journal/owner/reservation conflict is checked before consuming a start
proof or recording `starting`; a last-boundary race can still become uncertain.
Same-project agents share the writable project and native provider identity/config;
private slot state does not isolate repository writes, locks, credentials selected
by the native CLI or configured hooks/plugins. The user must coordinate concurrent
project edits. Two visible documents is only a UI split limit; up to N owned
processes may run. No CPU/RSS/descendant containment or global quota is promised.
Every dispatched member must prove owned exit before whole-team signed retirement
archives/fences/releases the unchanged sticky `active-pair.json` domain. Unknown
markers, lost transport, journal ownership or late exit cannot reclaim capacity.
No per-slot recycling, PID adoption or global process census is added. New persisted
UUID/P-UUID metadata cannot authorize control or address the communication queue.

Security review: only private inherited RPC slot/ready bounds and optional manifest
identity metadata change. The layout IPC adds strict bounded `{tab:number}` data;
process IPC still receives its slot exclusively from the native binding. Existing
focus/activation/frame/session checks, O_NOFOLLOW/permissions, CSP, input leases,
redaction limits and observer HTTP/WebSocket/cookie boundaries remain in force.
MCP remains exactly two participants; no provider/network/delegation authority is
expanded. See [precise limits and verification](../development/terminal-teams.md).

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

## Claude TUI executable review — 2026-11-05

Normal TUI discovery and provisioning admit the independently reviewed Claude
2.1.318 version/hash. Existing 2.1.178 manifests and the old strict MCP contract
remain separate; the new TUI pin cannot compose ORQST MCP. Native executable
hashing has a finite 512 MiB budget with 64 KiB streaming reads and existing
canonical/O_NOFOLLOW/owner/mode/Mach-O checks. Files above the budget are refused;
the read loop also refuses growth beyond it. The existing volatile CLI-policy
identity cache is unchanged, avoiding rehash on each key without persisting trust.
Upgrades require another review/pin and fail closed as unreviewed version/hash.
No public API/WS/cookie/static-serving or authority boundary changes. See
[passive evidence and remaining native/provider gates](../research/claude-code-tauri.md).

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

### Studio preparation

The versioned Desktop Studio facade admits only a bounded snapshot and named
preparation/review/opening intents. It accepts no paths, manifest bytes, grants,
provider prompts or process commands. Non-read requests require preload activation,
authorized native sender and focus, then the existing parented path/hash/consent
reviews. It cannot start a CLI or accept provider permissions. No HTTP/WS execution
route was added; the Studio path uses the existing static dashboard security controls.

## Managed mention routing review — 2026-11-04

The existing isolated Electron managed-client IPC gains bounded identity/route edits
and an explicit source slot. Strict protocol schemas reject injected paths, proofs,
actor/workspace claims and additional properties. Sender/session/main-frame/generation,
user activation, native focus, Cancel-default review, expiry and Ed25519 one-use
challenge consumption are preserved. The private Core binds exact before/after
metadata to the signed routing review; revision changes invalidate stale reviews
and prepared tasks. Active/uncertain root work blocks policy edits in this client.

New routed identities deny all destinations initially. The Core checks workspace,
managed ownership, unique handles, directed matrix permission and cycles; permission
is enforced again on grants, message admission and dispatch. Roles grant no authority.
Each task still needs the separate exact native task grant. Mention parsing applies
only to submitted composer text, never captured output; unknown/multiple targets fail
closed. Text remains untrusted, rendered using textContent; no HTML evaluation, PTY
injection, automatic reply chaining, fallback provider or observer control is added.

No HTTP/WS/cookie/static-file-serving contract, network listener or credential access
changes. The refactored native document keeps the same isolated protocol/CSP and
escapes localized labels. Synthetic Chromium consent is not native-modal acceptance;
real-provider and Tauri managed-terminal parity remain unvalidated.

## Retained terminal workspace layout — 2026-11-04

The existing dedicated `orqst:terminal-view` channel now accepts bounded column,
reorder and display-name data in addition to local view actions. Main still binds
requests to the actual reserved, focused and visible native document; the observer
preload receives no layout or execution capability. Extra fields, process commands,
arbitrary slots, control/bidi characters and names above 48 characters are rejected.
Names are rendered using textContent/HTML escaping and are never routing identities.
Hiding, paging and layout changes retain documents and revoke keyboard permission;
none of these operations start, adopt, signal, retire or authorize a process.

Main alone chooses a private preferences path keyed by sorted reviewed UUIDs.
Strict bounded reads, canonical/private directory checks, O_NOFOLLOW and exclusive
0600 temp creation plus atomic rename preserve containment and permissions. No
executable, session content, input, credentials or recovery authority is serialized.
An invalid store falls back to defaults; failed saves report memory-only operation.
Same-user malicious ancestor replacement remains outside the existing filesystem
contract. HTTP, WebSocket, cookies, CSP, provider grants and observer ingestion
are unchanged. See the [layout guide](../development/terminal-workspace-layout.md).

## Tauri workspace focus boundary — 2026-11-04

The retained Tauri grid binds commands to each exact local terminal webview, not
only its parent window. On macOS, mutation/approval focus requires the native
NSWindow first responder to belong to the owned WKWebView. The check runs on
Tauri's UI thread and fails closed on other platforms. No renderer active-slot
or JavaScript focus value grants execution authority. Layout changes, hiding,
parent blur and document reload retain input/consent revocation. Layout metadata
uses the existing private, UUID-keyed, symlink-resistant preference store and
cannot start, stop, adopt or recover a session. Observer HTTP/WS/cookie and source
access controls remain unchanged. See the [component review](../research/tauri-terminal-workspace.md).

## Tauri structured agent review — 2026-11-04

The dedicated `managed-agents` native window alone receives `allow-agents-request`.
Exact custom-protocol identity, transient user activation, visible native focus,
load-generation fencing, strict request schemas and serial mutation checks protect
the existing Core composition. Paths, host selection and admission stay native-only.
Bounded exact reviews escape format controls, default to Cancel, expire and invalidate
on blur/hide/reload/close. Only current affirmative approval signs a one-use Core
challenge; permissions and exact-task grants remain separate. Unknown transports
are fenced without retries, adoption or implicit release. Hiding keeps owned tasks.
Quit requires explicit disconnect consent. Private pipe/output limits are enforced.

No observer API, WebSocket, cookie, ingestion or external-session authority changes.
The renderer receives no shell, filesystem or dialog plugin permission. Existing
Core directed/cycle/TTL/ownership checks and secret-free public snapshots are reused.
Synthetic acceptance simulates invoke/focus/dialog decisions; human native and real
provider acceptance remain pending. See the [native contract](../api/tauri-agents.md).

## Tauri native alerts and close policy — 2026-11-04

Native alerts reuse the pure Electron source-gated monitor, extracted into Core.
The fixed owned Node entry alone emits category/sound and bounded unread metadata
over its private pipe; Rust rejects malformed, stale, excessive or extra fields.
No captured content, path, session ID or credential enters the OS notification.
The observer receives no notification, tray, shell or filesystem capability, and
HTTP/WS/cookie/CSP/source-access controls are unchanged. The user-agent marker only
suppresses duplicate browser notifications; it grants no authority.

Native alerts and keep-running-on-close require separate per-run native opt-ins.
Closing without background opt-in routes to existing managed-host exit consent and
retains the document if consent is cancelled. Explicit Quit stops native admission
before host/Core cleanup; hiding keeps the owned Core and document alive. Counts
become unknown after a metadata gap. No process adoption or auto-restart is added.
The OS receives only fixed translated category text, at most three attempts per
poll and 20 per run. Plugin preparation is not proof of OS delivery/permission;
macOS/Windows cannot withdraw delivered alerts. Clicks only restore the current
owned window and callbacks are inert after shutdown. Platform/native acceptance
and transitive redistribution review remain separate from synthetic tests.
See the [native desktop guide](../development/tauri-native-desktop.md).

## Tauri native file exports

The preview's owned main webview has a dynamically installed `file_request`
capability at its exact Core origin, with native document/focus checks. It has no
filesystem, dialog, shell or managed-execution plugin permission. The host reuses
existing retained-content and Analytics validation and secure file writers; native
pickers supply host-only paths through private pipes. No HTTP route, cookie, CSP or
source-access policy changes. See the [security review](../api/tauri-files.md) for
revocation, capacity, partial-write and native acceptance limitations.

## Combined Tauri retirement and MCP consent — 2026-11-04

Native menu and private service guards serialize retirement, MCP preparation and
consent across all panes. Either document's revocation invalidates a pending
selection-wide review, including preparation arriving late. A retirement proof
that may have been consumed fences subsequent MCP preparation and terminal work;
only an explicit pre-proof refusal/cancellation permits another fresh review.
Native first-responder identity selects the reviewer for both actions; display
layout and MCP source/worker roles grant no authority. No new capabilities or
observer API changes are introduced. See the
[combined checks and remaining gates](../development/tauri-retirement-mcp-integration.md).

### Private SQLite terminal layouts — 2026-11-04

The existing terminal Core is the only layout SQLite writer; Desktop holds no database
dependency. Its inherited IPC accepts bounded strict visual records for the reviewed
UUID selection only. No renderer path or process/grant field is accepted. The fixed
private metadata database is separate from all observer/execution journals; importing
legacy JSON never claims ownership, opens a journal, resumes a CLI or retires capacity.
Directory and database/sidecar checks reject symlinks, hardlinks, other owners and
non-private permissions. Original JSON is preserved. Same-user filesystem replacement
races remain outside the existing boundary. Metadata-only RPC adds no HTTP, WebSocket,
CSP, cookie or public execution change. See [contract](../api/terminal-native.md#private-layout-persistence-rpc--2026-11-04).

## Developer-only native and quarantine diagnostics — 2026-11-04

The native acceptance probe reads WindowServer metadata for the fixture's owned
PID, without pixels/titles or activation/input authority. It is not a production
capability. Capacity inspection opens an explicitly selected terminal journal
immutably, refuses pending WAL frames, reads allowlisted metadata and never claims
ownership, checkpoints or releases capacity. It refuses a linked or group/world
writable journal file. Neither diagnostic proves safe process adoption or native
acceptance. See [quarantine](../development/codex-quarantine-capacity.md).

## V6 Feature configuration and communication — 2026-11-04

Feature/team/layout writes are private inherited Core IPC, not a dashboard HTTP
execution surface. The host derives workspace and terminal UUIDs from its reviewed
selection; strict commands accept no arbitrary path, process ID or proof. The
existing private SQLite permission checks and bounded transactions are reused.
Saved routes are proposals requiring fresh native review and task grants, never
restored authority.

Optional `featureId` preserves legacy v1 records but never falls back from explicit
Feature to legacy scope. Exact Feature equality is checked for routing, grants,
admission, dispatch, ancestry, results/visibility and audit. Repeated handles in
different Features are allowed; qualified mentions are rejected as whole tokens
until cross-Feature authorization is implemented. Feature assignment alone does
not validate runtime enrollment. No public listener, CSP/cookie/WebSocket change,
provider launch or quarantine release is introduced. See
[contracts and required native composition](../development/v6-feature-core.md).

## Native owned-sheet consent and Quit — 2026-11-04

Native terminal consent now distinguishes only the exact attached/key sheet of its
own parent window on an active NSApp. Keyboard leases are suspended without renewal;
application deactivation or another key window invalidates the pending review even
while its parent is already non-key. Returning renews no generation, deadline, signed
nonce or consumed proof. The exact WKWebView first responder remains mandatory after
the dialog. No observer API or renderer capability is added. Native app-menu Quit
uses the existing preventable exit/host-consent path rather than direct NSApp termination.

Both existing Quit gates require a retained visible owned parent and an exact
per-attempt presentation token. On macOS the native observer must see that parent's
attached key sheet; deactivation or another key window permanently revokes the
pending attempt. Missing presentation, unknown/default/cancel results and a missing
parent deny exit. Input authority is revoked before review, without stopping an
owned process; Cancel resets both partial authorizations and renews no authority.
Late layout presentation is fenced while either gate is pending/authorized.
This does not prove Dock/logout or final integrated native acceptance.

The native focus callback captures the Quit token and retained parent before
sampling AppKit outside the state lock. Applying that sample requires the same
token and parent, so a delayed sample cannot mark a replacement gate as presented
or revoke it using another window's metadata. This adds no retry or authority.

## Native Feature metadata facade

The [Feature UI facade](../development/v6-feature-ui.md) is private native IPC,
not an HTTP/WS execution endpoint. Rust binds exact Webview label, canonical URL,
parent window, document generation and native focus to strict metadata actions.
Narrow per-webview capabilities, bounded independent pending requests, CAS,
bilateral native-review exclusion and presentation generation prevent identity
forgery, stale responses and hidden input restoration. Saved membership/roles/layout
never restore a grant or adopt a process. The observer remains read-only; only the
already reviewed selection is exposed. Native WebKit and provider acceptance are
separate from synthetic Chromium/Node evidence.

## CLI/model operational Open — 2026-11-04

The normal Studio request carries scoped IDs and opaque catalog/model digests.
Only the owned observer database resolves a project; native argv supplies private
preferences. No renderer path, arbitrary executable, login, task or proof is accepted.
`terminal_open_prepared` is restricted to exact dedicated terminal Webviews and
consumes a native intent bound to document/presentation generation and 60-second
expiry. Real deactivation, blur, reload, dashboard navigation and Quit revoke it.
The deliberate initial Studio transition cannot revive obsolete layout messages.
Operational Open has one explicit native consent and three independent expiring
signed challenges; each effect and the final async snapshot revalidate the original
consent deadline. Partial failure retains identity/receipts and never retries,
signals or adopts a process. Observer HTTP/WS/cookies/CSP and original sessions
remain unchanged. Legacy Start grants startup only. Current selection remains
one-shot per app launch; live enrollment needs its own ownership/admission review.
Pure/renderer checks do not prove native/provider acceptance; Cargo remains pending
while coordinated disk margin is unavailable.

## Private incremental owned enrollment — 2026-11-04

The [enrollment API](../api/terminal-enrollment.md) exists only on trusted inherited
parent/Core IPC. It binds original Core epoch, one-use operation identity, CAS,
prepared read-only workspace/Feature context and immutable source/admission
revision. Admission grants no Start/attach/input. Exclusive durable records retain
partial effects and capacity, with no automatic release/retry/adoption; timeout
and stale acknowledgments do not disconnect or renew previous panes. Native
presentation/layout and real-provider acceptance remain separate.

## Incremental native retained views — 2026-11-04

Only the native provisioning result supplies enrollment manifest paths over the
existing inherited pipe. Original Core epoch/capacity, native UUID and CAS bind
admission; renderer inputs cannot raise capacity or authorize execution. Confirmed
ready appends one broker/document, with distinct existing signed Open grants.
Timeout removes the native correlation; late ACK or inspect cannot create/adopt a
Webview. Rejection/uncertainty and creation/presentation failure preserve the old
Core/documents/evidence. No observer endpoint, listener, cookie/CSP or WebSocket
change is introduced. Native/provider acceptance remains pending; see the
[workflow/security review](../development/terminal-native-enrollment.md).

## Tauri unavailable and explicit pair boundaries — 2026-11-04

The fixed observer-unavailable custom protocol serves only its exact local GET
document with escaped EN/PT text and no script, IPC, network or retry controls.
Existing native remote capabilities remain bound to the owned dashboard origin.
Explicit fresh Codex/OpenCode pair preparation reviews both models and bilateral
MCP opt-in; normal Open remains disabled for MCP. Operational Open and one-task
grants retain separate ownership, focus/document, revalidation and uncertainty
fences. No new observer execution API or transport is introduced. See the
[combined review and acceptance limits](../development/tauri-mcp-unavailable-integration.md).

## Tauri notification view routing review — 2026-11-04

Only Core source-gated allowlisted identities enter the bounded private monitor
pipe. The OS receives fixed category text and an opaque numeric ID, with the
session mapping confined to native RAM. Exact origin/generation/freshness and
one-use tap correlation precede a fresh authenticated snapshot membership check.
The dashboard keeps its existing draft guard and denies revoked/context-stale
results. This view event grants no execution or managed-session authority; no
HTTP/WebSocket/cookie/CSP/capability change is introduced. Actual OS delivery is
not inferred from show(). See [source, contract and limits](../development/tauri-notification-route.md).

## Selected terminal catalogue evidence — 2026-11-04

Normal terminal preparation binds the selected executable/native context/model and
configuration independently from unrelated provider discoveries. Semantic Codex
cache proofs retain the original selected expiry and validate the selected visible
entry, cache version and current freshness at provisioning and dispatch. Full native
review, binary pins, Workspace/Feature checks, signed launch and native commit latches
remain authoritative. No new observer API or retry is introduced. See [selection
binding review](../research/terminal-catalog-selection-binding.md).

## OpenCode preference catalogue and native pre-write review — 2026-11-04

Passive discovery reads only the bounded native `opencode/model.json` preference
metadata. It adds saved references, always unverified, never auth/SQLite or a dynamic
provider query. Canonicality, O_NOFOLLOW, trusted owner/permissions and 2 MiB limits
remain; the actual read now refuses post-fstat growth beyond its byte budget.
Preference arrays are bounded to 64 each, variant keys and total choices to 128.
Semantic selected-entry evidence tolerates unrelated edits and rejects selected
removal/variant drift, including nested model IDs. Original TTL/context pins remain.

Selected/pair consent shows actual project, CLI/model/terminal identities and effects.
The same pre-write plan is available through optional Full details before committing.
Only explicit summary approval can succeed; Details/Back cannot approve, and stale
focus/document/generation/expiry cancels. The existing private confirmation envelope
adds optional summary/details/back text, with bounded native fields; public renderer
requests, exact operational Open, grants, latches and revalidation remain unchanged.
No observer HTTP/WebSocket/cookie/CSP or native capability permission changes.
The complete plan persists afterwards in owner-only terminal.json. No credentials or
configuration bodies are logged. The MIT copyright/license is included in distributed
NOTICE, preserving existing attributions. See [research](../research/opencode-model-catalog.md)
and [checks and acceptance limits](../development/opencode-model-catalog-ux.md).

## Passive terminal admission diagnostics — 2026-11-04

Reservation inspection is read-only, canonical, O_NOFOLLOW, owner/mode/inode checked
and bounded to 16 KiB. Existing reservations are preserved; inspection never claims,
reconciles or frees capacity. Same-Core evidence stays in native private argv/IPC.
Startup errors expose fixed stage/code/effects only; unknown/EOF/timeout remains
possible. Native commit/open evidence cannot be downgraded, and old append replies
cannot release another owner/request's latch. Reader EOF takes/stops only its own
owner/epoch/files host; public Stop retains its explicit global intent. No HTTP/WS, cookie, CSP or execution
authority is added. See [scope and verification limits](../development/terminal-admission-diagnostics.md).

## Native local diagnostics — 2026-11-04

The optional Rust sink uses fixed stage/outcome/effects vocabularies, independent
diagnostic UUIDs, a nonblocking bounded queue and one private bounded disk writer.
No raw error, stderr, prompt/content, auth/config, ownership/proof or private path
field is accepted. No HTTP/WebSocket/cookie/static capability changes are added.
Existing native review, grants, latches, deadlines, keyed ownership cleanup and
Core/PTY authority remain separate. First disk failure disables the optional sink;
no fallback, retry or permission decision follows from its result. macOS/Linux
use private modes, no-follow/special-file/owner checks and an advisory writer lock;
same-user directory-replacement races are outside the guarantee. Other platforms
disable disk logging. See [retention and source/acceptance boundary](../development/local-diagnostics.md).

Offline administrative continuation uses exclusive per-boot helper leases and
exact operation/file identities. Only a returned invocation in the same helper,
or a different authenticated kernel boot, permits continuing a retained lease.
New reviews are mandatory; Cancel/expiry is not persisted approval. Known phase
completion re-establishes archive/receipt durability before namespace mutation.
A partial legacy control or unproven same-boot helper is never automatically cleared.

The offline namespace commit occurs only inside finalization after durable signed
intent and preparatory evidence. The present original marker excludes existing
legacy wx claimants until this point; kernel boot fences its old owner. Future
claims after commit are normal operations. Cleanup validates old held/control
identities only and must not revalidate or mutate future runtime state.

### Dedicated native administrative recovery

The fixed offline entry branches before Core startup and uses an independently
provisioned administrative signer, never a renderer or capture-supplied key.
Native AppKit presentation/source/focus fences and private session/id/nonce/digest
ACKs protect full review; private `0600`/`0700` canonical storage and durability
checks reuse existing readers. See [the complete contract](../api/offline-native-recovery.md).

## Offline native consent clock — 2026-11-04

The private owned-pipe protocol is now version 2. Immutable full-review consent
precedes one fresh signed intention-bound challenge. Per-request nonces prevent
replayed revalidation ACKs; native continuous time and `Instant` begin in AppKit
before waking the worker. Core carries the conservative minimum deadline through
source/lease checks and effects, including the final marker rename. No renderer
key, HTTP/WS recovery authority, dependency or new public surface is added.
Existing format-1 anchors and incomplete captures are preserved. Synchronous
helper syscalls are not instantly interruptible by pipe/focus notifications.
See [clock, threat and preserved-state limits](../development/offline-recovery-consent-clock.md).

Offline administrative capture may consume an explicit native-only historical
binding candidate. It changes no launch/claim authority and never reads current
model-source contents. The exact preimage, receipt/context, durable private evidence
and separately reviewed current critical metadata are required; source size/times
are excluded only for those unread model sources. All recovery records preserve
full freshness checks. [Detailed boundary](../development/offline-historical-binding.md).

## Cross-boot administrative device difference — source contract

The offline-only snapshot may contain `physicalDifference` in its current RAW:
a single declared historical/current device pair and current enrollment critical
metadata. Historical signed bytes, all other preserved file metadata and complete
enrollment digests must still agree. Existing fresh native review explicitly
authorizes archiving the exact reservation without asserting filesystem/volume
continuity; existing release and final-commit signatures remain separate.
Launch/claim rules and future-owner cleanup boundaries stay unchanged.
See [the executable contract, research and pending acceptance](../research/offline-cross-boot-admission.md).
No real-state use, native UI, build or provider acceptance is claimed here.

## Renderer termination and webview data stores — 2026-11-05 (source state)

The locked Tauri/Wry macOS runtime exposes a public web-content termination
callback; without it the runtime attempts an automatic webview reload. The
native builder now installs it before any webview exists. The handler keeps a
per-label latch, revokes only the terminated document's authority through
narrow wrappers, hides a dead child so it cannot cover the message, and presents
the static unavailable document with a renderer cause. It does not stop,
signal, retry, adopt a process or create a Core, and a duplicate or obsolete
callback does not loop. Native macOS acceptance is pending.

Dedicated child views use a nonpersistent WebKit data store (`incognito(true)`);
the dashboard keeps the default store because it owns persisted preferences.
No existing store data is deleted or copied; preference migration is open.

`on_web_resource_request` covers only Tauri's own `tauri` protocol, not external
loopback HTTP, so it is not an Electron `onBeforeRequest` replacement. macOS
permission categories without a callback (geolocation, browser notifications,
clipboard read) remain open and are not claimed as enforced.

## Feature delegated-task restrictions — 2026-11-05

The trusted Core composition can supply a current Feature permission reader to
`PaneCommunication`; Feature-scoped calls without it deny. A known unarchived Feature
without a policy row is neutral per V6 MASTER:286, with all existing routing,
exact native grants, ownership and capabilities still required. A saved directed
terminal policy only restricts delegate/execute/view. Orchestrator never contributes
authority. Invalid/future/corrupt/unknown/archived/foreign or saturated scope denies.

Authorization pins policy revision; admission and dispatch revalidate delegate and
execute before content/submission. View filters scoped reads/events and checks again
inside notification microtasks. Revocation/reallow does not restore old grants.
Already-dispatched provider facts remain durable and independently validated.
Root plans bind policy revision into their native digest and recheck before turn
start. Legacy panes remain isolated from Feature panes.

Security review: no HTTP, WebSocket, cookie, static-serving, renderer, native or MCP
transport change is made. Only the trusted Core composition facade can save policies;
its host fixes Workspace and actor. Execute is no sandbox/CLI tool approval or human
PTY authorization. UI editing, interactive MCP policy wiring and explicit cross-Feature
approval/audit remain pending. See [the full boundary](../development/v6-feature-permissions.md).

### Managed-agent Feature bootstrap — 2026-11-05

Tauri passes only native app-data catalogue/preferences roots to the existing
owned Node bootstrap; that host derives stable workspace/Feature IDs from private
validated preparation bindings and the catalogue. Both manifests must agree on
native roots, project, scope and fence, with distinct current member UUIDs. Core
captures that scope and revalidates pair identity/fence before prepare/launch.
Runtime native start proofs and manifest validation remain independently required.
Renderer/operational IPC cannot override bootstrap context or save a policy.

The production composition injects the existing Feature permission reader. Missing
policy is neutral only after a valid read of an unarchived Feature and its members;
missing/unsafe/unreadable storage, corrupt/future policy and foreign scope deny.
Saved policy restricts existing routes/grants by AND. Navigation does not transfer
running-process scope. Native editing, interactive MCP and cross-Feature authority
remain separate pending work; this wiring establishes no provider/native acceptance.

## Feature permission matrix — 2026-11-05 (source state)

The `feature_permissions` command is granted by the dynamic Feature chrome
capability. The handler checks the exact chrome document and native first
responder, captures its document and Core epoch, and binds a review to the active
Feature, snapshot and revisions. A native plain-text sheet displays stable IDs,
labels, the policy transition and its SHA-256 plan digest; Cancel is the default.
The sheet exception applies to the recorded native sheet. Focus, document and
captured context are rechecked before the private host request. The Core
transaction checks the policy, Feature and active-view revisions and stores the
review digest with the audit event. The actor is supplied from the native host
epoch through the inherited private channel. The renderer proposes a policy and
cannot choose the actor or invoke the private transport. Confirmed revision
conflicts return `stale`; an unconfirmed save returns `unknown` without retry.
Renderer IPC rejection also yields `unknown` and invalidates the revision; an explicit
refresh performs a new native read with the same focus gate, without automatic retry.
CSP is unchanged. Reset is not implemented; an empty allowlist denies all
operations. Synthetic tests and source review do not establish native AppKit,
real provider, package or platform acceptance.

## Feature canvas native view boundary — 2026-11-05

The new `canvas` action is metadata/view-only on the existing exact native
dashboard/chrome facade. Current document, presentation generation, real native
focus, mutation/review exclusion and Quit fences remain mandatory. It revokes
input and cannot launch, stop, write, grant or recover any process. Card navigation
binds current Feature membership and exact terminal UUID before resuming a view.
Native sibling ordering changes no focus/input authority. Preparation uncovers the
retained main dialog only after source revalidation and revokes the old presentation.
No HTTP/WS endpoint or observed-session execution is added; all captured activity
continues to render as plain text. Native acceptance remains pending.

## Owned Claude session display boundary — 2026-11-05

An owned, one-shot Claude launch may expose its explicitly supplied session UUID
and up to three tool names only after the exact lifecycle receipt and a new matching
transcript record are validated. The transcript path must be absent before launch;
reads reject symlinks, links, wrong ownership, unsafe modes, inode replacement,
oversized sources and mismatched UUID/CWD. The private state stores a 0600 binding
with launch digests and a hash of the matching source record; uncertain creation
is never retried or removed. Input, output and transcript contents never enter the
facade. The function grants no control over observed sessions or communication.
Same-user malicious filesystem races remain outside the existing terminal contract.
