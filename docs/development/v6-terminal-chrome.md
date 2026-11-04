# V6 terminal chrome

The first V6 UI increment changes the shared interactive document, used by both
Electron and the prepared Tauri terminal host. The approved source remains
`docs/design/v6/source/ORQST_workspace_v6_features.html`. Its simulated sessions,
models, workspaces and localStorage state are never imported by the application.

## Interaction

- The compact 31px header shows the reviewed provider, existing manifest alias (or
  legacy selection-local T-number), editable display name and actual owned-process state.
  The full lifecycle explanation remains in the status tooltip; this state does
  not assert authentication, provider readiness, task completion or model access.
- **Minimize pane** uses the existing visual `hide` action. **Maximize** and
  **Restore** use the existing retained-document layout channel. None starts,
  attaches, detaches or stops a process.
- **⋯** opens a keyboard-accessible disclosure with sibling navigation, dashboard,
  settings/layout, rename, order, columns, split ratio and session/permission
  details. Enter/Space opens it; Escape within the disclosure closes it and
  returns focus to its trigger. Clicking outside closes it without stealing
  terminal focus. xterm keys are not intercepted by menu shortcuts.
- **Start CLI → Connect output → Enable keyboard input** and **Stop process**
  remain directly reachable above xterm. Force stop and legacy separate login
  remain inside session details. Start, attach, input, exact paste, detach and
  stop retain their individual native confirmations and existing signed authority.
- Routine guidance/status becomes visually compact while input is enabled.
  Relevant refusals, output gaps and transport failures remain visible, including
  when the menu opens/closes or focus changes. A new accepted explicit request
  can replace a prior refusal. Background reads do not clear it.
- A failed native transport disables input and reports unconfirmed process state.
  It does not restart, retry, adopt or signal a process. Unknown ownership remains
  controlled by the existing broker.

All existing client element IDs, lifecycle dataset fields, tab targets and native
request shapes are retained. The xterm instance, 2,000-line scrollback, OSC
clipboard/link/title suppression, trusted-keyboard forwarding and exact-paste
review remain in the same document. Resizing reuses the attributed Anywh
ResizeObserver adaptation, FitAddon and existing bounded Core/PTY resize poll.
Both shipped locales and reduced-motion rules are covered. Coarse-pointer devices
retain 44px controls; fine-pointer desktop headers match the compact reference.

## Current boundaries

This increment implements the terminal chrome, not the complete V6 workspace.
The existing `Studio.tsx` preparation page is unchanged. Sidebar Workspace →
Feature, breadcrumb, Feature creation/rename/selection, terminal membership and
per-Feature SQLite layout depend on the exact private contract being implemented
by the Feature front. No executable HTTP routes, fake CRUD, localStorage Feature
store or alternative runtime are introduced here.

Existing docked grid, order, paging, ratio, hide/show and maximize/restore remain
available through the current layout owner. Floating geometry, arbitrary nested
splitters, a minimized-pane bottom dock, live membership and Feature-specific
layout cannot be claimed through that contract. The menu states the Floating and
per-Feature limitation rather than offering a success-looking action. Provider
model choice and task cancellation are not invented. **Stop process** sends the
existing reviewed signal; it is not **Stop task**. **Disconnect output** detaches
only the view, while **Minimize pane** only hides it.

## Renderer verification

```bash
pnpm build:desktop
pnpm exec tsx scripts/accept-terminal-ui.ts --authorize-synthetic-ui
pnpm exec tsx --test tests/terminal-document.test.ts tests/terminal-layout.test.ts \
  tests/terminal-panels-runtime.test.ts tests/terminal-native-broker.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The explicit UI runner uses Chromium, the actual bundled renderer/xterm/CSS and
an isolated synthetic native transport. It captures both locales at desktop,
split and narrow sizes, keyboard menu/focus behavior, rename, lifecycle, native
refusal/transport failure, and min/max/restore requests with unchanged xterm DOM
and buffer and no additional start/stop. It also renders the approved HTML at
1440×900 and measures its 155px sidebar, 45px topbar and 31px pane headers.
The four-frame comparison is a test-only geometry guide, not a functioning
Feature sidebar, native split workspace or running CLI.

Intentional differences from the prototype are real consent/process controls and
visible diagnostics; existing P-UUID aliases/legacy selection-local numbers instead of invented
workspace identities; full state explanations in tooltips/details; and no
simulated orchestrator, models, token values, communication or task success.
Screenshots and generated reports stay outside Git. Chromium/facade results do
not establish native WebKit focus/modal/clipboard/IME, live PTY/provider acceptance,
process survival during actual Feature switching or cross-platform packaging.

Integration updated the developer pair/team and Tauri runners to open the pane
menu/settings before their controls; the native single-pane smoke checks provider
text in its separate badge. The packaged eight-PTY Tauri fixture passed on this
chrome. Electron pair/team headful runs were deferred during the concurrent native
focus investigation; no pass is claimed for those adapted runners. Native/provider
acceptance remains separate from Chromium and simulated transports.

## Integration fragments for central documentation

These fragments avoid concurrent changes to the delivery tracker and central docs:

- **V6 checklist:** terminal chrome partial: compact header/menu, actual lifecycle,
  hide/maximize/restore, keyboard focus, locales, retained xterm and visible errors.
  Feature sidebar/CRUD, per-Feature docked/floating geometry, native focus and real
  provider milestones remain unchecked.
- **README / CHANGELOG:** shared interactive terminals now use compact V6 chrome
  with a pane menu for navigation, layout and session details. Existing signed
  process controls and persistent retained documents are preserved. See this guide
  for actual capabilities and separate native/provider acceptance limits.
- **ROADMAP / design system:** the V6 header/terminal surface is implemented over
  the existing renderer; the full Feature hierarchy/sidebar and Floating layout
  remain dependent on the corresponding Core/native contracts. Do not mark the
  whole V6 UI acceptance complete from the renderer comparison alone.

See the [pinned reuse review](../research/v6-terminal-chrome.md).

## Integrated drag/menu regression — 2026-11-04

Outside dismissal uses click rather than pointerdown. A drag begins on the header
outside the disclosure; closing at pointerdown hid its existing tab drop targets
before the drag could reach them. The Chromium runner now performs an actual
header-to-tab drag in both locales and verifies the existing `moveTo` request,
while menu dismissal, input revocation and retained xterm checks continue to pass.
The integrated Node suite passed 710 tests before this browser-only dismissal
adjustment; lint/typecheck, desktop build and the updated renderer were rerun after
it. No native provider or WebKit claim is made.
