# Tauri native file exports

The owned Tauri dashboard implements the existing `DesktopArtifacts` and
`DesktopAnalytics` version-1 interfaces. React components and the Electron path are
unchanged. The existing [artifact](artifacts.md#native-desktop-save-contract) and
[Analytics](analytics-export.md) contracts remain authoritative.

## Transport and authority

Rust installs `allow-file-request` at runtime for the **main webview only**, at the
exact IPv4-loopback origin announced by its owned Core. Native identity checks also
require the owned origin, no query or credentials and the current native document
generation. The host validates the native-supplied document URL through ORQST's existing
`allowedNavigation`/`dashboardPathSchema`; path-based views, bounded session routes
and hash navigation are allowed. Terminal/structured documents, other ports, `localhost`,
other paths and external pages have no export authority. There are no renderer
filesystem, dialog or shell plugin permissions and no new HTTP endpoint.

A shell-injected, top-level-only adapter exposes frozen `orqstArtifacts` and
`orqstAnalytics` objects before React starts. It validates inputs without dynamic
code generation, requires transient user activation for saving, shares one file
latch and returns only documented statuses. Native save requests additionally
require a visible, focused main window. Context invalidation works without focus
and while a save is pending.

`file_request` accepts a strict `{ kind: 'artifact' | 'analytics', input }` envelope.
`input` is the corresponding existing protocol request. The document URL is supplied
by Rust, never by the renderer. An artifact draft remains
explicit bounded text; original content is fetched from the retained event. Analytics
accepts reading identity/query/digest, never report bytes. Destination paths, URLs,
executables and arbitrary file contents are not accepted as save capabilities.

A separately owned Node 24 host receives bounded newline-delimited messages through
private stdin/stdout. It bootstraps once against the native-owned Core origin and
retains the HttpOnly session credential only in process memory. Its authenticated
fetch wrapper allows only the fixed artifact extraction, empty event cursor and
model aggregate routes and refuses redirects. Credentials never cross to Rust,
renderer results, logs or persisted records. Parent EOF and shutdown revoke work.

## Native flow

The Node host directly reuses `ArtifactSaver`, `AnalyticsSaver`, `readSaveOriginal`,
`readNativeAnalytics`, the existing serializers and `ReportDestination`. Rust supplies
the parented save picker and explicit replacement review. Analytics first shows the
localized reading scope in a native review because the Tauri picker cannot display
the Electron save dialog's detailed message. Cancelling either review/picker is inert.

New files retain `0600`, `O_EXCL|O_NOFOLLOW`, parent/path/descriptor identity checks,
extension/size limits and exact overwrite snapshots. Existing targets are never
opened with `O_TRUNC`. Analytics keeps cursor/digest checks before and after dialogs,
context generation and consumed reading IDs. CSV formula protection, `null` versus
zero and omission of private identities remain in the shared serializer.

Save-and-open can open only the just-written, reverified Markdown destination,
received from the trusted Node pipe. Rust uses the already installed shell plugin's
Rust API, with no shell command or renderer shell permission. Success means the OS
accepted the handoff; editor display is unverified. Failed handoff reports
`saved_open_failed` and is not retried.

Main-document loads revoke pending operations and contexts. Native replies are bound
to a request/document; late replies are inert. Requests are limited to 128 KiB and
at most eight outstanding calls, with one file dialog owner. The native deadline is
180 seconds. An uncertain timeout fences and stops the owned export host, without
retry or adoption. Startup failure leaves observation available. The feature can be
recovered by restarting the preview, not automatic respawn.

## Security review and limits

This increment intentionally gives the owned loopback dashboard one **narrow native
export capability**; historical descriptions of zero native capabilities no longer
apply to it. It still has no managed-execution permission. Standalone browser/Bridge
startup gains no native capability, and HTTP/CSP/Host/Origin/cookie behavior is
unchanged. Tauri can fall back from CSP-blocked custom-protocol IPC to its built-in
postMessage channel; no `unsafe-eval` or IPC network origin was added to Bridge CSP.

The Node writer's existing filesystem-race and partial-write limitations remain;
this is not an atomic transaction with retention/SQLite or a sandbox against every
local process. Revocation cannot undo an already completed write. Captured content
is still untrusted plain text and redaction is best-effort. No general file browser,
source-file opening, import, arbitrary extension export or history editing is added.
Native WebKit/dialog/default-app acceptance and other platforms are distinct from
the shipped Chromium/Node synthetic checks.
