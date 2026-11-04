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

Publish the complete clean source and delivery tag before any native compilation.
The local generated manifest must retain the actual frozen SHA, toolchain,
commands/exits, failures/reruns, source/resource hashes and preservation inventory.
Compile serially in the existing coordinated target with locked/offline inputs,
debug information and incremental compilation disabled, and one build job.
Keep more than 4 GiB free between heavy steps.

The authorized new destination is only
`dist/native-preview-policy-notifications/ORQST Preview.app`, with its adjacent
`build-manifest.json`. Preserve the complete existing Preview and Coexistence 698
apps and their binaries. Dashboard-only build, resource staging, custom-protocol
native build and debug app bundle must precede outer-only ad hoc signing and final
deep/strict verification. Preserve the bundled Node's original bytes and Developer
ID signature. No package is started by this build authorization.

Native compilation, the three URL-composition tests and new Rust notification
tests remain pending at this source freeze. Record their actual results separately
after execution; do not infer them from the pure Node/standalone Rust checks.

## Open acceptance and parity

The default Tauri data store differs from non-persistent Electron sessions;
persisted grants may bypass callbacks; macOS geolocation/browser-notification/
clipboard-read callbacks are unavailable. No incognito, store reset, new flags or
saved-permission cleanup is included. Actual OS click delivery, WebKit/draft/focus/
reload/clipboard behavior, native files/export, banner/sound/identity/permissions,
effective provider/model, real MCP and final Quit remain unaccepted. A plugin
`show()` result is not a delivery receipt. Packaging cannot close these gates or
establish the cause of the historical Codex failure. Keep Electron retirement open.
