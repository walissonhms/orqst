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
  outside it.
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
