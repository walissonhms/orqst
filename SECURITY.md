# Security policy

## Offline recovery authority review — 2026-11-04

Offline non-dispatch recovery has a separate administrative signing domain and
native kernel boot source, complete private capture and revalidation, and durable
archive-before-release ordering. Deny-only admission hooks preserve its sticky
gate through cancellation and uncertain effects. There is no renderer/HTTP/RPC
recovery authority or native integration yet. Read the
[threat model and integration prerequisites](docs/research/offline-reservation-recovery-contract.md)
and [final durability boundary](docs/api/offline-reservation-recovery.md).

## Integrated diagnostic security review — 2026-11-04

The integration preserves native document/request/owner fences and keyed append/EOF cleanup; public Stop is byte-identical to the combined opening source. FIFO and append-error regressions passed in the standalone runner. Logger failure cannot authorize retry or release reservations. No HTTP/WebSocket/cookie/static-serving change. See [integration and remaining limits](docs/development/tauri-opening-diagnostics-integration.md).

Tauri now explicitly denies new webview permission requests reaching supported
backend callbacks and rejects browser downloads in every owned webview builder.
Dashboard document navigation additionally requires an existing SPA/session path.
OS permissions, persisted browser decisions and unsupported backend callbacks are
not proven by this policy. See [source-backed limits](docs/research/tauri-webview-policy.md).
Native file/export authority and existing CSP/document/focus/capabilities remain unchanged.

OpenCode's normal catalogue groups only native candidates individually verified
against the same exact binary pin, retaining existing canonical PATH precedence.
Native consent still reviews the chosen exact path/hash; manifests and signed Start
retain their existing path/hash/source/ownership validation. No provider probe,
server, credential access, state recovery or observer execution route is added.
See [the equivalence review](docs/research/opencode-executable-equivalence.md).

OpenCode full TUI model selection uses only per-process `OPENCODE_CONFIG_CONTENT`,
composed with the existing generated MCP document. No inherited inline config or
global settings are rewritten. Model evidence is revalidated before dispatch;
native agent/managed settings, variant preferences and availability can override
the initial default. Effective selection remains unverified without CLI evidence.

OpenCode's passive catalogue also reads the CLI's own preference document
(`<XDG_STATE_HOME|~/.local/state>/opencode/model.json`) — metadata, no credentials —
and offers those references as `native-state` choices with unverified availability.
Only the selected entry is source evidence, so unrelated preference rotation cannot
invalidate a choice, and a removed entry is refused before any effect. The normal
native consent and failure sheets now carry short localised effect text; the complete
configuration stays in the owner-only written manifest, and no startup, shared
identity, MCP, cost or uncertainty disclosure was removed. See
[the catalogue and consent review](docs/research/opencode-model-catalog.md).

## Private incremental terminal enrollment — 2026-11-04

Inherited trusted Core IPC can admit one prepared slot without granting Start,
output or keyboard input. Epoch/opId/CAS, immutable source/revision binding,
exclusive durable evidence and bounded isolated timeouts preserve prior slots.
Partial effects retain capacity; inspection never retries/adopts an uncertain
operation. No renderer path/proof authority, observer migration, credential read
or public endpoint is added. See [contract and security review](docs/api/terminal-enrollment.md).
Native/provider acceptance remains separate from pure mocked transport checks.

## Tauri Studio preparation — 2026-11-04

The owned main dashboard now has one narrow `studio_request` capability for passive
Codex/Claude 1–8 preparation and review of native-held files. Actual Webview/parent,
origin/document, generation and AppKit focus are authoritative; no paths, PID,
proof, task, Start or arbitrary Core operation comes from the renderer. Menu and
Studio reuse the same exclusion/write/admission latches and native confirmations.
The existing AppKit observer also revokes preparation on deactivation/another key
window while retaining main's exact own-sheet. Observer HTTP/WS and signed
MCP/retirement/Quit authority are unchanged. See the [contract and security review](docs/api/tauri-studio.md).
Native/provider/final-Quit acceptance is still pending.

## Tauri interactive MCP consent — 2026-11-04

