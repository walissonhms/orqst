# Webview policy and notification integration — 2026-11-04

The clean published base was `f8db3dd4e631731e4b95d40b29f249918476725b`.
The deliveries were integrated in order, with the notification setup hook retained
as a separate commit:

| Original delivery | Integrated commit | Scope                                                                 |
| ----------------- | ----------------- | --------------------------------------------------------------------- |
| `01e6e7a`         | `7494fa2`         | Codex selected-opening source review; documentation only              |
| `39e111d`         | `71babaf`         | Supported permission/download denial and dashboard route guard        |
| `ab0ce05`         | `b28e3a0`         | Source-backed notification selection, tests and documentation         |
| `93ac121`         | `902c5c5`         | One `desktop::configure` call after the owned Core origin is obtained |

Only four documentation introductions conflicted; both source deliveries were
preserved additively. The Rust callbacks, main policy and notification hook did
not conflict. No lifecycle, process, PTY, authentication or recovery behavior was
changed during integration. Original branches remain preservation references.

## Reviewed boundaries

- The [Codex review](../research/codex-selected-opening-review.md) demonstrates no
  source defect explaining the historical refusal. It changes no functionality
  and is not an opening fix. The exact failure still needs separately authorized
  native evidence; preserve every original attempt and uncertainty fence.
- The dashboard keeps bootstrap `/`, all seven SPA views, canonical bounded
  session paths and fragments. Navigation intersects that path policy with the
  existing exact owned `127.0.0.1` origin, credential/query restrictions and exact
  `orqst-unavailable://local/index.html`. API/assets/WebSocket paths are not
  dashboard documents. The unavailable responder's exact GET/component checks,
  custom documents/CSP, popup denial and native file save/open/export are intact.
- The installed Tauri 2.12.5 / runtime-wry 2.12.3 / Wry 0.57.1 sources expose the
  actual global permission and both builder download APIs used here. Their three
  cached archive hashes were rechecked against the documented lock values.
  New supported permission callbacks return Deny; all four webview builders deny
  requested downloads. This does not replace Electron's resource interception.
- Notification identity comes from the existing Core monitor's source/event/
  sequence/status/preference joins. A strict bounded private frame carries the
  optional ASCII identity. OS text remains fixed category text; numeric IDs map
  once to sessions in native RAM. The installed notification plugin 2.8.0 exposes
  the real tap/notification-ID API. Generation, freshness, current native origin,
  disconnect/opt-out/stop and failed preparation fence callbacks.
- The Tauri listener refreshes authenticated membership, requires one matching
  supported session, passes the returned snapshot directly to `openSession` and
  retains `requestNavigation`'s draft guard. Invalid/missing/duplicate identities,
  a newly arriving session, failed refresh, stale context, newer clicks, cancelled
  drafts and delayed affirmatives have pure regression coverage. No reload,
  session inference from prose or execution authority is introduced.

See the pinned [policy research](../research/tauri-webview-policy.md),
[policy contract](../api/tauri-webview-policy.md) and
[notification contract/source review](tauri-notification-route.md). Existing
Anywh/Tucano reuse decisions and licenses were re-inspected; no upstream source,
assets, dependencies or new runtime were incorporated by this integration.

## Current integration checks

Using the existing private Node 24.22.2 / pnpm 10.34.9 and Rust 1.99.1:

- `pnpm lint` and `pnpm typecheck`: passed on the combined source.
- `node --import tsx --test tests/desktop-policy.test.ts tests/dashboard-routes.test.ts tests/desktop-notification-route.test.ts tests/desktop-monitor.test.ts tests/desktop-monitor-qa.test.ts`:
  **20 distinct pure Node tests passed**, zero failures/skips. Each suite appears
  once in this combined run; no Core/service/session fixture was started.
- Standalone `rustc --test` for `webview_policy.rs`: **4 pure Rust tests passed**.
  These are not native callback or URL-composition acceptance.
- Existing-toolchain `rustfmt --edition 2021 --config skip_children=true --check`
  on all six affected Rust files, plus the separate main-hook diff/format review:
  passed. Full Prettier and staged/unstaged diff checks passed.
- The initial shell preflight found Node 20 and a pnpm launcher resolving Node 14;
  it failed before validation. Selecting the already installed private toolchain
  corrected the environment; no dependency install or product fix was needed.

