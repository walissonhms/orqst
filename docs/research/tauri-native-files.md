# Tauri native exports: component review — 2026-11-04

## Baseline and stack

Isolated feature worktree from local `main` `332aca9`; concurrent worktrees and the
main checkout are preserved. Verified Node 24.22.2, pnpm 10.34.9, TypeScript 6.0.3,
Zod 4.6.7, Tauri 2.12.5, API 2.12.4, dialog 2.8.4 and shell 2.6.0 from installed
metadata and lockfiles. No dependency or lockfile changes.

## Required source inspection and decisions

Anywh's existing external research checkout was re-inspected at
[`546f189c04415c3c5af5f40e3931a0a90b9aba31`](https://github.com/anywh-sh/anywh/tree/546f189c04415c3c5af5f40e3931a0a90b9aba31),
including `docs/architecture.md`, `docs/agent-host.md` and
`relay/src/runtimes/README.md`, then the actual file-export candidate:

- [`client/src/lib/relay/fileDownload.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/lib/relay/fileDownload.ts):
  `downloadFile`, `collectFiles`, `downloadFolder`, `PartialFolderDownloadError`.
  Dependencies: Tauri dialog/fs plugins, relay file listing/raw URLs, profile/session
  identity and frontend byte buffers. The native picker yields a renderer path;
  the frontend fetches and writes bytes. Folder export recursively creates paths
  and reports partial failures. **Decision: keep ORQST's existing savers.** ORQST
  requires host-only destinations, retained redacted original validation, Analytics
  digest/cursor revocation, bounded private serialization and overwrite/symlink
  protection. Adapting the broader downloader would replace tested stricter code.
- Anywh's [`LICENSE`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
  is Apache-2.0. The inspected source has no distinct license header; `git ls-files
'*NOTICE*'` returns no NOTICE. `client/package.json` declares dialog `^2.7.3`, fs
  `^2.5.2` and API `^2`. These additional upstream plugin dependencies are **not
  incorporated**. No new Anywh source/assets are copied or adapted, so no new
  attribution entry is required. Existing Anywh adaptation/NOTICE is preserved.
- ORQST `apps/desktop/src/artifacts.ts`: `ArtifactSaver`, `readSaveOriginal`;
  `analytics.ts`: `AnalyticsSaver`, `readNativeAnalytics`; `artifact-files.ts`:
  `ReportDestination`, `MarkdownDestination`; `apps/analytics-export.ts`:
  canonicalization/serialization. **Decision: reuse directly without modification.**
  Existing protocol types and React controls are reused, not reimplemented.
- ORQST `tauri-agents-host.ts`, `tauri-terminal-preparation-host.ts`, Rust
  `agents.rs`/`terminal_creation.rs`, and `scripts/build-tauri-resources.mjs`:
  **adapt existing private-pipe/native-dialog packaging patterns**, with a dedicated
  export host, no process execution authority and document fencing.
- Tucano communication and Overclock pane/layout candidates are out of scope for
  file exports. Their existing audits are preserved; no source/assets are copied.

Tauri's [capability configuration](https://v2.tauri.app/reference/config/#securityconfig)
and [IPC source](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.5/crates/tauri/scripts/ipc-protocol.js)
were consulted alongside the installed 2.12.5 sources. Runtime capabilities permit
an exact discovered origin instead of a wildcard host/port grant. The private host
reuses `allowedNavigation` to validate the Rust-supplied current URL, preserving
existing path-based views/session routes without a second route parser in Rust. Bridge CSP is
preserved; built-in IPC postMessage fallback is available when protocol fetch is
blocked. Zod parsing uses `jitless` context in the injected adapter, since native
initialization may precede the response's no-eval CSP. A VM regression changes
Function availability between initialization and parsing.

## Implementation and integration checklist

- [x] Original/draft Markdown, explicit overwrite and save-then-open adapter.
- [x] Analytics CSV/Markdown, native scope review, digest/cursor revalidation and
      one-use reading semantics.
- [x] Shared writer's private mode, path identity, symlink/overwrite race guards.
- [x] Main-document identity, activation/focus gates, reload/EOF/timeout fencing,
      shared operation latch and context invalidation while busy.
- [x] Self-contained Node host and shell-injected client included in resources and
      existing dependency-notice collection.
- [ ] Human native WebKit save/cancel/overwrite, focus, reload/quit during picker
      and system default Markdown editor cycle.
- [ ] Native signed/notarized installer and Windows/Linux/Intel acceptance.
- [ ] Full Electron retirement and the unrelated migration checklist gates.

See [API/security review](../api/tauri-files.md) and
[workflow/check results](../development/tauri.md#native-file-exports--2026-11-04).
The parent integrator should merge this feature with concurrent native lifecycle
changes in `main.rs`, retaining `files::invalidate` on main document loads and
`files::stop` before Core shutdown. Keep Electron until native parity is accepted.
