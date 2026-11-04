# Studio terminal workflow

## N-member navigation update — 2026-11-03

The preceding A/B workflow is preserved as a preset. A configured maximum of 1–8
now exposes all selected same-project/provider members as tabs in this window,
with at most two documents in a split. New manifests carry persisted UUID metadata
and P-UUID aliases; legacy T-number labels remain local. No dynamic live membership,
model/provider parity or process recovery is implied. See
[terminal teams](terminal-teams.md) for configuration and acceptance scope.

The opt-in Desktop interactive terminals use the same main window as the observer
dashboard. Each A/B document retains its isolated preload, native sender checks,
Core ownership, xterm output and signed process/input confirmations. This UI increment
adds no operation, provider, permission, schema or network route.

## Create, review and open

Use **Terminals / Studio** in the sidebar, then **Prepare Codex + OpenCode…**.
The native menu also keeps the homogeneous presets and advanced existing-file selection.
Passive discovery offers reviewed installed CLI candidates and the existing Node runtime;
complete paths, hashes and native identity still require the existing native reviews.
Choose an empty disposable project. No provider is started by preparation.
See [Studio preparation and compatibility](studio-preparation.md) for exact steps,
resume-review behavior and the distinction between static updates and Desktop relaunch.

Choose **Open reviewed terminals** in Studio, or A/B through the native menu. They appear in the **same window**,
initially side by side. Opening a panel starts no CLI. Each panel shows its slot,
provider, selected project and owned-process lifecycle. It does not invent a model,
usage total, authentication result or task state. T-001/T-002 are the existing local
slot aliases; they can repeat for a fresh pair. They are not durable addresses in
the separate pane-communication registry. The actual Core lifetime UUID and process
instance UUID are selectable text under **Permissions & session details**.

## Connect and type

1. **Start CLI** reviews the native startup permission. Native CLI configuration can
   cause activity or cost at startup; read that provider's disclosure.
2. **Connect output** attaches this document to its own process output. A live process
   does not establish provider readiness, login or task completion.
3. **Enable keyboard input** requests the existing two-minute native permission,
   then focuses xterm. Paste uses a separate exact-text native confirmation.

The next step changes from the accepted native lifecycle/attachment replies.
Cancellation and focus refusal remain visible in the status region. A background
read does not disable a pending action gesture. Keep macOS unlocked and focus the
exact terminal panel before requesting an operation. Layout changes, blur and view
switching revoke input; enable it again to type. Lease expiry is enforced by the
Core and may be reported on the next input attempt, not by a client countdown.

**Stop process…** stays visible next to the main process actions. It sends the
existing confirmed SIGTERM to this owned process. **Force stop process…** is under
session details to reduce accidental use; it retains its separate confirmation.
Neither action is provider-aware task cancellation or proof of descendant cleanup.

## Arrange panels and preserve drafts

Fixed A/B buttons select one full-size panel. **Terminal layout** expands the
existing side-by-side/stacked options, maximize/restore, sibling focus and 25–75%
keyboard/drag range control. A selected single tab is marked pressed; when split,
neither tab implies it is the only visible panel. All controls are ordinary buttons
or a native range input; terminal keystrokes are not intercepted for layout shortcuts.

**Hide pane** hides only that document. **Show dashboard** returns to the still-loaded
observer and its memory-only Artifact draft. **Disconnect output** detaches this
view; **Stop process…** ends the owned process. These are separate operations.
Layout and drafts survive view switching in memory; restart/crash recovery and
reboot process survival are not provided by this UI. Quit retains its native review.

Narrow panels wrap controls, expose a project-path tooltip, keep a usable terminal
minimum height and allow vertical scrolling. Prefer a single tab/maximize on narrow
screens. The renderer is responsive at 390px; this does not provide browser/mobile
access to Desktop process controls. Keyboard focus outlines, minimum 44px narrow-view
button height, reduced-motion rules and localized labels are included. Output remains
plain terminal data, separate from trusted chrome. Internal UUIDs and longer native
permission disclosures are collapsed by default.

## Limits and verification

Dynamic team membership, mixed-provider pairs, model selection, rename/reorder,
search, a boundary drag handle, durable layouts, queued communication and real CLI
delegation acceptance remain separate work. No new provider or native modal human
acceptance is claimed. This increment does not change ingestion or source sessions.

The renderer-only synthetic acceptance is explicit:

```bash
pnpm build:desktop
pnpm exec tsx scripts/accept-terminal-ui.ts --authorize-synthetic-ui
```

It fulfills every browser request locally, supplies a labeled synthetic transport,
and writes screenshots to a temporary folder. It checks en-US/pt-BR at desktop,
split-panel and mobile widths, state guidance, cancellation, layout refusal, output,
keyboard navigation and disclosure behavior. It does not prove native focus,
consent, real CLI compatibility or process recovery. The existing explicit
`accept:terminal-pair --authorize-synthetic-pty` remains the separate same-window
Electron/PTY/draft-preservation regression.

Validation on Node 24.22.2 / pnpm 10.34.9 passed lint, typecheck, all 534 Node tests,
full build, the explicit renderer-only acceptance and the same-window synthetic
Electron/PTY pair acceptance. The latter also verified exact unsaved Artifact draft
preservation, both keyboards, both split axes, ratio, maximize/restore, native
identities, hidden-sender refusal, input revocation, owned exits and safe retirement.
Renderer captures were inspected at 1440, 640 and 390px in both languages. The
existing dashboard bundle-size advisory remains. Full dashboard Chromium, real-source
validation, manual screen-reader/native human-dialog acceptance and real providers
were not run for this UI change. No service restart is needed to serve rebuilt
static dashboard assets; an already loaded Electron main/preload is not hot-upgraded.