Only the native menu can request a one-use grant for an explicitly opted-in pair.
Native document/focus/generation checks and Cancel-default review precede Node's
signature; existing Core independently checks owned running instances and replay.
No renderer MCP command, observer API, provider approval or task injection is added.
Reload/destruction invalidates the channel; hide cancels pending review. Sticky
reservations and the previous quarantine remain untouched. Native UI/provider
acceptance and Rust compilation for this increment remain pending. See the
[security review and pinned sources](docs/research/tauri-interactive-mcp.md).

## Tauri preview process boundary — 2026-11-04

The terminal retirement menu uses the existing evidence-bound signed Core RPC over
the private native pipe. Every dispatched process needs its owned exit and every
journal/reservation must remain owned. A possibly consumed proof or lost reply
fences the client; native selection remains single-use until application restart.
No observer/renderer retirement capability, automatic recovery or uncertain-capacity
release is exposed. See [retirement security review](docs/development/tauri-terminal-retirement.md#security-review).

Native preparation captures the original document URL/generation at menu dispatch,
rechecks focus before starting its passive helper and invalidates that generation
when another ORQST window takes focus or the dashboard closes. Returning to the
dashboard cannot revive the pending review. Native picker/sheet transitions remain
separate from Tauri window changes; signed CLI starts retain their stricter checks.

The opt-in Tauri preview starts its fixed packaged Node Core in a separate
private profile. The observer renderer has no Tauri capabilities or executable commands,
restricts navigation to its owned loopback origin and denies new windows. Node
receives an environment allowlist, validates its packaged dashboard before READY,
and retains the existing Bridge Host/Origin, cookie, WebSocket and CSP protections.
Native shutdown addresses only retained children. Explicit `ORQST_TAURI_TERMINALS`
selection adds a separate private pipe to the existing managed Node host and broker.
Only dedicated local terminal documents get the two terminal commands; no remote
origin, shell, filesystem or dialog plugin permission is granted to renderers.
Native identity/focus, bounded exact-action confirmation, signed grants, input
revocation and existing manifest/journal admission checks remain authoritative.
Malformed public requests are denied without fencing unrelated slots. Reload closes
that document permanently; hiding revokes input without stopping its process.
No observer execution endpoint, observed-session control, PID adoption or automatic
respawn is introduced. Full native consent/keyboard/provider parity remains unaccepted.
See [implementation and remaining parity](docs/development/tauri.md) and the
[private process contract](docs/api/desktop-sidecar.md). Complete native dependency
redistribution notices and signed installers remain release prerequisites.

Native-menu preparation also reuses the existing passive manifest provisioner and
full selection review for 1–8 same-provider Codex/Claude terminals. It uses a fixed
short-lived bundled Node helper with a bounded private pipe, no renderer capability
or public API. Native pickers and separate Cancel-default reviews bind configuration,
shared native effects and opening; CLI startup remains independently signed. A
document-generation/visibility/expiry check fences navigation and reload. A native
latch precedes possible writes, and a distinct single-attempt latch precedes Core
admission. Cancellation preserves completed files for fresh review; uncertain state
and reservations are never removed to retry. See the
[component and security review](docs/research/tauri-terminal-preparation.md).

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
expanded. See [precise limits and verification](docs/development/terminal-teams.md).

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
are unchanged. See the [layout guide](docs/development/terminal-workspace-layout.md).

## Tauri workspace focus boundary — 2026-11-04

The retained Tauri grid binds commands to each exact local terminal webview, not
only its parent window. On macOS, mutation/approval focus requires the native
NSWindow first responder to belong to the owned WKWebView. The check runs on
Tauri's UI thread and fails closed on other platforms. No renderer active-slot
or JavaScript focus value grants execution authority. Layout changes, hiding,
parent blur and document reload retain input/consent revocation. Layout metadata
uses the existing private, UUID-keyed, symlink-resistant preference store and
cannot start, stop, adopt or recover a session. Observer HTTP/WS/cookie and source
access controls remain unchanged. See the [component review](docs/research/tauri-terminal-workspace.md).

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
provider acceptance remain pending. See the [native contract](docs/api/tauri-agents.md).

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
See the [native desktop guide](docs/development/tauri-native-desktop.md).

## Tauri native file export boundary

The Tauri main dashboard now has one dynamically scoped export command for its
exact owned loopback origin and native document, without renderer filesystem,
dialog, shell or managed-execution permissions. Paths remain in the private
Rust/Node transport. Existing artifact/Analytics validators, one-use readings,
secure destination checks and serializers are reused. Reload, parent loss and
bounded timeouts revoke operations; uncertain writes are not retried. Standalone
Bridge HTTP/cookie/CSP behavior is unchanged. See the
[contract, security review and remaining limits](docs/api/tauri-files.md).

MCP consent and terminal retirement are serialized across every Tauri pane, from
preparation through review. Either document's revocation cancels pending consent;
possibly consumed retirement proofs fence later MCP and terminal work. The native
reviewer is selected by exact document and native first-responder focus. No new
renderer capability, provider-tool approval or observed-session authority is added.

Terminal layout preferences are opt-in visual metadata written by the owned Node
Core into a separate private SQLite database. Legacy JSON import preserves originals.
Restored UUIDs/names/layouts grant no process ownership or communication permission.
See the [private layout RPC boundary](docs/api/terminal-native.md#private-layout-persistence-rpc--2026-11-04).

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

The native Feature metadata facade is scoped to the exact owned dashboard/chrome
and reviewed terminal selection. It grants no process/input authority and exposes
no generic Core/HTTP execution transport. Its document, CAS, review-exclusion and
presentation fences are documented in [the security model](docs/architecture/security-model.md#native-feature-metadata-facade).

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

Native incremental terminal enrollment is restricted to the inherited owned
parent/Core pipe. Epoch/CAS/capacity and exact document/presentation fences remain
separate from signed Start/output/input grants. Uncertain additions are retained,
not retried or adopted; no renderer-controlled manifest or public endpoint is
introduced. Native/provider acceptance is still pending. See
[the source increment](docs/development/terminal-native-enrollment.md).

## Tauri unavailable and explicit pair boundaries — 2026-11-04

The fixed observer-unavailable custom protocol serves only its exact local GET
document with escaped EN/PT text and no script, IPC, network or retry controls.
Existing native remote capabilities remain bound to the owned dashboard origin.
Explicit fresh Codex/OpenCode pair preparation reviews both models and bilateral
MCP opt-in; normal Open remains disabled for MCP. Operational Open and one-task
grants retain separate ownership, focus/document, revalidation and uncertainty
fences. No new observer execution API or transport is introduced. See the
[combined review and acceptance limits](docs/development/tauri-mcp-unavailable-integration.md).

## Tauri notification view routing review — 2026-11-04

Only Core source-gated allowlisted identities enter the bounded private monitor
pipe. The OS receives fixed category text and an opaque numeric ID, with the
session mapping confined to native RAM. Exact origin/generation/freshness and
one-use tap correlation precede a fresh authenticated snapshot membership check.
The dashboard keeps its existing draft guard and denies revoked/context-stale
results. This view event grants no execution or managed-session authority; no
HTTP/WebSocket/cookie/CSP/capability change is introduced. Actual OS delivery is
not inferred from show(). See [source, contract and limits](docs/development/tauri-notification-route.md).

## Selected terminal catalogue evidence — 2026-11-04

Normal terminal preparation binds the selected executable/native context/model and
configuration independently from unrelated provider discoveries. Semantic Codex
cache proofs retain the original selected expiry and validate the selected visible
entry, cache version and current freshness at provisioning and dispatch. Full native
review, binary pins, Workspace/Feature checks, signed launch and native commit latches
remain authoritative. No new observer API or retry is introduced. See [selection
binding review](docs/research/terminal-catalog-selection-binding.md).

## OpenCode saved-model and pre-write review integration — 2026-11-04

The passive native preference reader keeps canonical/O_NOFOLLOW/owner/permission and
bounded read/parse controls. Only selected model semantics bind revalidation. Native
summary consent retains actual selections/effects and optional complete details before
any commit; viewing details cannot authorize writes or bypass stale context. Exact
operational Open and signed grants remain separate. No observer network surface,
provider server/probe, auth DB or credential access is added. Root NOTICE distributes
OpenCode's full pinned MIT grant. See [scope and checks](docs/development/opencode-model-catalog-ux.md).

The integrated source was frozen/published at `b78342f`, with 198 distinct focused
Node checks, 62 custom-protocol Rust tests, full lint/types/rustfmt and all-target
Clippy. Its separate local package verifies 115 resources, the complete distributed
MIT notice, original Node/license and deep/strict signatures; native/provider visual
and runtime acceptance remain pending. See the current delivery evidence linked above.

## Passive terminal admission diagnostics — 2026-11-04

Reservation inspection is read-only, canonical, O_NOFOLLOW, owner/mode/inode checked
and bounded to 16 KiB. Existing reservations are preserved; inspection never claims,
reconciles or frees capacity. Same-Core evidence stays in native private argv/IPC.
Startup errors expose fixed stage/code/effects only; unknown/EOF/timeout remains
possible. Native commit/open evidence cannot be downgraded, and old append replies
cannot release another owner/request's latch. No HTTP/WS, cookie, CSP or execution
authority is added. See [scope and verification limits](docs/development/terminal-admission-diagnostics.md).

## Optional native diagnostic files

The Tauri source has a closed, best-effort diagnostic sink under native app-data,
with 0700/0600 permissions, record/queue/rotation budgets and no upload/API. It
accepts no captured content, raw stderr, credentials or private ownership/paths.
Diagnostic UUIDs grant no authority. Files can be incomplete or absent and cannot
prove no effects. See [controls and limitations](docs/development/local-diagnostics.md).

Offline recovery continuation keeps control records separate from phase consent.
Boot-scoped exclusive helper leases never infer process exit from PID absence;
partial/unknown controls stay reserved. Complete records are re-fsynced before
namespace release. Abort preserves the original reservation; finalization requires
a fresh independent administrative signature. No public/renderer API changed.

Offline marker exclusion now relies on the continuously present original marker
and existing legacy claim(wx) until the final signed/durable commit. Cleanup after
that point never reads, renames or unlinks a future active marker; only exact old
control objects can be removed. No atomicity across separate files is asserted.

The dedicated offline administrative entry has no renderer capability or public
recovery endpoint. Its independent fixed-path Ed25519 anchor is privately installed
and revalidated across reviews; phase-keyed private ACKs and full read-only native
details do not grant normal terminal authority. See [the native recovery boundary](docs/api/offline-native-recovery.md)
for budgets, same-user/rollback limits, uncertain effects and remaining review gates.

## Offline native consent clock — 2026-11-04

The private owned-pipe protocol is now version 2. Immutable full-review consent
precedes one fresh signed intention-bound challenge. Per-request nonces prevent
replayed revalidation ACKs; native continuous time and `Instant` begin in AppKit
before waking the worker. Core carries the conservative minimum deadline through
source/lease checks and effects, including the final marker rename. No renderer
key, HTTP/WS recovery authority, dependency or new public surface is added.
Existing format-1 anchors and incomplete captures are preserved. Synchronous
helper syscalls are not instantly interruptible by pipe/focus notifications.
See [clock, threat and preserved-state limits](docs/development/offline-recovery-consent-clock.md).

The optional offline historical binding candidate is untrusted native argv data,
not a renderer grant or a runtime identity. It must reproduce the complete frozen
enrollment preimage and receipt/context, be durably captured privately and receive
fresh phase approval. Current model-source content is deliberately not inspected;
normal launch/model validation is unchanged. See
[the exact boundary](docs/development/offline-historical-binding.md).

## Cross-boot administrative device difference — source contract

The offline-only snapshot may contain `physicalDifference` in its current RAW:
a single declared historical/current device pair and current enrollment critical
metadata. Historical signed bytes, all other preserved file metadata and complete
enrollment digests must still agree. Existing fresh native review explicitly
authorizes archiving the exact reservation without asserting filesystem/volume
continuity; existing release and final-commit signatures remain separate.
Launch/claim rules and future-owner cleanup boundaries stay unchanged.
The final commit additionally pins the released reservation's current file
identities and declared difference; a later device generation is refused as
`pre_commit_physical_source_changed` before its approval and before the marker
rename.
See [the executable contract, research and pending acceptance](docs/research/offline-cross-boot-admission.md).
No real-state use, native UI, build or provider acceptance is claimed here.

The released physical generation pin covers snapshot files, the device pair and
five ordered runtime identities per slot. Selected model-source metadata remains
fully bound to each phase's RAW/review and repeated approval checks; it is not
frozen across phases. The unchanged full historical preimage proof restricts the
exception to its single selected inode on the projected device. No provider
configuration content is read and no runtime authority is restored.

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
