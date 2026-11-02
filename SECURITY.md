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
architecture direction only. None is implemented or enabled by this approval.
See [ROADMAP](ROADMAP.md), [ADRs 015–024](docs/architecture/decisions.md) and
[planned lifecycle contracts](docs/api/lifecycle-contracts.md).

Before introducing control operations, require a separate Core-authenticated
principal and explicit resource/operation grants. The existing loopback bootstrap
cookie must not authorize execution, terminal input, delegation, provider approval
responses or remote access. Provider sandboxing, approvals and OS permissions
remain in force. Observed external sessions do not become managed automatically.

The Core must remain independent of Electron. A future renderer must not receive
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
  and token totals remain.
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
