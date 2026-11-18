# ORQST V6 integration evidence

The managed Studio uses the approved 155 px Workspace/Feature tree and one
45 px breadcrumb/action row. The tree footer carries Overview, Workspaces,
Settings, search and notifications above the Core status. The dashboard Studio
puts language selection in the same action row. Outside Studio, the dashboard
keeps its route links and guarded return to the selected Feature.
Grade keeps the HTML's grid/columns toggle, and Restore resets the layout.
The pane menu contains the individual layout choices.

| Surface                          | 1440 × 900                                                                         | 1280 × 800                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Approved Studio                  | [Reference](1440x900/approved/01-auth-grid.png)                                    | [Reference](1280x800/approved/01-auth-grid.png)                                    |
| Standalone Feature chrome        | [Studio](1440x900/01-studio.png)                                                   | [Studio](1280x800/01-studio.png)                                                   |
| Dashboard Studio after returning | [Studio](1440x900/01a-studio-dashboard.png)                                        | [Studio](1280x800/01a-studio-dashboard.png)                                        |
| Pane menu and Layouts            | [Menu](1440x900/panes/06-pane-menu.png), [Layouts](1440x900/panes/06a-layouts.png) | [Menu](1280x800/panes/06-pane-menu.png), [Layouts](1280x800/panes/06a-layouts.png) |
| Minimized dock                   | [Dock](1440x900/panes/12-minimized.png)                                            | [Dock](1280x800/panes/12-minimized.png)                                            |
| Floating pane                    | [Floating](1440x900/panes/08-floating.png)                                         | [Floating](1280x800/panes/08-floating.png)                                         |
| Maximized pane                   | [Maximized](1440x900/panes/11-maximized.png)                                       | [Maximized](1280x800/panes/11-maximized.png)                                       |
| New terminal                     | [Dialog](1440x900/creation-open.png)                                               | [Dialog](1280x800/creation-open.png)                                               |
| Delegate                         | [Dialog](1440x900/delegate-open.png)                                               | [Dialog](1280x800/delegate-open.png)                                               |
| Overview                         | [Overview](1440x900/02-overview.png)                                               | [Overview](1280x800/02-overview.png)                                               |
| Settings                         | [Settings](1440x900/03-settings.png)                                               | [Settings](1280x800/03-settings.png)                                               |
| Notifications from Studio        | [Notifications](1440x900/04-notifications.png)                                     | [Notifications](1280x800/04-notifications.png)                                     |

The approved captures are byte-for-byte copies from the
[parity audit at `9c4719b`](https://github.com/walissonhms/orqst/tree/9c4719b/docs/development/v6-parity).
The written UI/UX specification covers Overview, Settings and notifications.
The integrated PNGs use the lane Chromium facades, reduced motion and PT-BR.
Fixtures supply stable synthetic source IDs and snapshots.
The [parity audit](https://github.com/walissonhms/orqst/blob/9c4719b96d71a5469c910c140f47e8fd8c4f40c2/docs/development/v6-parity-audit.md)
links each reference state to the original baseline.

## Pane and dialog captures

- [1440 × 900 panes](1440x900/panes/) and [1280 × 800 panes](1280x800/panes/).
  Compare with [1440 × 900 approved](1440x900/approved/) and
  [1280 × 800 approved](1280x800/approved/).
- Creation and delegation appear alongside the Studio in each viewport directory.
  The creation facade covers the reviewed catalog generation, cancel and refusal,
  first pane, existing pane retention, batch and advanced review.
- Delegation captures the target picker, draft and queued inbox receipt. The
  integrated test also supplies a receipt for another terminal and checks that
  the interface reports the delivery as unknown.

## Remaining differences

- The reference shows sample terminal output. The Chromium Feature chrome
  keeps its PTY holes empty. The dashboard Studio offers the native Open
  action on retained terminals.
- The shell retains the product logo, global navigation, Core state and
  authorized Feature controls. The standalone row exposes account limits and
  the dashboard row exposes language selection.
- Managed Workspace creation and switching require an authoritative catalog
  and an approved scope contract. Observer Workspace names remain visible.
- Mention handles use the actual Feature-local terminal labels. The alias field
  shows how the host assigns the handle. Alias editing and configuration
  duplication in the standalone Feature menu require host callbacks.
- The current account panel exposes only provider-evidenced limits. Missing
  quota and renewal stay unavailable.
- Notifications link to observed sessions. Per-Workspace rules, quiet hours,
  dismissal of individual entries and links to pane or task receipts require
  additional contracts.
- Native WebKit, live PTY input, provider acceptance and owner review remain
  pending.

## Reference decisions

The shell composes the existing indexed dashboard history and the native
Feature presentation. Anywh's `useNotificationClick` depends on its Tauri
event/plugin and profile-session IDs. Tucano's `handleCore` uses Electron
conversation notification routing. Their Apache-2.0 pins and NOTICE review
are recorded in the [reuse audit](../../../research/reuse-first-audit.md).
ORQST keeps its own dashboard source validation and local scope. The approved
HTML governs geometry. [Anywh source](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/hooks/platform/useNotificationClick.ts) ·
[Tucano source](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/main/index.ts) ·
[Overclock's public pane reference](https://overclock.sh/features/panes).
