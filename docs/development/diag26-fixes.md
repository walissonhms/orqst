# Diag26 startup and Studio

The packaged Preview at `7e81087` reported a catalog request followed by a bootstrap failure before the preparation helper spawned. The shared entry point checked native focus even for a read. Catalog and startup reads now allow an unfocused main window while retaining origin, current-document, visibility and presentation checks. Interactive helper messages are refused during passive reads. Terminal creation, enrollment, reopening and configuration changes still use their existing native checks.

Onboarding depended on a renderer preference alone. The managed dashboard now waits for a successful empty result from the private Feature database before opening first-run onboarding. CLI discovery has its own loading, failure and retry states.

On a normal desktop launch there may be no terminal host. The native Feature snapshot needed that host, while the shell built its Workspace list from the observer and restored an observer filter. The shell now reads managed metadata through the native sidecar, restores the remembered managed Workspace and uses its saved Feature selection. A missing selection falls back to General when it exists. Observed projects stay in the observation views. Live Core snapshots still own the active scope of their project.

The Studio requires current owned-process or open-attempt evidence to render a card. Missing evidence puts saved members under Ended with an ownership-uncertain state. Known releases use the existing reopen and remove paths. The row uses a relative exit time when Core supplies it. Legacy entries can lack a recoverable name, CLI or timestamp. The card hides an unassigned display ID and an unknown model, keeps a single token placeholder, and places the failure reason code behind View logs.

On diag26 the correct Studio never appeared in the reported run. The corrected dashboard fixture reached the selected Feature in 661 ms from browser navigation on an isolated rerun and in 2,116 ms while the focused Node tests were also running. The staged preparation helper returned the populated tree in 72 ms and the scoped catalog in 84 ms against private disposable data. The diag26 diagnostics recorded 1,172 ms to native setup ready, which is a different boundary from Studio visible.

## Captures

Chromium rendered the production dashboard bundle with an isolated, synthetic bridge and scoped native replies. No CLI processes or Preview data were used for these captures.

| State                                 | Corrected dashboard at 1440 × 900                                                                                | Approved reference                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Studio and pane menu                  | [Studio](diag26-fixes/1440x900/studio-grid.png) · [Pane menu](diag26-fixes/1440x900/pane-menu.png)               | [V6 Studio](diag26-fixes/1440x900/v6-studio.png)                      |
| Opening and failure                   | [Starting](diag26-fixes/1440x900/starting.png) · [Failed](diag26-fixes/1440x900/failed.png)                      | [V6 Studio](diag26-fixes/1440x900/v6-studio.png)                      |
| Reconciled history and empty Feature  | [Ended](diag26-fixes/1440x900/ended.png) · [Empty Feature](diag26-fixes/1440x900/empty-feature.png)              | [Approved HTML](../design/v6/source/ORQST_workspace_v6_features.html) |
| Scoped delegation and first-run retry | [Delegate](diag26-fixes/1440x900/delegate-antigravity.png) · [Retry](diag26-fixes/1440x900/onboarding-retry.png) | [Approved HTML](../design/v6/source/ORQST_workspace_v6_features.html) |

[1280 × 800 captures](diag26-fixes/1280x800/) cover the same states. The packaged ≤2 s startup target still requires an isolated packaged run.

## Verification

- Lint, TypeScript and the dashboard build passed. The Vite build reported its chunk-size warning.
- Focused Node tests passed (80). The Tauri suite passed (202, two ignored) and the terminal-core suite passed (71, one ignored), both with one test thread.
- All six diag26 Chromium tests passed with one worker, including the reference capture. The unchanged browser specs for shell navigation, Studio, lifecycle, L5 screens and communication finished with 11 passed, 18 failed and two capture-only skips. Several Studio fixtures expected a pane before supplying live evidence. Other failures included shell selectors and fixture setup. The browser-suite lane owns those specifications.
- The selected-Feature timing is from Chromium. The packaged WebView and real terminal providers were outside the capture run.

## Reference review

Anywh's first-launch effect in [App.tsx](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/client/src/App.tsx#L295-L308) delegates to [useTabs.restoreTabs](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/client/src/hooks/tabs/useTabs.ts#L540-L554) and restores tabs in React without marking them running. Anywh uses React tab state with profile and Relay session identities. ORQST keeps its existing private SQLite Feature view and signed terminal broker because Relay tabs have a different lifecycle and authority contract. The pinned tree contains an [Apache-2.0 license](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/LICENSE) and no root NOTICE. No source or dependency was incorporated. Delegation filtering stays in the existing ORQST dialog and uses the current Feature's membership. The approved V6 HTML governs the visual changes.