The worker-reported 27 selected-opening and 14 policy/file Node cases, and earlier
48 Rust / 84 Node integration results, are preceding evidence. They were not
rerun or added to this delivery's counts. Full `pnpm test`, process-starting
sidecar/file tests, local session validation, browser/native/provider acceptance
and the root build are outside this source verification.

## Published freeze and coordinated build gate

The complete clean source was published atomically before compilation as
`b54b7feda15a797e3612c96e9c0fd5896c3732dc`, tagged
[`delivery/2026-11-04-tauri-policy-notifications-integration`](https://github.com/walissonhms/orqst/tree/delivery/2026-11-04-tauri-policy-notifications-integration).
All three original worker branches were published in the same atomic push.
The local generated manifest retains the frozen SHA/tree/tracked-input hashes,
toolchain, commands/exits, warnings, resource hashes and preservation inventory.
Subsequent package-report edits change documentation only, without rebuilding or
changing the source used by this package.

New local artifact: [ORQST Preview.app](../../dist/native-preview-policy-notifications/ORQST%20Preview.app),
with [build-manifest.json](../../dist/native-preview-policy-notifications/build-manifest.json).
These generated files are not committed and are absent from a source-only checkout.
Bundle identity is `dev.orqst.desktop.preview`. The final executable SHA-256 is
`a9dd91cd7d99a8aed49389a537178ab4fa1b2f4233cd208eccc460a8d60a39d0`.

| Current build evidence | Actual result                                                                                                                                                                      | Boundary                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Rust default           | 59 passed, zero failed/ignored                                                                                                                                                     | Includes the three composed URL tests and new notification parse/ID/revocation/origin cases |
| Rust custom-protocol   | Same 59 test names passed, zero failed/ignored                                                                                                                                     | Two configurations, not 118 distinct tests                                                  |
| Clippy                 | All-targets custom-protocol with `-D warnings` passed                                                                                                                              | Locked/offline native graph; no weakened lint                                               |
| Build/package          | Filtered dashboard, 17-notice resources, custom-protocol native build and debug app bundle passed                                                                                  | Local macOS Apple Silicon debug package; no runtime acceptance                              |
| Integrity/signature    | 114 configured resources matched before/after signing; Node bytes/license and original Developer ID signature retained; outer ad hoc signature and deep/strict verification passed | No deep signing, notarization, release or cross-platform acceptance                         |
| Preservation           | All five previous Preview app trees and target691 Coexistence 698 matched their pre-build file/directory/symlink/mode inventories and executable hashes                            | New app moved by same-volume rename into an absent destination; no old app replaced         |
| Disk/toolchain         | Existing target691, Node 24.22.2/pnpm 10.34.9, Rust 1.99.1, one job, debug/incremental off; minimum 26.0187 GiB and final 26.0188 GiB free                                         | More than the required 4 GiB remained between heavy commands                                |

All native test/Clippy/build/bundle/signature commands passed on their first run;
no native failure, source correction or build rerun was needed. Source refs and
tracked inputs were checked before each build step and after packaging. No open
files were found in the three staging trees before the filtered dashboard build
or resource script could replace generated files. No additional target, install,
dependency/lock change or duplicate temporary Node runtime was created.

The existing Vite large-chunk advisory and color-environment warnings remain;
the intentional bundler `--no-sign` warning precedes the successful separate
outer signing. Staging remains additive: its pre-existing root `.DS_Store` is
inventoried and retained outside the configured resource map. The 114 configured
resource matches do not claim a clean staging directory. No app, Core/PTY,
provider, session/probe/authentication or uncertain-state operation was executed.

## Open acceptance and parity

The default Tauri data store differs from non-persistent Electron sessions;
persisted grants may bypass callbacks; macOS geolocation/browser-notification/
clipboard-read callbacks are unavailable. No incognito, store reset, new flags or
saved-permission cleanup is included. Actual OS click delivery, WebKit/draft/focus/
reload/clipboard behavior, native files/export, banner/sound/identity/permissions,
effective provider/model, real MCP and final Quit remain unaccepted. A plugin
`show()` result is not a delivery receipt. Packaging cannot close these gates or
establish the cause of the historical Codex failure. Keep Electron retirement open.
