# ORQST design system

## Direction and scope

The official identity is **Minimal Dark + Developer Studio**: quiet dark layers,
precise typography, restrained purple accents and source-backed status feedback.
The ORQST logo and mascot are the visual references. Preserve approved artwork;
do not recolor or replace native menu-bar assets through dashboard CSS.

This is a Desktop MVP requirement, shared by the browser and Electron dashboard.
The current implementation remains an observation-only React client. The
[interface guide](ui-ux-specification.md) records the navigation/directory increment
and per-screen boundaries. Behavioral layout rules in `shell.css` consume these
same tokens. A visual
specification does not enable terminals, agent execution or orchestration.

## Shared colors

The source of truth for implemented tokens is `apps/dashboard/src/styles.css`.
Use CSS custom properties rather than component-specific color literals.

| CSS custom property  | Approved value | Role                                                        |
| -------------------- | -------------- | ----------------------------------------------------------- |
| `--orqst-background` | `#080B1E`      | Main canvas, input and captured-content backgrounds         |
| `--orqst-surface`    | `#141329`      | Sidebar, cards and panels                                   |
| `--orqst-elevated`   | `#241A3E`      | Dialogs, notification drawer and raised controls            |
| `--orqst-primary`    | `#8424E8`      | Primary action fill                                         |
| `--orqst-neon`       | `#B45CFF`      | Focus rings, selection indicators and confirmed update cues |
| `--orqst-lavender`   | `#D9C9FF`      | Secondary accents and selected labels                       |
| `--orqst-text`       | `#F5F3FF`      | Primary text, including primary action labels               |
| `--orqst-muted`      | `#9994B2`      | Secondary text, timestamps and provenance                   |
| `--orqst-success`    | `#53D6A0`      | Confirmed completion and connected transport                |
| `--orqst-warning`    | `#F5B95E`      | Attention, offline state and reached token threshold        |
| `--orqst-danger`     | `#F17890`      | Source-backed failures                                      |

Derived tokens use `color-mix(in srgb, ...)` with these colors: `border` mixes
16% lavender into surface; `border-strong` mixes 80% muted into surface. `accent-soft`,
`success-soft` and `danger-soft` mix 12% of their named accent into surface;
`warning-soft` uses 10%. `primary-hover` mixes 85% primary with 15% neon. These
remain custom properties with the `--orqst-` prefix. Backdrop and shadow are local
translucent dark layers; avoid decorative glows and broad gradients.

Primary text on primary actions and muted text on the three opaque dark layers
must meet WCAG AA normal-text contrast (4.5:1). Control boundaries and focus
indicators require 3:1 against adjacent dark layers. Subtle panel dividers are
structural decoration, not the sole indication of an actionable control. Never
reduce readable notification text opacity just to indicate that it was read.
Use semantic text/icons with color; color alone must not convey status. Running
uses neon, completed uses success, waiting uses warning, failed uses danger,
interrupted uses lavender and unknown uses muted. Connected describes the Bridge
transport, not proof of an agent process running.

## Typography and layout

Keep the existing local font stack: Inter when installed, then Apple system,
BlinkMacSystemFont, Segoe UI and sans-serif. No web-font downloads are required.
Use `--orqst-font-mono` (SFMono-Regular, Consolas, Liberation Mono, monospace) for
identifiers, captured code and exact readings; use tabular numerals for tokens.
Captured content keeps its original language and is rendered inertly.

The current dense dashboard uses a 13px root, 27px desktop page titles, 13px panel
titles and 10–12px compact labels. Preserve browser zoom and text wrapping. Do
not truncate the only accessible copy of provenance or identifiers. The spacing
scale `--orqst-space-1` through `--orqst-space-6` is 4, 8, 12, 16, 20 and 24px.
Existing asymmetric layout spacing and larger page insets remain intentional.

Use 1px panel borders with `--orqst-border`; controls that need an identifiable
boundary use `--orqst-border-strong`. Default control radius is
`--orqst-radius-control` (5px); panel radius is `--orqst-radius-panel` (9px).
Retain the existing compact badges and icon shapes. Avoid excessive shadows,
glass layers or decorative effects competing with observation data.

Preserve the current responsive layout: fixed sidebar on wide screens; stacked
secondary panels below 900px; workspace menu and two-column overview metrics
below 700px; one-column Analytics metrics and filters below 700px; narrower
artifact/provenance and metric layouts below 600px. Tables scroll inside their
container; long captured text wraps. Keyboard focus must remain visible on
buttons, links, selects, inputs, textareas and disclosure summaries. Dialog
behavior, labels, dismissal, validation and existing i18next translations remain
part of the component contract.

## Component coverage and future modules

All planned frontend modules inherit this system when they become supported.
This table is a visual requirement, not a declaration that a module is shipped.

