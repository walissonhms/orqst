# Security model

ORQST runs on a developer machine and reads agent sessions that may contain
source code, prompts, tool output, file paths, and accidentally pasted secrets.
The security model is therefore conservative: local-only, read-only, minimal
data, and no implicit trust in captured content.

The sections through the initial review note describe controls in the current
code. The final planned-controls section records Phase 0 design requirements,
not implemented protections. This is not a security certification.

## Trust boundaries

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

- The request path is URL-decoded and resolved under the dashboard root.
- A resolved path outside the root is rejected.
- Any path segment beginning with `.` is rejected, as are NUL bytes.
- The canonical path is resolved with `realpath` and must remain under the root.
- The target must be a regular file.
- Extensionless paths and the root fall back to `index.html`.
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
