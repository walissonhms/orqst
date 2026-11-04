# ORQST design system

## Direction and scope

The official identity is **Minimal Dark + Developer Studio**: default dark layers,
precise typography, restrained purple accents and source-backed status feedback.
The ORQST logo and mascot are the visual references. Preserve approved artwork;
do not recolor or replace native menu-bar assets through dashboard CSS.
The approved static [brand assets](brand-assets.md) are used in navigation and the
empty-session welcome; the mascot does not indicate agent status.

This is a Desktop MVP requirement, shared by the browser and Electron dashboard.
The current implementation remains an observation-only React client. The
[interface guide](ui-ux-specification.md) records the navigation/directory increment
and per-screen boundaries. Behavioral layout rules in `shell.css` consume these
same tokens. A visual
specification does not enable terminals, agent execution or orchestration.

## Shared colors

The source of truth for implemented tokens is `apps/dashboard/src/tokens.css` (base) and `styles.css` (light overrides).
Use CSS custom properties rather than component-specific color literals. The table
below describes the default dark palette; light overrides follow below.

| CSS custom property  | Approved value | Role                                                        |
| -------------------- | -------------- | ----------------------------------------------------------- |
| `--orqst-background` | `#080B1E`      | Main canvas, input and captured-content backgrounds         |
| `--orqst-surface`    | `#141329`      | Sidebar, cards and panels                                   |
| `--orqst-elevated`   | `#241A3E`      | Dialogs, notification drawer and raised controls            |
| `--orqst-primary`    | `#8424E8`      | Primary action fill                                         |
| `--orqst-neon`       | `#B45CFF`      | Focus rings, selection indicators and confirmed update cues |
| `--orqst-lavender`   | `#D9C9FF`      | Secondary accents and selected labels                       |
| `--orqst-text`       | `#F5F3FF`      | Primary interface text                                      |
| `--orqst-on-primary` | `#F5F3FF`      | Primary action labels in both palettes                      |
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

## Light theme

Settings offers **Dark**, **Light** and **Follow system**. Dark remains the default
and migration fallback. System selection follows `prefers-color-scheme` changes;
explicit selections ignore them. `data-theme` on the root contains the resolved
palette and `color-scheme` supplies matching native form controls. Native menus,
file dialogs, alerts and menu-bar assets are outside dashboard CSS.

The light palette in `styles.css` overrides the same shared tokens:

| Token suffix | Light value |
| ------------ | ----------- |
| `background` | `#F7F5FC`   |
| `surface`    | `#FFFFFF`   |
| `elevated`   | `#EEE9F6`   |
| `text`       | `#211A35`   |
| `muted`      | `#60556F`   |
| `neon`       | `#7020B8`   |
| `lavender`   | `#583080`   |
| `success`    | `#176B47`   |
| `warning`    | `#845100`   |
| `danger`     | `#AF2345`   |

Primary fill remains purple; `--orqst-on-primary` remains `#F5F3FF` in both themes,
so changing general text color never puts dark labels on purple actions. Soft fills,
borders, charts, captured-content areas and focus cues derive from active tokens.
Light backdrop/shadow use translucent `#211A35` at 40%/16%. Higher contrast uses the
active lavender for muted text and stronger borders in both palettes; status
labels/icons remain explicit. This is a functional alternate palette, not a claim
of new approved brand artwork or native Desktop visual acceptance.

Light normal text, secondary accents and semantic colors must meet 4.5:1 against
the three opaque layers and their used soft fills; focus and control boundaries
must meet 3:1. `theme-preferences.spec.ts` checks both palettes and computes these
ratios from actual resolved CSS, including derived colors. This bounded check is not a full accessibility audit.

## Typography and layout

Keep the existing local font stack: Inter when installed, then Apple system,
BlinkMacSystemFont, Segoe UI and sans-serif. No web-font downloads are required.
Use `--orqst-font-mono` (SFMono-Regular, Consolas, Liberation Mono, monospace) for
identifiers, captured code and exact readings; use tabular numerals for tokens.
Captured content keeps its original language and is rendered inertly.

The dashboard uses a 13px body baseline, 30px desktop page titles, 14px panel
titles and 11–13px compact labels. Primary navigation uses 13px text and icon
controls have a 36px minimum target; comfortable spacing retains 40px targets.
Preserve browser zoom and text wrapping. Do not truncate the only accessible copy of provenance or identifiers. The spacing
scale `--orqst-space-1` through `--orqst-space-6` is 4, 8, 12, 16, 20 and 24px.
Existing asymmetric layout spacing and larger page insets remain intentional.

