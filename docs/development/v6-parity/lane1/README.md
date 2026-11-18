# V6 parity evidence for the dashboard shell

The before images are on `origin/docs/v6-parity-audit` at
`9c4719b96d71a5469c910c140f47e8fd8c4f40c2`. Their paths are
`docs/development/v6-parity/<size>/tauri-studio/20–22` and
`docs/development/v6-parity/<size>/observer/01–06`. The approved Studio
reference is `docs/development/v6-parity/<size>/approved/01-auth-grid.png`,
from the [owner-approved HTML](../../../design/v6/source/ORQST_workspace_v6_features.html).

| Surface                                        | 1440 × 900 after                                                                                                                                                                                                          | 1280 × 800 after                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard Studio route cycle                   | [Overview](1440x900/tauri-studio/20-overview-return.png), [Workspaces](1440x900/tauri-studio/20a-workspaces.png), [Settings](1440x900/tauri-studio/21-settings.png), [Studio](1440x900/tauri-studio/22-studio-return.png) | [Overview](1280x800/tauri-studio/20-overview-return.png), [Workspaces](1280x800/tauri-studio/20a-workspaces.png), [Settings](1280x800/tauri-studio/21-settings.png), [Studio](1280x800/tauri-studio/22-studio-return.png) |
| Observer shell, notification drawer and search | [Observer comparisons](1440x900/observer/)                                                                                                                                                                                | [Observer comparisons](1280x800/observer/)                                                                                                                                                                                |

The dashboard's managed Studio, Overview, Workspaces and Settings share visible
route links, search, notification bell and language selection. The managed
route header is 45 px at both sizes. The embedded Studio rail is visible at
155 px and its hamburger is gone. The approved HTML combines the breadcrumb
and terminal actions in one row above the stage. The embedded workspace still
has its Feature management row and terminal toolbar. The tree and pane lanes
own the remaining geometry and the standalone Feature document. The approved
HTML has no Overview, Settings, alert drawer or search screen. Those comparisons
use the audit's dashboard and observer screenshots.

The captures use the built renderer in headless Chromium in dark mode and PT-BR
with reduced motion. Managed IDs and observed session data come from disposable
Playwright fixtures. There is no native terminal execution or owner confirmation
in this evidence. Reproduce with the isolated browser server after building the
dashboard and with `ORQST_LANE1_CAPTURES=1 pnpm exec playwright test
tests/browser/shell-navigation.spec.ts --workers=1`.

## Integration contract

- `StudioShellContext` in `navigation.ts` supplies `tree` (`StudioTreeProps`),
  `navigate(view, focusContent?)`, `openNotifications()` and `openSearch()`
  inside the dashboard's embedded Studio. Use the dashboard callbacks for
  global navigation and overlays. Its navigation uses the existing indexed
  History API and unsaved-artifact guard.
- `tree.scope` is available when the native Feature snapshot is available. It
  carries the stable managed Workspace ID/name, active Feature ID or null, and
  display name. `observedWorkspaces`, `observedWorkspaceId` and
  `onObservedWorkspaceChange` describe the observer filter. The managed tree
  still selects Features through its native revision-checked request and
  renders accepted snapshots. A route change carries no Feature mutation.
- The existing `StudioWorkspace` preparation request and its handling callback
  continue to own the dashboard's preparation entry. The topbar supplies the
  Overview link. Remove its duplicate compatibility button when updating
  `StudioWorkspace`.
- Standalone Feature chrome receives a null context and uses its host
  presentation. Native routing needs a host-authorized handoff to the retained
  dashboard, where navigation uses the existing draft guard. CSS for the embedded compatibility
  rail is scoped to `.studio-workspace`; lane 2 can remove the rules that
  target `.studio-immersive` and the old toolbar toggle when its tree lands.
  Lane 3 owns the native placement protocol and corresponding chrome insets.

## Reference decisions

- Anywh's [notification hook](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/hooks/platform/useNotificationClick.ts)
  routes session/profile IDs from Tauri events and plugin callbacks. Retained
  ORQST's source-validated dashboard navigation and indexed browser history.
  Anywh's [Agent Host](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/agentHost.ts)
  manages runtime lifecycle and has no role in this renderer change.
  The pinned tree has no root `NOTICE`.
  [Apache-2.0 license](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE).
- Tucano's [Electron main process](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/main/index.ts)
  routes notifications through Electron conversation state. Retained ORQST's
  authenticated observer snapshot and exact session link. The pinned tree has
  no root `NOTICE`.
  [Apache-2.0 license](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE).
- The [public Overclock Panes page](https://overclock.sh/features/panes) describes
  its pane UX. The approved ORQST HTML governs this shell. No upstream code,
  dependencies or visual assets enter the change.

## Verification

- Frozen install used Node 24.22.2 and pnpm 10.34.9. Lint and typecheck passed.
  The dashboard Vite build completed with the existing chunk-size advisory.
- Chromium passed all 13 shell navigation tests with one worker. Reviewed and
  verified dimensions for all 20 captures at the two requested sizes.
- The additional Chromium run passed 23 tests and failed four. Two
  `studio-workspace` assertions expect a hidden topbar and an Overview button.
  The browser and older Desktop test in `studio.spec.ts` still expects retired
  preparation copy. The Settings contrast-color assertion also failed on an
  isolated rerun.
- The repository-wide Node run reported 1,327 passed, 12 failed and 3 cancelled.
  It recorded integration timeouts, and its offline recovery test process was
  stopped after more than 21 minutes with filesystem synchronization observed.
