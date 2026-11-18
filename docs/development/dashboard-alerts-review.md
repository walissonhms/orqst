# V6 dashboard and alert review — 2026-11-17

Base `48290878939bf43f768dc0c73da9a650716e0b0e` on `feat/frontend-768`.
The isolated slice uses Node 24.22.2, pnpm 10.34.9, React 19.3.1, Vite 8.3.5,
i18next 26.7.1, Playwright 1.64.1 and the repository's Node test runner. The desktop
is Tauri 2, with `tauri-plugin-notification` 2.8.0 in Cargo.lock.

## V6 comparison

The [approved six-file package](../design/v6/README.md) is the product reference.
The Studio shell keeps the compact Workspace/Feature sidebar, breadcrumb, dense
dockable terminal area and minimized terminal dock. The hierarchy remains
Workspace → Feature → TerminalPane → AgentSession. The approved HTML illustrates
four occupied panes and fabricated activity. Actual panes, limits, messages and
statuses need accepted runtime evidence. The browser observer shows an explicit
Desktop requirement. The development terminal preview is excluded from the
production Vite entry.

| Surface                 | Verified scope and remaining V6 work                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview and shell      | Existing collapsible navigation, summary, search, filters and session inspector. The first history load previously showed zero counts and a quiet Attention panel. Counts now show unavailable until a snapshot and its first scan are ready. Attention summarizes last observed session state, which can include retained observations.                                                        |
| Studio                  | Viewport fill and a compact narrow sidebar have renderer coverage. The delegated action in `FeatureWorkspace.tsx` is disabled with an unavailable reason. The native Studio presents a separate chrome document, which has no notification drawer or persistent unread bell. Actual slot placement, retained PTYs, independent Workspace switching, and native focus are owner acceptance work. |
| Related dashboard views | Workspaces, Agents, Models, Artifacts and Settings are reachable from the shell. Provider, budget, orchestration and task views depend on their respective worker contracts. Adapter cards show capability descriptors; a configured adapter does not establish provider readiness.                                                                                                             |
| Notification center     | Category and unread filters, bulk mark-read, fixed identity navigation and shared sound/category preferences are implemented. Per-item dismissal, per-Workspace rules, quiet hours, and pane/task/message links for structured delivery remain pending.                                                                                                                                         |

## Findings and fixes