Use 1px panel borders with `--orqst-border`; controls that need an identifiable
boundary use `--orqst-border-strong`. Default control radius is
`--orqst-radius-control` (5px); panel radius is `--orqst-radius-panel` (9px).
Retain the existing compact badges and icon shapes. Avoid excessive shadows,
glass layers or decorative effects competing with observation data.

The sidebar is fixed and independently scrollable on wide screens, including
short windows; secondary panels stack below 900px. Overview metrics use two
columns below 1100px. Below 700px, the workspace menu includes the theme-aware
logo, and a 108px two-row header separates scope from actions; the session context
strip shares that height token to avoid overlap. Session rows become labeled
mobile cards while preserving all original fields, table headers and actions.
Analytics metrics and filters use one column below 700px; artifact/provenance and
metric layouts narrow below 600px. Other tables scroll inside their containers;
long captured text wraps. Analytics export/evolution panels use the same internal
spacing as other panels.
Desktop Settings keeps the smaller groups together beside Appearance, avoiding
empty grid rows; narrow windows retain DOM order. Keyboard focus must remain
visible on buttons, links, selects, inputs, textareas and disclosure summaries. Dialog
behavior, labels, dismissal, validation and existing i18next translations remain
part of the component contract.

## Component coverage and future modules

All planned frontend modules inherit this system when they become supported.
This table is a visual requirement, not a declaration that a module is shipped.

| Area                                   | Application and current boundary                                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard / Overview and observability | Surface cards and timeline, exact counts, semantic statuses, readable provenance; four secondary panels support local visibility/order and keyboard controls                                    |
| Workspaces and tabs                    | Directory search, grid/list, sort and scoped navigation use shared surfaces; open project tabs remain planned                                                                                   |
| Agent and model selectors              | Descriptor capability matrix and current filters use shared controls; observed models remain historical identifiers, not execution pickers                                                      |
| Model Analytics                        | Shared filters/cards, neon share/evolution bars, explicit coverage and unavailable values; current bounded views remain intact                                                                  |
| Notifications / Attention Center       | Elevated drawer, warning/danger/success with category text; current preference/history behavior preserved                                                                                       |
| Artifacts                              | Inert source/preview/editor using active layers, selected-mode indicators and elevated discard dialog; original/draft distinction preserved                                                     |
| Settings and onboarding                | Grouped Settings uses shared controls; optional Observation guide uses the native modal, ordered steps, diagnostic definition lists and existing navigation. Broader onboarding remains planned |
| Studio and integrated terminals        | Planned: shared canvas/layers and readable monospace; no PTY or controls added by this update                                                                                                   |
| Orchestration / Agent Collaboration    | Planned: same tokens; only explicit source-backed relationships and separately authorized controls                                                                                              |
| Kanban                                 | Planned: same surfaces, focus and semantic labels; do not infer task progress from inactivity                                                                                                   |

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

Settings offers standard/higher contrast in both themes and compact/comfortable spacing.
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
scrolling inside panels. Browser zoom remains available. Terminal font controls remain
unimplemented.

The local Reduce motion choice and existing `prefers-reduced-motion: reduce` rule
disable animations, transitions and smooth scrolling. Keep the exact numbers, static outline, state
labels, flame and all actions available. Future mascot, panel and Fast effects
must honor the same preference without losing information. The OS request always
wins; Follow system never forces animation against it. See the
[local preference contract](ui-ux-specification.md#local-preference-contract).

## Development and acceptance

See [dashboard visual checks](../development/dashboard-visual-checks.md) for
the reproducible synthetic matrix. For visual changes run lint, types, tests and
build, then inspect desktop/mobile, keyboard focus, contrast and reduced motion against isolated synthetic data.
Record actual outcomes separately from requirements. Do not publish captured
sessions, private briefs, generated screenshots or local acceptance reports.
Native Desktop, other-browser and manual assistive-technology acceptance require
separate evidence; automated Chromium checks alone do not establish them.

## Native Studio chrome

Native interactive documents import the same base tokens as the dashboard; xterm
reads the resolved canvas/text/cursor colors. Slot/provider headings stay compact,
full internal identity stays in session details, member navigation scrolls, split
orientation stays visible and advanced layout is collapsible. The next available
process step has primary emphasis; Stop remains visible and permission/error copy
never relies on color alone. Narrow panes wrap controls, retain 44px targets and
scroll vertically instead of clipping their terminal. Reduced-motion rules remain.
