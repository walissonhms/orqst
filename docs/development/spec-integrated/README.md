# ORQST specification integration

The shared AppShell renders the Studio, Overview, Communication, Metrics, Artifacts
and Settings routes. The Studio actions and limits chip use the header outlet.
The footer bell opens owned-terminal notifications from any route. A notification
checks the saved Feature and terminal UUID before selecting the Feature and focusing
the card. Overview keeps observed history collapsed with links to read-only details.

## Chromium captures

The browser fixtures render the dashboard bundle in Portuguese with synthetic
Core and catalog data. The Studio and pane menu show renderer geometry and controls.
Native PTY output and macOS notification delivery require packaged Preview acceptance.
The approved V6 HTML is included at both sizes for comparison.

| State                | 1440 × 900                                                                                                          | 1280 × 800                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Approved V6 HTML     | [Desktop](1440x900/v6-reference.png)                                                                                | [Laptop](1280x800/v6-reference.png)                                                                                 |
| Studio grid          | [Desktop](1440x900/studio-grid.png)                                                                                 | [Laptop](1280x800/studio-grid.png)                                                                                  |
| Pane menu            | [Desktop](1440x900/pane-menu.png)                                                                                   | [Laptop](1280x800/pane-menu.png)                                                                                    |
| Communication        | [Desktop](1440x900/communication.png)                                                                               | [Laptop](1280x800/communication.png)                                                                                |
| Delegate dialog      | [Desktop](1440x900/delegate.png)                                                                                    | [Laptop](1280x800/delegate.png)                                                                                     |
| Overview             | [Desktop](1440x900/overview.png)                                                                                    | [Laptop](1280x800/overview.png)                                                                                     |
| Metrics              | [Usage](1440x900/metrics-usage.png) · [Models](1440x900/metrics-models.png) · [Limits](1440x900/metrics-limits.png) | [Usage](1280x800/metrics-usage.png) · [Models](1280x800/metrics-models.png) · [Limits](1280x800/metrics-limits.png) |
| Artifacts            | [Rendered](1440x900/artifacts-rendered.png) · [Markdown](1440x900/artifacts-markdown.png)                           | [Rendered](1280x800/artifacts-rendered.png) · [Markdown](1280x800/artifacts-markdown.png)                           |
| Settings             | [General](1440x900/settings-general.png) · [Agents](1440x900/settings-agents.png)                                   | [General](1280x800/settings-general.png) · [Agents](1280x800/settings-agents.png)                                   |
| Limits popover       | [Desktop](1440x900/03-limits-popover.png)                                                                           | [Laptop](1280x800/03-limits-popover.png)                                                                            |
| Notifications drawer | [Desktop](1440x900/04-notifications.png)                                                                            | [Laptop](1280x800/04-notifications.png)                                                                             |
| First run            | [Desktop](1440x900/onboarding.png)                                                                                  | [Laptop](1280x800/onboarding.png)                                                                                   |

To regenerate the captures, build the dashboard and run the four browser
specifications with `ORQST_SPEC_INTEGRATED_CAPTURES=docs/development/spec-integrated`.

```sh
pnpm -s --filter @orqst/dashboard build
ORQST_SPEC_INTEGRATED_CAPTURES=docs/development/spec-integrated \
  pnpm exec playwright test tests/browser/studio-workspace.spec.ts \
  tests/browser/communication-inspector.spec.ts tests/browser/spec-l5-screens.spec.ts \
  tests/browser/studio-alerts.spec.ts --workers=1
```

The integration retains the existing ORQST Feature snapshot, authorization
and terminal layout contracts. Settings can read the catalog from its canonical
routes. Its optional path and version describe a unique reviewed executable.
Communication routes use the existing Core receipt and grant validation.