| Area                                   | Application and current boundary                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard / Overview and observability | Surface cards and timeline, exact counts, semantic statuses, readable provenance; implemented                                                                                           |
| Workspaces and tabs                    | Directory search, grid/list, sort and scoped navigation use shared surfaces; open project tabs remain planned                                                                           |
| Agent and model selectors              | Descriptor capability matrix and current filters use shared controls; observed models remain historical identifiers, not execution pickers                                              |
| Model Analytics                        | Shared filters/cards, neon share/evolution bars, explicit coverage and unavailable values; current bounded views remain intact                                                          |
| Notifications / Attention Center       | Elevated drawer, warning/danger/success with category text; current preference/history behavior preserved                                                                               |
| Artifacts                              | Dark inert source/preview/editor, selected-mode indicators and elevated discard dialog; original/draft distinction preserved                                                            |
| Settings and onboarding                | Current notification preferences/workspace form follow shared controls; grouped Settings adds contrast/spacing/motion, reading sizes/fonts and scoped reset; onboarding remains planned |
| Studio and integrated terminals        | Planned: shared canvas/layers and readable monospace; no PTY or controls added by this update                                                                                           |
| Orchestration / Agent Collaboration    | Planned: same tokens; only explicit source-backed relationships and separately authorized controls                                                                                      |
| Kanban                                 | Planned: same surfaces, focus and semantic labels; do not infer task progress from inactivity                                                                                           |

Electron's native menu-bar artwork, menus, OS dialogs and alerts have their own
platform constraints. The shared dashboard stylesheet does not theme native OS
surfaces. No new production dependency is required for this design system.

## Motion and mascot states

Use `--orqst-motion-fast` (150ms) for control background, text and border changes.
Panel transitions, when implemented, should use short opacity/transform changes,
keep focus stable and avoid layout thrashing. Never make content availability
or navigation depend on an animation finishing.

Token readings update to confirmed exact values; the existing 1.6s confirmed-change
cue highlights only newer evidence. Do not interpolate counters through fabricated
values, animate initial/stale readings or announce every frame. A temporary
configured threshold already has a static warning flame only when the confirmed
total reaches it; stale/unavailable readings suppress the comparison. Smoothness
comes from the highlight, not estimated counts.

Fast lightning is planned and requires explicit provider capability plus an actual
enabled Fast state. A model name or quick response is insufficient. Mascot motion
is also planned; no animated mascot is implemented in the dashboard. Future eye
movement and reactions must follow this mapping:

| Evidence / visual state          | Intended mascot reaction                                       |
| -------------------------------- | -------------------------------------------------------------- |
| No confirmed state / unavailable | Neutral static pose; no implied activity                       |
| Explicit observed running turn   | Subtle eye movement; no claim of process liveness              |
| Explicit waiting for user        | Static attentive pose and warning cue with text                |
| Explicit completed turn          | One brief completion reaction; not task/process completion     |
| Explicit failure                 | One brief danger reaction with error text                      |
| Explicit interruption            | Quiet lavender reaction, distinct from failure                 |
| Confirmed threshold reached      | Warning/flame cue while the configured comparison is available |

Never derive reactions from prose, elapsed time or inactivity. Decorative artwork
must be hidden from assistive technology; meaningful state needs adjacent localized
text. Avoid flashing, perpetual bouncing and animation that hides source content.

Settings offers standard/higher dark contrast and compact/comfortable spacing.
Higher contrast derives muted text and borders from lavender without changing
semantic state colors. Comfortable spacing increases control targets (40px), table
rows, workspace cards and activity entries. Interface sizes use `rem` with the existing
pixel-equivalent baseline at the usual 16px browser default. The root follows the
browser default and allows 100%, 112.5% or 125% scaling; layout spacing remains separate.
Captured task/message/tool bodies and Artifact content use a shared 13px-equivalent
reading baseline with an additional 0%, 15% or 30% increase. Source/edit keep their
existing font defaults; optional local monospace/sans-serif reading choices never
alter text. Inert Markdown code blocks always retain monospace. Identifiers, provenance
and metric values follow interface scaling only. Keep long text wrappable and bound
scrolling inside panels. Browser zoom remains available. No light palette or terminal
font control is implemented.

The local Reduce motion choice and existing `prefers-reduced-motion: reduce` rule
disable animations, transitions and smooth scrolling. Keep the exact numbers, static outline, state
labels, flame and all actions available. Future mascot, panel and Fast effects
must honor the same preference without losing information. The OS request always
wins; Follow system never forces animation against it. See the
[local preference contract](ui-ux-specification.md#local-preference-contract).

## Development and acceptance

For visual changes run lint, types, tests and build, then inspect desktop/mobile,
keyboard focus, contrast and reduced motion against isolated synthetic data.
Record actual outcomes separately from requirements. Do not publish captured
sessions, private briefs, generated screenshots or local acceptance reports.
Native Desktop, other-browser and manual assistive-technology acceptance require
separate evidence; automated Chromium checks alone do not establish them.
