# ORQST V6 integration evidence

The managed Studio uses the approved 155 px Workspace/Feature tree and one
45 px breadcrumb/action row. The tree footer carries Overview, Workspaces,
Settings, search and notifications above the Core status. The dashboard Studio
puts language selection in the same action row. Outside Studio, the dashboard
keeps its route links and guarded return to the selected Feature.

| Surface                          | 1440 × 900                                      | 1280 × 800                                      |
| -------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| Approved Studio                  | [Reference](1440x900/approved/01-auth-grid.png) | [Reference](1280x800/approved/01-auth-grid.png) |
| Standalone Feature chrome        | [Studio](1440x900/01-studio.png)                | [Studio](1280x800/01-studio.png)                |
| Dashboard Studio after returning | [Studio](1440x900/01a-studio-dashboard.png)     | [Studio](1280x800/01a-studio-dashboard.png)     |
| Overview                         | [Overview](1440x900/02-overview.png)            | [Overview](1280x800/02-overview.png)            |
| Settings                         | [Settings](1440x900/03-settings.png)            | [Settings](1280x800/03-settings.png)            |
| Notifications from Studio        | [Notifications](1440x900/04-notifications.png)  | [Notifications](1280x800/04-notifications.png)  |

The approved captures are byte-for-byte copies from the
[parity audit at `9c4719b`](https://github.com/walissonhms/orqst/tree/9c4719b/docs/development/v6-parity).
The written UI/UX specification covers Overview, Settings and notifications.
The integrated PNGs use the lane Chromium facades, reduced motion and PT-BR.
Fixtures supply stable synthetic source IDs and snapshots.

## Remaining differences

- Lane 3 owns the pane/dock layout and the final native placement insets.
  The current renderer uses a 45 px header and reports rectangles through the
  existing 47 px native top inset and 38 px bottom inset.
- The reference shows sample terminal output. The Chromium Feature chrome
  keeps its PTY holes empty. The dashboard Studio offers the native Open
  action on retained terminals.
- Managed Workspace creation and switching require an authoritative catalog
  and an approved scope contract. Observer Workspace names remain visible.
- Native WebKit, PTY input and owner acceptance remain pending.

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
