# Integrated Chromium suite triage

## Chromium results

| Run                              | Passed | Failed | Skipped |
| -------------------------------- | -----: | -----: | ------: |
| Integrated baseline at `7e81087` |     89 |    137 |       2 |
| Fix branch                       |    221 |      0 |       2 |

| Primary classification        | Baseline failures | Failures after | Tests removed |
| ----------------------------- | ----------------: | -------------: | ------------: |
| A · Moved or removed UI       |               101 |              0 |             5 |
| B · Product regression        |                32 |              0 |             0 |
| C · Pre-lane failure or flake |                 4 |              0 |             0 |
| **Total**                     |           **137** |          **0** |         **5** |

At `8ad1124` (pre-lane), five scenarios yielded three passes and two failures.
The localized dashboard heading and the session snapshot allowlist already failed.
The allowlist now checks the exact existing contract, including `usageRecorded`.
The artifact reconnect, evolution-reading rejection and malformed appearance
preference scenarios passed on that base. Two Artifacts paging cases also failed
there because the `Live` text matched two elements. The workspace-scoping case
shared that setup failure and exposed a separate product regression after the
status locator was updated. The pre-lane source already used an animation-frame
callback for paging focus, which raced with the enabled state during triage.

## Product corrections

- The shell uses the official artwork in both themes and exposes Core status on
  the narrow rail. Overview and Metrics controls stay in a single 45 px header. Metrics filters
  remain reachable at narrow widths and Refresh stays visible.
- Studio is the default startup screen. Returning from an observed session
  restores the managed Studio scope. Selecting a Workspace preserves the open
  route and the current filtering context. Sidebar shortcuts honor workspace
  pins without writing session data. Palette route actions move focus to content.
- Settings honor interface text size and high contrast, retain visit-only
  appearance choices, and display notification preference save failures.
  Advanced shows measured observer diagnostics with an explicit stale or
  unavailable state.
- Artifact source details retain the snapshot provenance, source limits and the
  difference between a restored draft and a saved file. Paging returns focus to
  Refresh when the source or observation limit is reached. The Metrics disclosures
  explain calendar boundaries, token shares and unavailable measurements.
- Dark muted text meets AA contrast on elevated surfaces.

The tests use the sidebar, the Artifacts split preview, the Metrics tabs and
the Studio header. They set language from General and theme from Appearance
as specified in §11.4. They still assert exact IDs and receipt
states, inert captured content, current-read export admission, and draft and
preference storage boundaries.

## Tests removed

Section 11.1 defines a fixed Overview. Section 2.2 removes the separate managed
agents screen. These five tests exercised those removed surfaces:

- `managed-agents-open.spec.ts` · managed opener explains focus refusal, recovers and supports an older running preload
- `overview-layout.spec.ts` · visible panels and reading order persist; keyboard moves, reset and dismissal retain focus and scope
- `overview-layout.spec.ts` · all-hidden and single-panel layouts retain sessions, notifications and a discoverable recovery action
- `overview-layout.spec.ts` · malformed or removed layout storage recovers safely and same-origin tabs synchronize without storing observations
- `overview-layout.spec.ts` · layout remains usable offline when local storage is denied and reports visit-only changes

Native focus refusal still has a renderer test. Overview evidence and draft
guard tests remain and now exercise the fixed sections and command palette.

## Baseline failure index

Each entry is the original failure number followed by the test's definition
line at `7e81087`. A repeated line denotes distinct parameterizations.