- The Tauri UA starts with `ORQSTTauri/0.1` in
  [main.rs](../../apps/tauri/src-tauri/src/main.rs#L148). The previous dashboard
  listener required a leading space. [App.tsx](../../apps/dashboard/src/App.tsx#L701)
  now matches the complete token in any position. The existing
  [navigation guard](../../apps/dashboard/src/native-session-navigation.ts)
  refreshes membership, rejects ambiguous or stale results, and goes through
  the same draft review before opening an observed Codex session.
- The WebSocket's `live` bit reflects ingest timing. A renderer-local preference
  could diverge from the shared SQLite setting when a write failed or a second
  client changed it. The [Bridge](../../apps/bridge/src/server.ts#L383) emits an
  optional delivery marker only when a live category event has an actual unread
  record at dispatch. Its sound flag comes from shared preferences. The
  [dashboard stream consumer](../../apps/dashboard/src/use-observatory.ts#L59)
  requires that marker for browser delivery. Replay retains `live: false`.
- The [drawer](../../apps/dashboard/src/App.tsx#L1832) could imply an empty
  history or zero unread before the Bridge loaded. It also allowed ineffective mark-read requests offline and during
  pending writes. The drawer now reports loading, unavailable and stale states,
  qualifies cached unread counts, disables unavailable bulk actions, and
  reports failed confirmation. The bell exposes the unread count to assistive
  technology, and each row exposes its read state. Added copy is present in
  both dashboard locales.
- Expanded Studio rendered the same Overview action in the
  [Feature header and the terminal toolbar](../../apps/dashboard/src/FeatureWorkspace.tsx#L991).
  It now renders one accessible action in either panel mode. At 390 px the
  [standalone shell override](../../apps/dashboard/src/shell.css#L1147) lost
  the cascade to the legacy embedded workspace, keeping a 155 px sidebar and
  clipping the terminal toolbar. The shell now uses the 46 px compact sidebar.

## Event and delivery evidence

| Channel                     | Eligible evidence                                                                                                                                                                                                                                                                                  | Delivery and deduplication                                                                                                                                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Observer SQLite / dashboard | Live Codex `event_msg:task_complete`, `event_msg:error` / `event_msg:task_failed`, or a named `request_user_input` tool call. The adapter maps these to completion, failure and `waiting_for_user`.                                                                                                | SQLite keys notifications by the stable event ID. Initial scan, imported history, token updates and interruption events do not create a notice. The drawer shows up to 200 records ordered by source timestamp.                                                                             |
| Browser                     | A new WebSocket sequence with the Bridge marker and granted browser permission.                                                                                                                                                                                                                    | The cursor suppresses replay and the browser receives the event ID as its tag. Sound uses the same marker's policy and still needs activation. Independent browser tabs have independent audio contexts.                                                                                    |
| Native observer             | A persisted unread Codex notice joined to exact event/session/type/time and supported record/status evidence in [DesktopMonitor](../../packages/core/src/desktop-monitor.ts).                                                                                                                      | An attach/reconnect establishes a silent baseline. Later sequences share the native run cap and per-poll burst cap. The tray counts the latest persisted unread rows. Taps have a bounded, once-only native route and a fresh authenticated dashboard membership check.                     |
| Native owned terminal       | The [owned monitor](../../packages/core/src/terminal/owned-turn-monitor.ts) requires a sampled running state and a matching turn identity before a supported completion, failure or waiting transition. Provider-specific binding and explicit Claude hooks supply only their documented evidence. | The Node and native guards consume each terminal/turn/category once. Native routing checks the current retained terminal, Feature and presentation. The fixed OS copy carries no transcript or agent-generated fields. Owned banners have no separate unread history in the observer store. |

The observed completion category means a provider turn completed. An owned
response-completed alert establishes a provider response boundary. A successful
notification preparation and a verified task result require different evidence.
No interruption, quota, budget, or structured delivery alert is fabricated for
unavailable sources. The [native contract](tauri-notification-route.md) documents
freshness, the shared 20-attempt cap, and host/plugin delivery limitations.

## Reuse review

- **Anywh** at `546f189c04415c3c5af5f40e3931a0a90b9aba31` has the
  [Apache-2.0 license](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
  and [useNotificationClick](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/hooks/platform/useNotificationClick.ts).
  Its platform-specific callbacks depend on Tauri events, plugin extras and
  profile IDs. ORQST already has a native source-validated, once-only ID mapping
  and an authenticated selection contract.
- **Tucano** at `0501956d127699300209902e889f3e69a0948766` has the
  [Apache-2.0 license](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE).
  Its [Electron main process](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/main/index.ts)
  presents approval, question and completion notifications linked to a conversation.
  Its [runs service](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/runs.ts)
  owns the named run statuses. The ORQST observed-session evidence and Tauri callback
  have different ownership boundaries.
- **Overclock** provides a [public pane UX reference](https://overclock.sh/features/panes).
  An exact public application SHA and a source reuse license were not verified.
  The approved ORQST HTML governs the layout. No upstream source, assets or dependencies
  were incorporated.

## Verification and existing gaps

The reference and production-entry renderer were captured with Chromium and
reduced motion using four explicitly synthetic facade slot identities. The
1440×900 comparison shows matching 155 px sidebar width, a 45 px Feature header
and a four-pane mosaic. The current renderer adds its existing arrangement
toolbar and uses a 38 px dock. The fixture has no attached PTYs, so its pane bodies
offer the actual open action and show unavailable activity. Both locales had zero
page or console errors during this capture. The build contained a single
production HTML entry.

The first root `pnpm test` exited 1 with 1,288 passed, six failed and one
cancelled. Its WebSocket assertion compared pre-serialization properties that
JSON drops. The assertion was corrected and the focused Node run passed 30/30,
including Bridge delivery, replay, locale parity, desktop monitor and owned
turn evidence. The other failures covered analytics, PTY, MCP or native recovery,
including stalled workers. An extra concurrency-2 full-suite attempt was stopped
after repeated timeouts and fixture failures.

The first 26-test Chromium pass returned 18 passed and eight failed. All three
new notification tests passed in that pass, as did live source ingestion,
category filtering and the draft guard on notification links. Some older tests
still assert removed Overview headings, old adapter availability copy or a
toolbar button hidden by the current full-window Studio default. Additional
failures concern the narrow topbar language control and the sticky token
popover. The language setting remains reachable through Settings. The token
popover overlap and wider fixture maintenance remain outside this slice.

## Owner macOS acceptance

Use an isolated matching package and disposable test Workspace.

1. With native alerts off, trigger observed Codex completion, failure, and an
   explicit input request. Check the corresponding drawer rows, labels and tray
   count. Import retained history and reconnect to check that neither replays OS
   alerts. Mark all read and check the tray catches up.
2. Enable native alerts in the ORQST menu. Test granted and denied notification
   permission, Focus, sound on/off, foreground, unfocused and minimized windows.
   Record actual banners and sound with the active package identity.
3. Tap a fresh observed alert and verify workspace/session selection. Repeat
   with a dirty artifact draft and cancel, then explicitly discard on a fresh
   alert. Check expired/revoked alerts cannot navigate to a stale session.
4. Exercise a bound owned Claude turn with explicit prompt, failed response and
   successful response evidence. Check one alert per category, valid focus on tap,
   and refusal after changing Feature or closing the target. Confirm focus does
   not grant terminal input.
5. Compare the signed app at 1440×900 and a narrow window in English and
   Portuguese. Check VoiceOver/keyboard focus, drawer Escape, reduced motion and
   real pane layout. Keep provider and OS acceptance separate from Chromium fixtures.
