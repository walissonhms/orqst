# Feature Studio specification, lane L2

The dashboard and the retained Tauri Studio document mount the same `FeatureStudio`. The stage renders the React pane header, menu, layout controls and minimized dock. Existing trusted terminal documents retain xterm, FitAddon, resize and native input revocation. The standalone legacy Electron document retains its own controls.

## Visual comparison

These Chromium captures use the production dashboard Studio components with disposable synthetic native responses. `dashboard/` shows the React stage, including the PTY bounds reserved for native WebViews. Capturing PTY output itself requires the signed desktop host. `v6/` comes from the unmodified approved HTML. Its fake prompt and sample output belong to the reference.

| State          | 1440 × 900 dashboard                              | 1440 × 900 V6                       | 1280 × 800 dashboard                              | 1280 × 800 V6                       |
| -------------- | ------------------------------------------------- | ----------------------------------- | ------------------------------------------------- | ----------------------------------- |
| Grid           | [Dashboard](1440x900/dashboard/grid.png)          | [V6](1440x900/v6/grid.png)          | [Dashboard](1280x800/dashboard/grid.png)          | [V6](1280x800/v6/grid.png)          |
| Menu           | [Dashboard](1440x900/dashboard/menu.png)          | [V6](1440x900/v6/menu.png)          | [Dashboard](1280x800/dashboard/menu.png)          | [V6](1280x800/v6/menu.png)          |
| Minimized dock | [Dashboard](1440x900/dashboard/minimized.png)     | [V6](1440x900/v6/minimized.png)     | [Dashboard](1280x800/dashboard/minimized.png)     | [V6](1280x800/v6/minimized.png)     |
| Floating       | [Dashboard](1440x900/dashboard/floating.png)      | [V6](1440x900/v6/floating.png)      | [Dashboard](1280x800/dashboard/floating.png)      | [V6](1280x800/v6/floating.png)      |
| Maximized      | [Dashboard](1440x900/dashboard/maximized.png)     | [V6](1440x900/v6/maximized.png)     | [Dashboard](1280x800/dashboard/maximized.png)     | [V6](1280x800/v6/maximized.png)     |
| Empty Feature  | [Dashboard](1440x900/dashboard/empty-feature.png) | [V6](1440x900/v6/empty-feature.png) | [Dashboard](1280x800/dashboard/empty-feature.png) | [V6](1280x800/v6/empty-feature.png) |

To regenerate the dashboard set, build only the dashboard and use the Studio fixture on an unused browser-test port.

```sh
pnpm --filter @orqst/dashboard build
ORQST_BROWSER_PORT=4369 ORQST_SPEC_L2_CAPTURES=docs/development/spec-l2 \
  pnpm exec playwright test tests/browser/studio-workspace.spec.ts --workers=1
```

## Integration boundaries

- This baseline has no shell header-actions slot. The Studio renders Grade, Restore, Delegate and Add Terminal in its 45 px header.
- Mode, slot order, divider weights, floating geometry, minimization and active pane are scoped to a Feature in the WebView's local storage. The current versioned SQLite layout record carries the older native order, visibility, split and names. It has no fields for the complete React arrangement.
- The existing display labels still come from the native slot. Monotonic,
  non-reusable display IDs require allocation and storage support.
- The native bridge exposes rename and reviewed close. The Settings action edits the name through that bridge. Duplicate and Restart require native endpoints. The close chooser offers Hide and Cancel and passes process termination through the existing signed native confirmation.
- Session IDs and timeline appear when the host provides evidence. Working directory, PID and last error require additional host evidence. The terminal card takes the product state independently of observed turn state. The open and recovery flows still own live startup, reconnect and the ended list.
- The existing preparation request has no enrollment correlation in the Studio WebView. Slot targeting applies only when exactly one new member appears in the same Feature during the bounded placement intent.
- Native opening and attach recovery controls remain in the PTY document. The standalone Electron and developer pilot presentations retain their own authority and document entry points.

## Reuse

This lane retains ORQST's native geometry and focus fences, xterm runtime, Feature metadata and communication projection. Anywh's `TerminalPanel` uses React with retained tabs and Relay WebSockets backed by tmux. Tucano's `route` selects speakers using the Engine and does not supply the Core receipts required by this Studio. Existing Apache-2.0 attribution stays in place. The lane incorporates no upstream code or assets. [Anywh terminal panel](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/terminal/TerminalPanel.tsx), [Tucano router](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts), [ORQST reference review](../../research/v6-terminal-chrome.md).

## Verification

- `pnpm lint` and `pnpm typecheck` passed.
- The serial Studio browser run passed 17 of 17 tests over both requested
  viewport sizes. The focused native renderer, terminal document, arrangement,
  preparation and mention checks passed 36 of 36 tests.
- The dashboard-only build passed. The signed desktop application and live CLI
  output remain outside this Chromium evidence.
