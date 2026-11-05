# Studio preparation and reviewed mixed pair

## Tauri model selector with retained Webviews — 2026-11-05

The native preparation menu and Studio now resolve the owned dashboard Webview
separately from its parent Window. Retained Feature chrome and terminal Webviews
therefore no longer make `get_webview_window("main")` return `None` and refuse
preparation before the catalog helper starts. Dialogs remain parented to the same
native Window; URL/origin, generation, focus, expiry and admission checks are
unchanged. No execution authority or supported CLI/model is added.

See the [dependency and reference-source review](../research/tauri-studio-preparation.md#multi-webview-preparation-lookup-correction--2026-11-05).
The regression must be checked in the actual native application with retained
chrome present: open **+ Terminal**, verify the model choices for each provider,
then cancel without provisioning or launching a provider. Source checks alone
do not establish that native behavior.

## Where to click

In an updated Desktop, choose **Terminals / Studio** in the sidebar (also searchable
in the command palette), then **Prepare Codex + OpenCode…**. In Portuguese these
are **Terminais / Studio → Preparar Codex + OpenCode…**.

1. Review any ambiguous installed executable candidates. Discovery reads bounded
   filesystem metadata and hashes only; no CLI, shell profile, version or login
   command runs. A single matching provider candidate is included in the complete
   final review. Other providers and existing manifests remain under **Other
   preparation options** and in the native Terminal menu.
2. Choose an existing empty disposable test folder. The existing installed ORQST
   Node 24 receipt/hash is preferred; otherwise native PATH candidates are offered.
   The user does not need to know the installed runtime path. If no candidate can
   be reviewed, a native file chooser remains available. PATH candidates are not a
   fresh Node version check: Core still validates its host when explicitly opened.
3. Read the optional MCP choice, the separate OpenCode startup-effects choice and
   the complete path/hash/identity review. Cancel is the default and acknowledgment
   checkboxes start unchecked. Keeping OpenCode blocked is supported. A generic
   shared-login acknowledgment cannot authorize its database/startup effects.
4. **Create files only** prepares private state, then opens the existing selection
   review. If that second review is cancelled, **Continue prepared-file review…**
   resumes it with a new validation/TTL in this Desktop lifetime. It neither rewrites
   files nor retries partial provisioning. No manual manifest lookup is required.
5. Choose **Open reviewed terminals**. A/B documents appear in the same window.
   Each panel separately requires **Start CLI → Connect output → Enable keyboard
   input**. Opening is not starting, authenticating or authorizing a task. The
   native permission chain, focus checks, signed grants and input revocation remain
   unchanged. Shared capacity or missing OpenCode consent may keep both panels blocked.

The new preset creates A=Codex and B=OpenCode, with separate hashes, UUIDs, native
identity selectors and state directories. Only this two-provider exception is
supported; configured 1–8-member same-provider selections remain unchanged. This
does not prove model availability, login, inference or cross-provider delegation.
OpenCode retirement remains blocked where descendant ownership is unvalidated.

## Visual scope

The Studio is a navigation/preparation page rather than a simulated terminal.
Its selected-state badge comes from a bounded Desktop snapshot. The A/B card is
explicitly a suggested new preset, not a claim about the current selection.
Unknown, unavailable, prepared-but-unreviewed and opened states have separate copy.
Opening or returning uses the existing native documents; it does not reload the
observer or discard its loaded state. Dashboard route changes retain the existing
draft-discard guard.

Native terminal chrome now shares the dashboard's approved dark design tokens.
It shows a short slot/provider heading, owned-process state, scrollable member
navigation, visible horizontal/vertical split actions and collapsed advanced layout
and permission details. The currently applicable Start/Connect/Input action is
highlighted. Stop stays visible. No model, token, task or readiness value is invented.
The underlying terminal output remains inert original provider text.

## Desktop compatibility and delivery

A loaded Desktop main/preload does not change when assets are rebuilt. The Studio
shows an explicit older-Desktop notice with disabled preparation controls when its
versioned facade is absent. A normal browser similarly explains Desktop-only
preparation. No automatic reload, restart, second-instance import or draft replacement
is performed. A later owner-controlled Desktop relaunch is required for the new
native flow. A new `/studio` direct URL also requires a Bridge build containing the
route allowlist; rebuilding static assets alone does not replace a running Bridge.
The existing root URL and client-side sidebar navigation remain the entry for a
static-only update. Preserve old assets while any loaded page may still need them.

## Security review

`orqst:studio` is a closed Desktop IPC channel: `snapshot`, `createMixed`, `create`,
`select`, `resumeReview`, `open`. Renderer input cannot carry paths, manifest content,
provider prompts, process operations, consent or grants. Snapshot is read-only;
actions require transient preload activation and the exact authorized observer
sender/session/frame, native focus and shared busy gates. All preparation uses the
existing parented dialogs, expiry, blur/navigation invalidation, revalidation and
atomic publication. Selecting/opening still passes normal Core/admission inspection.

No HTTP execution endpoint, WebSocket operation, cookie or credential access was
added. `/studio` only extends the existing static dashboard route allowlist; existing
loopback/Host/Origin/CSP rules remain intact. The new facade is removed at shutdown.

## Validation limits

Automated checks use disposable synthetic profiles, executable pins and intercepted
native focus/dialogs. They are not acceptance of human macOS dialogs or real providers.
No actual OpenCode consent, native database access/migration, CLI start, login or
inference is performed by this change's acceptance. The installed Desktop and its
loaded work remain untouched. See the final change report for commands and outcomes.

The change passed lint, typecheck and full build; the full Node run passed 568
cases, followed by 45 focused cases after the review-resume adjustment. Chromium
covered Studio EN/PT, routes, draft guards, themes and responsive layouts. The explicit
`accept:terminal-creation --authorize-synthetic-creation` passed homogeneous and
mixed creation, refusal/checkbox/focus/navigation cases, review resumption and retained
unknown reservations with one Electron window. `accept-terminal-ui.ts
--authorize-synthetic-ui` passed EN/PT renderer guidance, keyboard, split/input
revocation and responsive screenshots. Screenshot review covered Studio at
1440/1024/390px and terminal documents at 1440/640/390px. A hidden native child-page
screenshot attempt stalled and was stopped in its disposable test process; visual
acceptance uses the existing renderer-only harness, not a claimed native screenshot.
No ingestion changed; real-source `validate:local` and full Chromium were not run.
