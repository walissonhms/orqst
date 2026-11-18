# Studio alerts for specification §8.3 and §8.4

The lane starts from `origin/feat/frontend-768` at `8ad1124`. The existing
`FeatureWorkspace` mounts the sidebar bell and the header chip while L1 is
integrated. It uses L2's existing arrangement machinery through one view-only
focus control. The observer's history and preferences remain available through
its existing dashboard UI. The Studio drawer links back to that history. The
retained native Studio also links to Settings.

## Integration contract

- Mount `LimitsChip` from `AccountLimits.tsx` with the validated provider accounts
  and existing account preferences. The chip shows the highest unexpired
  reported usage for each displayed provider. A missing reading displays `—`.
  An explicit zero displays a localized “Unused”. The popover shows the reported
  account label or a localized account number and uses the latest provider
  timestamp for the report age. A tooltip explains missing readings. The
  default Codex account can reread locally observed evidence. Account selection
  and cap editing are absent from the production popover because this branch has
  no Metrics and Limits settings page.
- Mount `NotificationsDrawer` with `useStudioNotifications().items` and
  `.unreadCount`, plus its mark-read and clear actions. The history keeps the
  most recent 200 entries. Read and clear persist for that Studio renderer
  origin, with a rolling ledger of the 1,000 most recent alert IDs for replay
  protection after clearing history.
  The observer's SQLite rows refer to observer session IDs and use their
  existing history and read endpoint. Managed terminal UUIDs use the Studio
  store because those UUIDs do not identify observer sessions.
- The shell implements `focusTerminal(featureId, terminalId): Promise<boolean>`.
  Both IDs are Core identifiers, and the fallback accepts `null` for the
  unassigned scope. Refresh the authenticated catalog, confirm the terminal
  belongs to the requested scope, select that Feature, recheck membership,
  and invoke the existing pane focus command. `StudioLayoutControls.focusTerminal`
  reveals and focuses the existing card. Closed slots, reassigned IDs and
  archived Features cannot match a stale address. Focus grants no permission
  to send input or restart a terminal.
- `confirmedResults` uses the signed pair broker's accepted `submit_result`
  projection. A CLI turn completing does not qualify as task completion.
  `communicationNotification` accepts a fresh, validated `CommunicationAudit`
  transition from L4's live source and returns an entry for `add`. It maps
  explicit delivery failure, recipient termination and task states. Replay,
  refusal, unknown delivery and pane state alone do not qualify. The existing
  Feature projection on this base contains signed pair delegations/results
  only. The L4 producer join for delivery failure and recipient termination is
  pending, as is full quota presentation on L5's Metrics route. The N-terminal
  hub's existing metadata reports “result” without its outcome. It needs
  explicit completion/failed evidence before it can drive those alerts.
- Owned failure and waiting entries come from the existing turn monitor and
  preferences in the private native pipe. The macOS host attempts a banner
  only if the main window reports that it is unfocused. It uses the existing
  one-shot native ID route, rechecks the current host on click and asks the
  existing Core handler to open the owning Feature by UUID. The matching
  active Studio card takes focus once the current snapshot and dock agree.
  Banner content contains fixed translated categories and no task payload.
- A limit entry requires two reports for the same account and unexpired renewal
  window, with a fresh increase through a configured threshold. Initial,
  repeated, expired and unavailable readings stay silent. It is account-scoped
  and shows the provider without inventing a Feature or terminal address. UI
  alerts consume semantic evidence, including explicit quota fields when those
  fields accompany a token record. Token values never trigger alerts.

## Reference decisions under AGENTS.md §13

- **Keep ORQST's existing native callback.** Anywh's `useNotificationClick`
  joins Tauri event/plugin listeners and remote iOS push through React and
  routes `profileId` / `sessionId` from payload extras. Its native sender uses
  an older notification plugin and a Windows toast path. ORQST's installed
  plugin returns the OS tap ID on macOS, letting the native process retain a
  private one-use UUID mapping.
  [Anywh click hook](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/hooks/platform/useNotificationClick.ts),
  [Anywh native sender](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/notifications.rs).
- **Keep ORQST's focus gate and identity checks.** Tucano's Electron `handleCore`
  creates a `Notification` from Core text and suppresses it when the _same
  conversation_ is visible and the window is focused. Its click handler calls
  `showWindow(conversationId)` and the preload forwards the `navigate` event
  over Electron IPC. ORQST suppresses banners whenever its main window is
  focused and routes via a private ID, stable terminal UUID and current
  Feature membership. Tucano's `route` and `parseRoute` select model-driven
  channel responders and supply no notification identity or delivery evidence.
  [Tucano main](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/main/index.ts#L182-L189),
  [Tucano preload](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/preload/index.ts#L13-L18),
  [Tucano channel router](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts).
- Both complete pinned trees expose root Apache-2.0 license files with
  SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` and
  no tracked NOTICE/COPYING. No upstream code, assets or dependencies were
  incorporated.
  [Anywh license](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE),
  [Tucano license](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE).

## Visual evidence

The production React dashboard renders each state with a synthetic native
bridge in Chromium. The approved HTML is captured at each matching size. The
HTML predates the limits chip and drawer, so it provides the shell geometry
reference for these additions. Neither fixture uses a real CLI account or
injects events into a running application.

| Viewport   | Approved HTML                      | Dashboard                                                                                                                                                                                                                            |
| ---------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1440 × 900 | [V6](1440x900/00-v6-reference.png) | [Unavailable](1440x900/01-limits-unavailable.png) · [Reported](1440x900/02-limits-reported.png) · [Popover](1440x900/03-limits-popover.png) · [Unread](1440x900/04-notifications.png) · [Empty](1440x900/05-notifications-empty.png) |
| 1280 × 800 | [V6](1280x800/00-v6-reference.png) | [Unavailable](1280x800/01-limits-unavailable.png) · [Reported](1280x800/02-limits-reported.png) · [Popover](1280x800/03-limits-popover.png) · [Unread](1280x800/04-notifications.png) · [Empty](1280x800/05-notifications-empty.png) |

Use `ORQST_CAPTURE_SPEC_L6=1 pnpm exec playwright test tests/browser/studio-alerts.spec.ts --workers=1`
after building the dashboard package. For native acceptance, verify a real CLI
attention/failure transition with the app foregrounded and unfocused on a
macOS Preview with notifications enabled. Tap the delivered banner and check
the saved terminal UUID, Feature and keyboard focus. The browser fixture and
Rust unit tests cover the renderer and native gates independently; OS delivery,
permissions, native app focus and a real tap require the integrated Preview.

## Follow-up verification

The follow-up passed lint, typecheck, 22 focused Node tests, seven focused
Chromium tests, and the targeted Rust account-limits validator test. The
dashboard build and isolated Tauri resource staging passed. The capture run
regenerated both sets of five dashboard images and reproduced both V6
references. Account labels in these captures are synthetic fixture values.