| Spec under `tests/browser/`    | A                                                                                                          | B                                                        | C               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------- |
| `artifact-draft.spec.ts`       | 2 (78), 4 (311)                                                                                            | 1 (14), 3 (121)                                          | —               |
| `artifact-library.spec.ts`     | 5 (32), 8 (187), 10 (266)                                                                                  | 7 (127)                                                  | 6 (71), 9 (213) |
| `artifact-navigation.spec.ts`  | 11 (58), 12 (95), 13 (122), 14 (152), 15 (187), 16 (228), 17 (294)                                         | —                                                        | —               |
| `artifacts.spec.ts`            | 19 (72)                                                                                                    | 18 (17)                                                  | —               |
| `brand-assets.spec.ts`         | —                                                                                                          | 20 (4), 21 (80)                                          | —               |
| `dashboard.spec.ts`            | 23 (49), 24 (62), 25 (158)                                                                                 | —                                                        | 22 (5)          |
| `desktop-analytics.spec.ts`    | 26 (4)                                                                                                     | —                                                        | —               |
| `live-metrics-qa.spec.ts`      | 27 (331)                                                                                                   | —                                                        | —               |
| `live-metrics-updates.spec.ts` | 28 (107)                                                                                                   | —                                                        | —               |
| `managed-agents-open.spec.ts`  | 29 (7)                                                                                                     | —                                                        | —               |
| `model-analytics.spec.ts`      | 33 (187), 34 (263), 35 (263), 36 (286), 37 (308), 38 (340), 41 (549), 42 (588)                             | 30 (89), 31 (129), 32 (157), 39 (407), 40 (490)          | —               |
| `model-comparison-qa.spec.ts`  | 43 (79), 44 (120), 45 (144), 46 (165), 47 (184)                                                            | —                                                        | —               |
| `model-evolution.spec.ts`      | 48 (6), 49 (91)                                                                                            | —                                                        | —               |
| `model-export-qa.spec.ts`      | 50 (44), 51 (73), 52 (141), 53 (185), 54 (220), 55 (257), 56 (310), 57 (349), 58 (381), 59 (399), 60 (410) | —                                                        | —               |
| `model-history-qa.spec.ts`     | 61 (88)                                                                                                    | —                                                        | —               |
| `model-history.spec.ts`        | 62 (29), 63 (92)                                                                                           | —                                                        | —               |
| `model-manager-qa.spec.ts`     | 65 (119)                                                                                                   | —                                                        | 64 (44)         |
| `model-observation.spec.ts`    | 66 (6)                                                                                                     | —                                                        | —               |
| `notifications.spec.ts`        | 67 (8), 68 (130), 69 (164)                                                                                 | —                                                        | —               |
| `observation-guide.spec.ts`    | 76 (254)                                                                                                   | 70 (23), 71 (97), 72 (134), 73 (167), 74 (188), 75 (222) | —               |
| `observed-tools.spec.ts`       | 77 (9)                                                                                                     | —                                                        | —               |
| `overview-layout.spec.ts`      | 78 (15), 79 (64), 80 (92), 81 (142), 82 (165), 83 (200)                                                    | —                                                        | —               |
| `path-navigation.spec.ts`      | 84 (37), 86 (122)                                                                                          | 85 (61)                                                  | —               |
| `reading-preferences.spec.ts`  | 87 (25), 89 (123), 90 (180)                                                                                | 88 (78)                                                  | —               |
| `settings.spec.ts`             | 91 (11), 93 (86), 96 (205), 97 (247), 98 (295), 99 (295)                                                   | 92 (62), 94 (123), 95 (147)                              | —               |
| `shell-navigation.spec.ts`     | 100 (90), 104 (324), 105 (395), 106 (435), 107 (462), 108 (542)                                            | 101 (110), 102 (151), 103 (151)                          | —               |
| `studio.spec.ts`               | 109 (9), 110 (79), 111 (293), 112 (413), 113 (293), 114 (413), 115 (439), 116 (460), 117 (527), 118 (527)  | —                                                        | —               |
| `theme-preferences.spec.ts`    | 119 (15), 120 (44), 121 (68), 122 (108), 124 (188), 125 (231)                                              | 123 (188)                                                | —               |
| `token-threshold-qa.spec.ts`   | 126 (30)                                                                                                   | —                                                        | —               |
| `token-threshold.spec.ts`      | 127 (198)                                                                                                  | —                                                        | —               |
| `visual-refinement.spec.ts`    | 132 (134), 133 (160)                                                                                       | 128 (33), 129 (33), 130 (33), 131 (33)                   | —               |
| `workspace-pins.spec.ts`       | 135 (175), 136 (175)                                                                                       | 134 (29), 137 (231)                                      | —               |

## Verification

- `pnpm lint` — passed
- `pnpm typecheck` — passed
- `pnpm exec playwright test tests/browser --workers=1` — 221 passed and 2 opt-in capture cases skipped (7.2m).
- `pnpm --filter @orqst/dashboard build` — passed. Vite reported its existing chunk-size warning.
- Focused Node checks — 41 passed across locale parity, preferences, routes,
  artifact/source handling, Analytics, and navigation.
- V6 capture checks — both opt-in cases passed at 1440 × 900 and 1280 × 800.
  The shell geometry checks also passed with captures enabled.

The browser suite uses a disposable Bridge and synthetic native capabilities.
The geometry tests capture the dashboard and approved V6 HTML at 1440 × 900
and 1280 × 800. Set `ORQST_SPEC_INTEGRATED_CAPTURES` to an output directory and
run the geometry and capture cases in `shell-navigation.spec.ts` and
`spec-l5-screens.spec.ts` to reproduce. These runs cover Chromium rendering
and browser interaction.

The changes reuse ORQST's native facade and its audited routing contracts.
Anywh's notification routing relies on platform listeners whose macOS click
behavior differs from ORQST's retained-session authorization. Its
`useNotificationClick` uses Tauri event and notification APIs at
[`16d572d`](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/client/src/hooks/platform/useNotificationClick.ts).
The checkout has an Apache-2.0 license and no NOTICE file. The patch uses
ORQST code and assets. The [Tucano audit](https://github.com/eduwxyz/tucano/tree/0501956d127699300209902e889f3e69a0948766)
documents its owned-turn utility process, while this branch keeps ORQST's
observer and existing native authority.
