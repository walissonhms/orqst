# Security policy

ORQST observes AI agent sessions that may contain source code, prompts, tool
output, credentials accidentally pasted by a user, and other sensitive data.
Security and privacy are therefore part of the product, not an afterthought.

## Supported versions

ORQST is pre-release. There is no supported release line yet.

| Version               | Supported                         |
| --------------------- | --------------------------------- |
| `0.1.x` (development) | Best effort only; no security SLA |
| Older                 | Not applicable                    |

No version has been tagged as a stable release.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Use one of these private channels:

1. If the repository is hosted on GitHub, open a private security advisory in
   the repository's **Security** tab.
2. Otherwise, contact the repository owner through the private channel used to
   share this repository.

Include:

- the affected version or commit,
- the affected component (bridge, database, Codex adapter, dashboard),
- reproduction steps or a minimal proof of concept,
- the impact you believe is possible,
- whether the issue requires local access, a malicious session file, or a
  malicious web page.

Do not include real credentials, real session content, or third-party personal
data in the report. Redact evidence.

There is no bug bounty and no response-time commitment at this stage. The owner
will acknowledge a report when possible and coordinate disclosure after a fix.

## Current managed Terminal opt-in

The native application menu can select/review existing Terminal manifests while
Desktop runs. Review stores only memory and exposes no new renderer/IPC/path API.
A separate Open uses the existing fixed-pair admission/journals; actual provider
start still requires its signed native confirmation. No live pair replacement,
external-session adoption, reservation reset or failed-initialization retry is
offered. Same-provider live selection and complete bounded review fail closed on
focus/navigation/expiry or file/identity drift. See the
[selection security review](docs/architecture/security-model.md#live-native-terminal-manifest-selection--2026-11-03).
Strict inference-free OpenCode startup remains unestablished; native policies and
simulation are not claimed as all-code containment or zero-billing proof. See the
[pinned-source investigation](docs/development/opencode-startup-safety.md).

The [structured Desktop client](docs/development/managed-agents-client.md) now
composes two explicitly native-confirmed Codex starts and exact A-to-B-to-A task
authority in a separate sandboxed document. The observer preload only opens the
view; it receives no signing/start/delegation capability. Private journals must be
new; existing observer/terminal databases are never migrated by this path. Native
authentication/configuration/MCP remain shared and cost limits advisory. Real
provider acceptance and shared-source preservation are not established by fixture
success. See the [composition review](docs/architecture/security-model.md#structured-desktop-composition-review--2026-11-03).

The [passive CLI preflight](docs/development/local-cli-integration.md) discovers
executable metadata without executing providers or inspecting credentials. Existing
authentication reuse remains blocked until a provider-specific isolation contract
is validated. Setup creates no state by default; the legacy separate-login profile
requires an explicit choice. Candidate discovery never grants execution authority.

The [managed Terminal opt-in](docs/development/managed-codex-terminal.md) implements
a separate native trusted/same-user path in the checkout. Electron is a client;
an independent Node component owns private metadata, grants and PTY handles.
Native-confirmed login/start/input/paste/stop are isolated from the observer cookie,
API and preload. Fixed profiles, hashes/canonical paths, private new state and a
minimal environment prevent accidental reuse of external credentials and sessions.
They are not immutable kernel binding or a hard sandbox. Provider UI can change the
initial read-only/on-request defaults; the process has the OS user's privileges.
Same-user compromise, hostile descendants and hard resource containment are outside
this mode. Real-provider acceptance is pending specific authorization.

The dedicated xterm document has no remote requests, captured HTML or generic IPC.
OSC clipboard/link/title actions and automatic emulator input are disabled. Only
its CSS policy permits inline styles for xterm; the observer CSP is unchanged.
Closing the view hides it. Quit/loss records uncertainty without signaling a stored
PID; each owned PTY host retains its start-authorized 30-minute deadline. No
recovery/adoption, delegated-task protocol or remote execution is exposed.

## Architecture approval and future control

The current runtime is an observation service. Phase 0 approves future managed
execution, Electron, structured delegation and optional remote connectivity as
architecture direction only. That approval alone enabled none of them; the later
ADR-030 slice implements only an explicitly authorized local Electron observer client.
See [ROADMAP](ROADMAP.md), [ADRs 015–024](docs/architecture/decisions.md) and
[planned lifecycle contracts](docs/api/lifecycle-contracts.md).

Before introducing control operations, require a separate Core-authenticated
principal and explicit resource/operation grants. The existing loopback bootstrap
cookie must not authorize execution, terminal input, delegation, provider approval
responses or remote access. Provider sandboxing, approvals and OS permissions
remain in force. Observed external sessions do not become managed automatically.

The Core must remain independent of Electron. A renderer must not receive
arbitrary filesystem, shell or IPC authority; validate sender and arguments and
keep captured output untrusted. Secret storage must work when the interface is
closed, without placing credentials in events, logs or the renderer.

Future Cloud connectivity must not store source code, conversations, terminal
output or session content, including in logs, traces, crash reports, queues and
backups. Content transport requires end-to-end protection between authorized
endpoints; control-plane metadata has a separate allowlist and retention policy.
No Cloud service, remote transport or cryptographic protocol exists here yet.

## Security model

The aggregate Analytics read endpoint inherits the observation cookie, Host/Origin
and fetch-metadata checks. Its explicit response projection excludes individual
source references and captured content, but retains model labels and filter metadata.
A disposable worker reads a SQLite WAL snapshot through a read-only connection;
the observer remains the only writer. Only metric/identity/provenance metadata is
materialized in that worker and only aggregates return to the bridge. Evidence,
projected bytes and V8 heap are bounded; one query runs at a time without a queue.
A 10-second watchdog covers startup through confirmed cleanup; late success is
rejected. Timeout responds while termination may still be pending, retaining the
slot until termination is confirmed. Client disconnect and shutdown cancel the
query; shutdown awaits cleanup even after timeout. Errors are explicit and exclude
diagnostics, paths and partial sums. Native SQL cleanup and OS/event-loop scheduling
can delay termination or the watchdog callback; this does not provide hard real-time
latency, a process RSS cap or multi-user isolation. The full local library report
can contain source paths and must not be used directly as an export payload.
See the [route contract](docs/api/rest.md#get-apianalyticsmodels).

ORQST is designed for a **single trusted OS user on a local machine**.

- The bridge binds `127.0.0.1` only. It has no public-listening mode.
- A random per-process secret is issued as an `HttpOnly`, `SameSite=Strict`
  session cookie by `GET /api/bootstrap`. All `/api/*` routes except bootstrap
  and the `/ws` upgrade require that cookie.
- Requests are rejected unless the `Host` header is a trusted loopback host,
  and any present `Origin` or `Sec-Fetch-Site` header is consistent with a
  same-origin request. This mitigates DNS rebinding and cross-site requests.
- JSON bodies must use `Content-Type: application/json`, are limited to 8 KiB,
  and are validated with zod.
- The static dashboard server rejects dotfile paths and NUL bytes, resolves
  files under the dashboard root, verifies the real path, and denies anything
  outside it. HTML fallback is limited to `/`, `/overview`, `/workspaces`,
  `/agents`, `/models`, `/artifacts`, `/settings` and strictly validated
  `/overview/sessions/<encoded-id>`; unknown extensionless paths return 404.
  Electron main-frame navigation and IPC sender authorization use the same fixed
  route schemas at the configured IPv4 loopback origin, without query strings or
  credentials. Legacy fragments do not confer native or API authority.
- The Codex reader skips symlinks, opens files with `O_NOFOLLOW`, verifies the
  canonical path stays inside the session root, and never writes to the source.
- Responses set `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and
  `Cache-Control: no-store`.
- The process sets `umask(0o077)`. The data directory is `0700`, the database
  is `0600`, and symlinked data paths are refused.
- Captured content is treated as untrusted and rendered as plain text. It is
  never executed or interpreted as HTML.
- Text passes through a best-effort redaction filter for common secret shapes
  before storage, and is truncated to 32,000 characters.
- There is no telemetry, no analytics, and no automatic upload.

Full detail: [docs/architecture/security-model.md](docs/architecture/security-model.md).

## What ORQST does not protect against

These are known boundaries, not hidden assumptions:

- **Other processes running as the same OS user.** Any local process can call
  `/api/bootstrap` and obtain its own session cookie. ORQST is not a multi-user
  service and has no per-user authorization.
- **A compromised browser profile or OS account.** The cookie is `HttpOnly` but
  readable by a process with access to the profile or memory.
- **Encryption at rest.** The SQLite database and WAL files are plaintext.
  Filesystem permissions are the only access control.
- **Perfect secret redaction.** Redaction is pattern-based and can miss unusual
  formats, split secrets, or secrets embedded in binary data.
- **Malicious content execution.** ORQST does not execute captured content, but
  a future feature that renders Markdown or links would need a new review.
- **Public exposure.** Running ORQST behind a reverse proxy, on `0.0.0.0`, in a
  container with a published port, or on a shared host is unsupported and
  unsafe without additional authentication and TLS.
- **Supply-chain compromise** of dependencies, the Node runtime, or the OS.
- **Denial of service by a local user** with access to the same machine.

## Handling captured data

- Session files are read-only inputs. ORQST never modifies them.
- Raw logs, encrypted reasoning, account/identity blocks, and environment or
  configuration payloads are not copied into the database.
- Event details expire under the configured retention window. Session summaries
  and token totals remain. Compact schema-2 metric/model evidence also remains
  without automatic expiry, matching those totals; source references/labels/IDs
  remain sensitive local metadata. Its allowlist excludes prompts, messages, tool
  arguments/results, cwd and credential blocks. Backfill reads only retained events.
  This does not alter existing summary text or backup retention.
- Deleting `~/.orqst` (or the configured data directory) removes local history.
  Back up only if you understand that the database contains captured prompts and
  tool output.

## Dependency and release hygiene

- Dependencies are pinned through `pnpm-lock.yaml`.
- Do not add a dependency with an incompatible or unclear license.
- Do not commit `.env` files, database files, session captures, or credentials.
- Review any change to the HTTP server, WebSocket handshake, cookie logic,
  static file serving, path handling, or redaction as security-sensitive.

## Disclosure

Please give the owner reasonable time to investigate and fix an issue before
publishing details. The owner will credit reporters who want credit, unless
doing so would expose user data.

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
export. The subsequent [native Markdown boundary](docs/api/artifacts.md#native-desktop-save-contract)
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
[Desktop development](docs/development/desktop.md) for setup/version sources.

## Tray/native notification review — 2026-11-02

Historical scope: the statements below describe that increment before native file
export. The subsequent [native Markdown boundary](docs/api/artifacts.md#native-desktop-save-contract)
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
[Desktop details](docs/development/desktop.md).

## Manual Artifacts — extraction-only historical review

This section records the first extraction/copy slice. The later
[native Markdown boundary](docs/api/artifacts.md#native-desktop-save-contract) adds reviewed save/overwrite and
optional current-file opening; the earlier absence of file authority was scoped to that slice.

Manual extraction reads only one authenticated, identity/source-matched retained
assistant/agent message, capped at 32 KiB UTF-8. Missing evidence is not reconstructed.
The original retained representation remains immutable; draft edits are memory-only.
The limited preview uses inert React text, without active HTML, links, images or remote
loads. Clipboard writes require explicit gestures and report failures. No source-file,
filesystem/shell, save/overwrite or external-editor authority is introduced. See the
[boundary review and contract](docs/api/artifacts.md#security-review-note).

## Native Markdown export

Desktop's sole Artifacts preload/IPC action is a bounded, versioned Markdown save.
Main validates sender/frame/session/document and reextracts original provenance;
the renderer supplies no filesystem path, URL, executable or reusable file grant.
Only a native destination chooser and concrete replacement confirmation authorize
writes. Cancellation writes nothing. Existing destinations must be regular,
nonexecutable, single-link `.md` files no larger than 32 KiB. Descriptor/parent/path
and byte checks reject observed changes; new files use O_EXCL and no target opens
with O_TRUNC. Save-and-open can hand only this operation's newly saved verified file
to the system default application, without shell commands or open-history authority.

Saves are in place, not atomic or crash-recoverable. Partial I/O failure is reported
explicitly; checks cannot isolate a noncooperating same-user writer or make OS handoff
atomic. There is no automatic retry/rollback. No text/path/OS error logs or broader
clipboard permission are introduced. See [file contract and validation limits](docs/api/artifacts.md#native-desktop-save-contract).

## Confirmed Live Metrics

The local authenticated session-metrics GET preserves Host/Origin/cookie/CSP/no-store
controls and grants no source-file or agent authority. Indexed reads admit bounded
metadata bytes before transfer/parsing; strict provenance/identity validation fails
unavailable without raw diagnostics. Compact IDs/paths remain sensitive local metadata.
See [contract and security review](docs/api/live-metrics.md).

## Browser Analytics report export

CSV/Markdown export is an explicit browser gesture over the current validated,
bounded aggregate. It excludes individual evidence, captured content and private
filter values. Observed model IDs are arbitrary metadata and may contain secrets or
identities; review before sharing. Encoding does not prove absence of secrets.
CSV guards textual cells and preserves large integer digits with a typed literal;
Markdown encodes structural characters inside code spans. Subsequent spreadsheet or
Markdown reprocessing has its own trust boundary. Browser settings govern destination
and replacement; ORQST cannot confirm a disk save.

Offline/stale/failed reads cannot export; recovery needs a fresh response. No endpoint,
authentication, database, source-file or native grant changes. Desktop downloads
remain denied. A separate native Analytics capability is described below.
See the [export contract and review](docs/api/analytics-export.md).

## Native aggregate Analytics export

The strict Analytics-only IPC accepts a bounded reading/query/digest and format,
never page content or a destination. Main checks the live sender/session/main-frame
and document generation, consumes context, reobtains the authenticated aggregate
and compares it to the confirmed reading before and after native dialogs. Fixed
empty-event cursor checks avoid fetching session snapshots. Context updates revoke
pending saves even while a dialog is open; old acknowledgments cannot reauthorize.
One file operation is admitted across Analytics/Artifacts, without queued retries.

A native chooser and concrete replacement confirmation grant only this operation's
`.csv` or `.md` destination. The shared descriptor policy preserves Artifacts' 32 KiB
Markdown limit and enforces Analytics' 2 MiB limit. There is no generic filesystem,
shell or open capability. Partial failure/race and concurrent post-check source
changes remain possible; no atomic database-to-file snapshot or rollback is claimed.
Model identifiers can contain private metadata, and encoding is not redaction.
See [contract and security review](docs/api/analytics-export.md).

Partial session model history uses a separate bounded authenticated read of existing
compact evidence, excluding source paths and captured bodies. It adds no cache or
credential access. See the [security review](docs/api/model-history.md#client-behavior-and-security-review).

## Observed usage evolution review

The additive `/api/analytics/models/evolution` read inherits aggregate authentication,
Host/Origin/fetch controls, one-worker deadline/admission limits and no-store headers.
It adds no writer, source-file reader, schema migration or Desktop grant. Runtime
schemas bound and reconcile at most 64 windows; individual evidence stays worker-local.
Aggregate query/model metadata keeps the existing privacy limits. See the
[contract and detailed security review](docs/api/analytics-evolution.md).

The session Observed tools view is retained historical evidence, not a terminal
connection or execution surface. It never interprets terminal escapes or sends
input to an agent. Interactive terminals remain gated by the
[terminal security boundary](docs/development/terminal-boundary.md).

## Synthetic PTY experiment review

The subsequent [owned terminal library](docs/development/terminal-owned-lab.md)
adds experimental signed one-use operation grants, revocable input leases and
owned-handle I/O. It is not exported/composed into the runtime and adds no API,
IPC, native signer or execution credential. Automatic tests use in-memory handles;
the opt-in fixture uses ephemeral test-only signing keys. This proves signature
binding/replay and synthetic lifecycle behavior, not native user consent, secure
enrollment, executable binding, isolation or crash recovery. No real provider is
authorized or launched; these gaps block production composition.

The opt-in [PTY acceptance command](docs/development/terminal-pty-acceptance.md)
starts only fixed disposable Node fixtures outside the application runtime. Its
locked `node-pty` dependency is development-only; no API, IPC, renderer, database
or observed-session authority is added. The exact authorization flag, private
temporary directories, minimal child environment, output budget and cooperative
deadlines constrain this experiment; they are not an OS sandbox. Parent termination
can bypass temporary-file cleanup, and native/event-loop failure is not contained.
Provider, native authorization, descendant cleanup, emulator and packaging remain
unvalidated. See the [proposed design](docs/architecture/managed-terminal-design.md).

## Experimental native terminal boundary — 2026-11-03

The [native terminal broker](docs/api/terminal-native.md) and Electron helpers are implemented but
uncomposed. No application IPC/API/control surface, observer permission or provider
capability is enabled. Strict requests, private exact-action signatures, native
sender/document/focus checks and lifecycle revocation have synthetic coverage;
actual native gesture, independent enrollment/transport, immutable admission,
containment and durable recovery remain acceptance gates. External sessions are
never adopted. Explicit supervisor teardown retains uncertain live ownership
without signaling, retrying or claiming process exit.

## Isolated native Terminal acceptance application — 2026-11-03

The [explicit synthetic native lab](docs/development/terminal-native-acceptance.md)
now exercises a dedicated sandboxed document/session/preload, native IPC and private
Node-host PTY. It is never loaded by the normal observer Desktop/Bridge. No existing
API/WS/cookie/route authority changes. Keys/proofs/leases stay native; strict bounded
messages, exact native sender/document checks, blur revocation and permanent reload
revocation protect the lab path. Host loss retains ownership uncertainty. Acceptance
intercepts native dialogs and starts only a watchdog-bounded credential-free fixture.
It proves neither a human native grant nor immutable provider admission, containment,
durable recovery or Codex execution; those gates continue blocking activation.

## Opt-in terminal journal review — 2026-11-03

The [durable recovery library](docs/development/terminal-recovery.md) adds private
metadata-only SQLite persistence through the existing Store, outside normal startup
and the native lab. It exposes no API/WS/IPC, cookie authority, source reader or
provider capability. One-use grants still authorize effects; durable epochs fence
old owners. Admission commits before backend execution, and synchronous effects
hold the owner transaction lock. Foreign outer transactions are denied. Recovery
and shutdown preserve uncertainty without PID adoption, signals or automatic retry.
Lost ownership is never pruned or converted to an exit to free capacity. No prompts,
output, argv, environment, credentials or grant material enter the journal.

Synthetic SQLite/restart/abrupt-writer-exit tests establish metadata semantics only.
They do not close native executable/cwd races, supply a resource sandbox, enroll a
production client or validate managed Codex. Same-user malware, storage failure and
native-provider survival/descendants remain outside this evidence. Normal observer
permissions and read-only external sessions remain intact.

## Artifact source library

The exact `/artifacts` route uses the existing dashboard document policy. It grants no
new API, native file operation or source-file access. Search over a bounded loaded window
of retained Codex messages stays in renderer memory, with explicit coverage and stale/
retention/limit states. Excerpts and source references are inert plain text. Opening a
message reuses exact-identity manual extraction; saved files and drafts are not indexed.
See the [security review](docs/api/artifacts.md#source-library-security-review--2026-11-03).

The experimental Core pane communication library is opt-in and has no public
transport. Its native enrollment/admin functions must never be exposed as agent
MCP tools or authorized by captured text. Scoped clients and content resolvers require
independently verified workspace/actor/target authority. It cannot control observed
sessions or write to a PTY. Real provider communication is not enabled; see
[the communication contract](docs/api/pane-communication.md) for limits and recovery.

## Structured existing-login review — 2026-11-03

An explicit developer manifest can retain native Codex login/config while using
new ephemeral threads and per-slot SQLite/log/temp state. ORQST never reads/copies
credentials or starts login. Native account checks drop identity fields and fail
closed before threads/tasks on unsupported/missing authentication. Shared native
configuration, configured MCP startup, auth refresh and cache writes remain part
of the disclosed same-user boundary; physical isolation is not claimed. Reuse is
rejected by legacy PTY profiles. No API/WS/IPC authority or observer behavior changes.
See [the security model](docs/architecture/security-model.md#structured-codex-existing-login-boundary--2026-11-03).

Read-only command sandboxing does not prevent same-user credential reads, and MCP
tools are outside that sandbox. The explicit acceptance rejects observed command,
file, MCP or other unexpected item types; it cannot prevent their side effects.
The reuse canary config is not the active user config. Remote catalog disabling
is not a global installed-plugin deny policy; no hard isolation is claimed.

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
retroactively. See [the detailed contract](docs/development/codex-lifecycle-receipts.md).

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
changes. Historical timeouts remain unproven. See [the counter contract](docs/development/codex-startup-diagnostics.md).

Structured Desktop retirement requires signed native review, confirmed exits for
all dispatched processes (or proof none was dispatched) and valid journal ownership.
It archives admission/task metadata, then fences the old runtime before releasing
capacity, and preserves uncertain outcomes and journals.
It cannot recover older/post-crash/lost-owner markers or prove descendant cleanup;
never delete evidence to bypass admission. See [client limits](docs/development/managed-agents-client.md).

Managed-agents focus refusal feedback is a bounded private IPC status, not a grant.
Native document identity and window/content focus remain required before signing;
the client never bypasses them or automatically retries. Native reopening can
restore a minimized view without process authority. Active OS focus/modal acceptance
and post-crash reconciliation remain unvalidated; see
[managed client limits](docs/development/managed-agents-client.md).

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

### Explicit Desktop MCP composition security review

`--interactive-mcp` creates one private Unix hub per opted-in terminal pair,
with distinct role capabilities, before either provider starts. Authentication
does not grant tasks. Separate native signatures bind launch manifests and the
later one-use A-to-B-to-A grant to actual owned instance UUIDs, workspace and epoch.
Neither renderer IPC nor the observer API can authorize that grant. Lost/exited/
disposed handles and authenticated MCP disconnection invalidate task authority;
MCP loss never establishes process exit or releases capacity.

The reviewed Codex configuration adds a random server name through argv without
editing native configuration or disabling native MCPs. Endpoint paths are visible
to the native process; capability contents stay in private files. The pinned relay
is required, so its startup failure can prevent TUI startup. Same-user replacement,
shared native config/auth/session writes and provider tool permissions retain their
existing limitations. No real-provider, human-focus or sandbox acceptance is claimed.

## Experimental Claude native Desktop opt-in

The [version-scoped native Claude path](docs/development/claude-interactive-terminal.md)
requires explicit shared-native-state and per-start consent. It never copies provider
credentials or adopts an external session. Native configuration/hooks/plugins and
session writes remain shared; this is trusted same-user execution, without a sandbox.
Optional strict MCP excludes other MCP definitions and grants no task/tool permissions
automatically. OpenCode execution remains unavailable. Synthetic process validation
does not establish native login/MCP/inference or unlocked-console focus acceptance.

## OpenCode Desktop explicit native startup opt-in — 2026-11-03

The [Desktop factory](docs/development/opencode-desktop-terminal.md) now accepts
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
are unchanged. See [review and limits](docs/development/embedded-terminal-panels.md).

### Studio layout boundary (2026-11-03)

Terminal A/B navigation, orientation, maximize/restore, focus and proportional resizing
use the same dedicated terminal sender validation. Main accepts a fixed action
allowlist or an exact 25–75 integer percentage, binds the source slot natively and
requires the current reserved frame/session/generation plus visible native focus.
The observer preload and public HTTP/WebSocket remain unchanged. Layout notifications
contain only orientation/proportion/visible slots/count. Layout actions revoke input
leases and never grant execution, start a provider, restore a process, stop a task
or rewrite session data. Tab labels come from reviewed manifests, not provider output.

## Native pair-creation file boundary — 2026-11-03

The native menu can now create two private terminal manifests after parented
Cancel-default review and explicit identity/session acknowledgment. File choosers
do not resolve aliases; canonical paths, ownership/modes, O_NOFOLLOW executable
hashing, exact provider pins, directory identities, empty-project checks and focused
expiring consent apply. Common trusted HOME/project roots need not be private; new
state remains 0700/0600. No version command, credential/configuration/native-DB read,
provider process, Core, journal or admission claim is performed by creation.
Both completed skeletons publish via same-parent rename; unpublished partial files
point at absent state and remain ineligible, never automatically removed. Same-user
malicious path replacement and power-loss durability are not stronger guarantees.
A native-only typed failure permits fresh selection solely after complete view
cleanup before admission/Core. Attempt-specific volatile partitions avoid reusing
protocol registrations; failed-session handlers are unregistered before retry proof.
Any possible write/transport effect keeps the latch.
Capacity feedback contains no paths/marker content and provides no takeover, reset
or signal action. No observer HTTP/WS/cookie/static/schema, dependency or credentials
interface changed. See [workflow and limits](docs/development/cli-team-recovery.md).

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
consent remain separate. See [runtime comparison and limits](docs/research/native-cli-runtime-comparison.md).

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
