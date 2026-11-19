# diag28 renderer fixes

Base commit `d3d3ef1`. The images use the production dashboard build and a disposable
Playwright native facade. Its Feature, terminals, messages and alerts are synthetic.
The browser shows the renderer's PTY holes. The close test checks that the renderer
continues submitting a visible PTY rectangle while the confirmation is open.
The packaged Preview, the owner's live PTY and the macOS accessibility tree require
separate acceptance.

| State                                                                             | 1440 × 900                                                                                                   | 1280 × 800                                                                                                   |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Studio, live Feature count, honest status dot, dock warning and sidebar seam      | [Dashboard](1440x900/studio.png)                                                                             | [Dashboard](1280x800/studio.png)                                                                             |
| Stable display ID on Overview                                                     | [Dashboard](1440x900/overview.png)                                                                           | [Dashboard](1280x800/overview.png)                                                                           |
| Stable display ID on Communication                                                | [Dashboard](1440x900/communication.png)                                                                      | [Dashboard](1280x800/communication.png)                                                                      |
| Stable display ID on Metrics                                                      | [Dashboard](1440x900/metrics.png)                                                                            | [Dashboard](1280x800/metrics.png)                                                                            |
| Notifications and palette                                                         | [Notifications](1440x900/notifications.png), [Palette](1440x900/palette.png)                                 | [Notifications](1280x800/notifications.png), [Palette](1280x800/palette.png)                                 |
| Next default name during startup and after the Core reports the new terminal live | [Starting](1440x900/second-codex.png), [Live](1440x900/unique-live-codex.png)                                | [Starting](1280x800/second-codex.png), [Live](1280x800/unique-live-codex.png)                                |
| Close confirmation                                                                | [Dashboard](1440x900/close.png)                                                                              | [Dashboard](1280x800/close.png)                                                                              |
| Ended disclosure and New Terminal dialog                                          | [Ended](1440x900/ended.png), [New Terminal](1440x900/new-terminal.png)                                       | [Ended](1280x800/ended.png), [New Terminal](1280x800/new-terminal.png)                                       |
| Pane menu with available commands                                                 | [Dashboard](1440x900/pane-menu.png)                                                                          | [Dashboard](1280x800/pane-menu.png)                                                                          |
| Owner-approved V6 HTML                                                            | [Studio](1440x900/v6-studio.png), [Menu](1440x900/v6-menu.png), [New Terminal](1440x900/v6-new-terminal.png) | [Studio](1280x800/v6-studio.png), [Menu](1280x800/v6-menu.png), [New Terminal](1280x800/v6-new-terminal.png) |

The managed Codex facade reports its live process and first PTY frame. Prompt and
turn readiness remain unknown, so the tooltip reads **Sem sinal**. A close
confirmation reserves space above the stage while the PTY retains a visible
rectangle. The existing native termination request still verifies authority.
Duplicate and Restart appear when the renderer host supplies callbacks. The Grade
disclosure keeps layout choices available and the pane menu follows §4.3.

ORQST's existing signed arrange transport, UUID membership and Core message
projection supply the required contracts. Anywh's `TerminalPanel` delegates
`handleCloseTerminal` to its Relay tab/session flow and renders its own xterm
view. Tucano's `route` chooses speakers through its Engine. Keep ORQST's
implementation. Both pinned upstream trees have an Apache-2.0 LICENSE and no
tracked NOTICE. The reference decisions and Overclock's V6 visual scope are
recorded in the repository research. [Anywh TerminalPanel](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/client/src/components/terminal/TerminalPanel.tsx),
[Tucano router](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts),
[reference review](../../research/v6-terminal-chrome.md),
[approved HTML](../../design/v6/source/ORQST_workspace_v6_features.html).

To regenerate the captures from the repository root:

```sh
pnpm --filter @orqst/dashboard build
ORQST_DIAG28_UI_CAPTURES=docs/development/diag28-ui pnpm test:browser --workers=1 --grep diag28
```

With the same synthetic submit fixture, a single sample took **15.4 ms** on the
base and **13.7 ms** in the full branch run. The focused branch rerun took **15.0 ms**.
These samples measure the first rendered starting card. Native launch and first
PTY frame timings require a packaged Preview.

## Validation

- Dashboard build, repository lint, strict TypeScript, 25 focused Node tests and
  12 focused browser regression tests passed.
- The full Chromium run with one worker reported 209 passed, 20 failed and 3
  skipped across 232 tests. Six creation tests passed with the updated dialog
  locators and Core fixtures. The reading preference failure passed twice on an
  isolated rerun.
- The remaining 13 failures also failed on `d3d3ef1`. They cover observer onboarding,
  comfortable appearance, the shared shell and adapter inventory, alert focus,
  and legacy Studio geometry, restoration and breadcrumb delegation.
