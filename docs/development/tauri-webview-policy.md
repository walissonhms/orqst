# Tauri webview policy — 2026-11-04

The [pinned policy review](../research/tauri-webview-policy.md) found a real
media-permission default difference in Wry 0.57.1, platform download-default
differences, and a dashboard document-route difference from Electron.

The native shell now denies new permission requests reaching supported backend
callbacks using Tauri's global handler and rejects browser downloads in all four webview builders. Dashboard
navigation additionally requires an existing protocol SPA path. It retains the
previous exact origin/credential/query restrictions and exact unavailable URL.
Custom protocols/CSP, capabilities, focus/document generations and native file
save/open/export remain unchanged. This is source hardening; Electron retirement
and native/platform acceptance remain incomplete.

## Checks for this increment

- `rustc --edition 2021 --test apps/tauri/src-tauri/src/webview_policy.rs -o /private/tmp/orqst-webview-policy-tests-720` and the resulting test binary:
  **4 tests passed**. These are pure path/encoding tests, with no native runtime.
- `rustfmt --edition 2021 --config skip_children=true --check` on
  `main.rs`, `terminal.rs`, `features.rs`, `agents.rs`, `webview_policy.rs`:
  passed after formatting.
- Node **24.22.2**, `--import tsx --test tests/desktop-policy.test.ts
tests/dashboard-routes.test.ts tests/tauri-files.test.ts`: **14 tests passed**.
  These existing synthetic tests cover navigation/session paths, native saver
  contracts and renderer validation; they do not execute the Tauri/Wry callbacks.
  First run: **13 passed, 1 failed** resolving `@tauri-apps/api/core` because this
  isolated worktree lacked the app-local dependency links. Exposing the already
  installed `apps/tauri/node_modules` and rerunning produced 14/14. No dependency
  install or product source fix was needed; this was a test setup failure.
- Crate archive SHA-256 and all 15 inspected backend/API files matched the lock
  and published archives; this verifies source provenance, not native behavior.
- Cargo tests/Clippy, application compilation, resources and packaging were not
  run here: the integration owner runs native checks serially. The three new
  URL-composition tests in `main.rs` therefore remain unexecuted in this delivery.
- No app/CLI/provider, Core/PTY, authentication database, quarantine or uncertain
  runtime state was accessed or changed. Disk was approximately 26 GiB free before
  the lightweight tests; no heavy build or resource staging took place.
- Full repository lint/typecheck/test/build were not run. Changed documentation
  passed Prettier and `git diff --check`; Rust passed the focused formatter check.

Open Electron-retirement gaps are the default persistent Tauri data store versus
non-persistent Electron sessions, existing browser grants potentially bypassing
callbacks, and missing macOS geolocation/browser-notification/clipboard-read
callbacks. No incognito/store reset/flags or saved-permission cleanup is included.
Neither this denial policy nor the synthetic tests establish integral parity or
native acceptance of those cases.

## Acceptance still required

- Compile and run all native Rust tests in default/custom-protocol modes under
  the coordinated toolchain, plus Clippy. Prove the global permission callback
  and both webview builder download APIs integrate with the locked dependency graph.
- In a separately authorized disposable native fixture, verify permission denial
  for supported types and explicit browser downloads from all four documents.
  macOS unsupported permission kinds and pre-existing saved decisions need their
  own evidence; the handler alone cannot establish them.
- Accept bootstrap, SPA navigation, session/hash links, unavailable startup/runtime
  presentation, focus/reload fencing, clipboard keys and native file save/cancel/
  overwrite/open/export. None is accepted merely by these pure tests.
- Validate Windows and Linux backend behavior on those platforms before claiming
  parity. Do not label absence of a native hook as either allow or deny.

No Bridge HTTP/WebSocket/API schema changes or new capabilities are introduced.
See [native policy contract](../api/tauri-webview-policy.md) for callback limits.
