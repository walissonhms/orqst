# ORQST frontend specification

Status: consolidated source of truth for the dashboard UI, written 2026-11-05.
Owner: pane-768 (frontend owner by owner decision on 2026-11-05).

This document describes how the ORQST frontend is built, what each screen must
contain, and where the current implementation differs. It consolidates:

- the approved V6 package ([sources](v6/source/), especially
  `ORQST_UI_UX_FEATURES_ATUALIZADO.md` and `ORQST_workspace_v6_features.html`);
- the owner-directed [Feature canvas amendment](feature-canvas-2026-11-05.md);
- the [design system](design-system.md) and [brand assets](brand-assets.md);
- the dated increment history in [ui-ux-specification.md](ui-ux-specification.md),
  which remains preserved as evidence and is not rewritten.

When a requirement here conflicts with an older dated section, this document wins.
When it conflicts with the V6 sources, the V6 sources win unless an owner decision
is recorded in section 9.

## 1. Runtime surfaces

The same React 19 + Vite + Tailwind 4 + i18next code base renders in three hosts.

| Host                                        | Entry                                                              | What it shows                                 | Authority                 |
| ------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------- | ------------------------- |
| Browser (`pnpm dev`, Bridge `/api` + `/ws`) | `main.tsx` → `App`                                                 | Observer views only                           | Read-only observation     |
| Tauri main Webview                          | `main.tsx` → `App`, `window.orqstFeatures` present                 | Observer views + native Studio entry          | Native facade v1          |
| Tauri `feature-workspace` child Webview     | `feature-workspace-mount.tsx` → `FeatureWorkspace nativeWorkspace` | Feature chrome: sidebar, tabs, canvas, footer | Native facade v1          |
| Tauri terminal child Webviews               | native terminal documents (xterm)                                  | Real PTY output and input                     | Native terminal authority |

Rules that apply to every host:

- The dashboard never imports Node-only modules and talks to the Bridge only via
  `/api/*` and `/ws`; native features only via the typed `window.orqstFeatures`
  facade (`packages/protocol/src/feature-native.ts`).
- Terminal Webviews are never placed inside a CSS-transformed DOM (canvas zoom).
  The chrome reserves fixed insets that Node and Rust agree on: sidebar 155px
  (46px at ≤720px), header 45px, tabs 36px, footer 34px.
- A dialog must never be placed behind a native child Webview. Feature-level forms
  use inline sidebar editors.

## 2. Visual foundation

### 2.1 Tokens

All colors come from `tokens.css` (`--orqst-*`). Components must not contain hex
literals. Required token groups:

| Group    | Tokens                                                                |
| -------- | --------------------------------------------------------------------- |
| Surfaces | `background`, `surface`, `elevated`, `canvas`, `canvas-dot`           |
| Text     | `text`, `muted`, `subtle`, `on-primary`                               |
| Brand    | `primary`, `primary-hover`, `neon`, `lavender`                        |
| Status   | `success`, `warning` (attention), `danger`, `info`, each with `-soft` |
| Lines    | `border`, `border-strong`, `edge` (canvas links), `edge-attention`    |
| Type     | `font-sans` (Inter), `font-mono` (JetBrains Mono, then system mono)   |
| Scale    | `space-1..6`, `radius-control`, `radius-panel`, `motion-fast`         |

Status semantics are fixed across all screens:

| Status             | Icon         | Color token | Label key                 |
| ------------------ | ------------ | ----------- | ------------------------- |
| `running`          | spinner ring | `neon`      | `status.running`          |
| `waiting_for_user` | `?` circle   | `warning`   | `status.waiting_for_user` |
| `completed`        | check        | `success`   | `status.completed`        |
| `failed`           | x circle     | `danger`    | `status.failed`           |
| `interrupted`      | pause        | `muted`     | `status.interrupted`      |
| `unknown`          | empty circle | `subtle`    | `status.unknown`          |

Color is never the only signal: every status has icon + text (or `aria-label`).

### 2.2 Typography and density

- UI text 13px base, 12px secondary, 11px meta; headings in working views ≤20px.
  Marketing-size hero headings ("Your agents, in focus.") are not used inside
  working views.
- Identifiers, timings, paths, model ids and activity lines use `font-mono`.
- Icons: lucide-react only, 16px in controls, 14px inline, stroke 1.75.

### 2.3 Copy rules

- One short sentence of explanation per section at most. Long provenance and
  limitation text goes behind an info disclosure (`ⓘ` → popover), not in the body.
- Never show internal vocabulary to users: hashes, generations, epochs, manifests,
  "reviewed selection", "native identity", pane numbers.
- Unavailable data shows `—` with a tooltip explaining why; never `0`.
- Every string through i18next with keys in both `en-US.json` and `pt-BR.json`.

### 2.4 Motion

Animate only real state changes (status transitions, confirmed token deltas, new
activity lines). Respect `prefers-reduced-motion` and the Settings motion toggle.

## 3. Application shell

```
┌ sidebar 240 ─┬ topbar 56 ───────────────────────────────────────────────┐
│ logo         │ Workspace / View breadcrumb     ⌘K search · live · 🔔 · ⚙ │
│ nav          ├──────────────────────────────────────────────────────────┤
│ workspaces   │ view content                                             │
│              │                                                          │
└──────────────┴──────────────────────────────────────────────────────────┘
```

- Sidebar: logo; primary nav (Overview, Studio, Workspaces, Agents, Models,
  Artifacts, Settings); Workspaces list (pinned first, then recent, max 8 visible,
  "Show all" link). Temporary/disposable workspaces (paths under the OS temp
  directory) are hidden by default behind a "Show temporary" filter.
- Collapsible to a 56px icon rail; persisted locally.
- Topbar: breadcrumb, command palette trigger (`⌘K`), connection state (Live /
  Reconnecting / Offline), notifications bell with unread count, language.
- Narrow (<720px): sidebar becomes a drawer; topbar keeps breadcrumb + menu.

## 4. Screens

Each screen lists: purpose, layout, data source, states, and current gaps.

### 4.1 Overview — command center

Purpose: in seconds, what is running, what needs me, what finished, what it costs.

Layout: compact KPI strip (4 tiles), Attention Center, sessions table.

Data: Bridge `/api/sessions`, `/api/attention`, live `/ws`.

Rules:

- "Running" counts only sessions whose latest observation is recent (within the
  stale threshold). Older `running` sessions count as **stale**, shown separately.
  A last-known `running` never proves the process is alive.
- Attention Center lists `waiting_for_user` and `failed` with one-click open.

States: loading skeleton, empty (no observations yet → Observation guide link),
offline banner, stale banner.

Gaps (2026-11-05 audit): KPI shows 377 "Running" from latest status without a
stale split; hero heading too large; Attention Center not prominent.

### 4.2 Studio — terminals

The Studio is the primary working surface. It has three modes, switchable from the
Feature header and remembered per Feature:

1. **Canvas** (default in native Desktop, owner decision 2026-11-05): the Feature
   canvas from the amendment. Dotted background, metadata groups as framed
   columns, agent summary cards, evidenced links, floating toolbar (select, pan,
   add, zoom −/%/+, fit), minimap bottom-left.
2. **Grid** (V6 docked split): real PTY terminals side by side, resize, swap,
   minimize, maximize.
3. **Focus**: one maximized terminal.

Agent card anatomy:

```
┌ ◌ <title>                                   ┐  status icon + display name
│ 0:22  <activity label>                      │  up to 3 latest evidenced
│ 0:39  <activity label>                      │  activity lines (mono, relative)
│ 8:06  <activity label>                      │
├ ✳ <provider> <selected model>   for 8:06    ┘  provider icon, model, PTY time
```

Data per card (from the native facade snapshot + `canvas` entries):

| Field         | Source                                                            | When missing               |
| ------------- | ----------------------------------------------------------------- | -------------------------- |
| Title         | Feature slot display name, else `T-00n`                           | never missing              |
| Provider      | `slots[].provider`                                                | never missing              |
| Model         | `slots[].selectedModel` (string = selected, `null` = CLI default) | absent → `—`               |
| Time          | `canvas.entries[].startedAt` / `exitedAt`                         | `state: unknown` → `—`     |
| Process state | `canvas.entries[].state` (PTY, not agent turn)                    | `unknown`                  |
| Activity      | canonical terminal↔session binding (pending, pane-817)            | "No activity evidence yet" |
| Links         | Core journal delegation records                                   | no line                    |

The card must never look "broken" when data is missing: show provider + model +
time, which are known for every owned terminal, and a single muted activity line.

Interaction: click/Enter on a card opens its real terminal in Focus; `Esc` or the
Canvas button returns. Card menu: Rename, Minimize, Focus, Open in grid. Hide,
Stop task and Terminate are separate commands with confirmation for termination.

Browser host: Studio shows a short "Open ORQST Desktop to run terminals" empty
state with a single primary button/explanation, not the legacy A/B pair copy.

Gaps (2026-11-05 audit): legacy Codex+OpenCode A/B preparation copy in the
browser; canvas CSS uses ~54 hex literals instead of tokens; canvas palette
(neutral grey) differs from the rest of the app (navy/purple); cards show
"Model unavailable" although the selected model is now available.

### 4.3 Workspaces

Grid/list of observed projects: name, path (truncated middle), sessions, needs
attention, last activity, pin. Actions: Open sessions, Models. Temp workspaces
hidden by default. Gaps: path wraps mid-word; disclaimer paragraph above grid.

### 4.4 Agents & integrations

Per CLI (Codex, Claude Code, OpenCode): two clearly separated capability columns,
**Observe** and **Managed terminal**. Managed terminal reflects the native terminal
integration that exists for all three CLIs (detected binary, version when known,
models from the native catalog) when running in Desktop; in the browser it shows
"Available in ORQST Desktop".

Gaps: matrix still says Claude Code / OpenCode "Planned" and shows `0` sessions
as numbers instead of `—`; column headers misaligned with values.

### 4.5 Models & analytics

Filters (period, agent, adapter, model), ranking by reported total tokens,
comparison, evolution, export. Coverage warnings collapse to one line with `ⓘ`.
Gaps: four stacked warning/explanation blocks before any data; export block shown
before results.

### 4.6 Artifacts

Split: searchable source list left, preview right. Markdown rendered safely
(sanitized, no remote images) with a Raw toggle. Gaps: list shows raw Markdown
(`**bold**`) in mono as full-width cards; no split layout.

### 4.7 Settings

Grouped tabs: General, Appearance, Notifications, Terminals, Privacy & storage,
Advanced. Each control one line of help at most. Gaps: help text under every
control; no Terminals group.

### 4.8 Notifications

Bell popover with unread list and "Open" deep links; full center reachable from
the popover. Deduplicated; never "completed" from inactivity.

### 4.9 Orchestration, Kanban, Onboarding

Not separate screens yet. Orchestration is represented by evidenced canvas links
only. Kanban requires task entities (planned). Onboarding = Observation guide.
These appear in navigation only when implemented; no placeholder screens.

## 5. Accessibility

Keyboard reachability for every control; visible focus ring (`neon` 2px); modal
focus trap and return; `aria-live` polite for status changes; contrast 4.5:1 for
text, 3:1 for controls in both themes.

## 6. Responsive

Verified widths: 1440, 1280, 720, 390, 320. No horizontal page scroll; tables
scroll inside their container; Studio below 720px shows one terminal or the
canvas fitted.

## 7. Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, browser suites (`pnpm test:browser`).
- Renderer-only captures for each screen at 1440×900 and 390×844 in EN and PT.
- Native acceptance by the owner on the packaged app; renderer captures never
  replace native acceptance.

## 8. Audit findings and correction plan (2026-11-05)

| #   | Finding                                                           | Screen    | Fix                                        |
| --- | ----------------------------------------------------------------- | --------- | ------------------------------------------ |
| F1  | Excessive explanatory prose; 109 strings over 160 chars           | all       | Shorten; move details to `ⓘ` disclosures   |
| F2  | Two visual languages (navy/purple vs neutral canvas)              | Studio    | Tokenize canvas; one palette (decision D1) |
| F3  | Canvas CSS has hex literals                                       | Studio    | Replace with tokens                        |
| F4  | Cards show model unavailable although facade provides it          | Studio    | Wire `selectedModel`, `startedAt`, `state` |
| F5  | Browser Studio shows legacy A/B pair flow                         | Studio    | Replace with Desktop empty state           |
| F6  | "Running 377" from last-known status                              | Overview  | Split running vs stale                     |
| F7  | Agents matrix outdated (Claude/OpenCode "Planned") and misaligned | Agents    | Observe vs Managed columns                 |
| F8  | Artifacts render raw Markdown in full-width cards                 | Artifacts | Split list/preview, safe render            |
| F9  | Temp workspaces flood the sidebar                                 | Shell     | Hide temp paths by default                 |
| F10 | Marketing-size headings in working views                          | all       | Compact page header                        |
| F11 | Models: warnings before data                                      | Models    | Collapse warnings, results first           |
| F12 | Status matrix in ui-ux-specification.md stale                     | docs      | Updated by this document                   |

## 9. Owner decisions

- 2026-11-05: pane-768 owns the frontend and implements it directly.
- 2026-11-05: Feature canvas reference adopted (see amendment).
- 2026-11-05: Studio terminal layout reviewed by the owner in the synthetic preview
  ("ficando perfeito"); terminals first, the rest of the frontend after approval.
- 2026-11-05: account switching = suggest with one click, never automatic.
- 2026-11-05: the new Studio is the default terminal view; the summary Canvas opens
  only on request (supersedes D2).
- D1 (pending): single visual palette for the whole app.

## 10. Delivery log and pending work

Kept current with every frontend delivery. "Synthetic" means renderer checks with
labelled fixtures; "native" means the packaged app. Nothing below is owner-accepted
on the native app unless stated.

### Done (branch `feat/frontend-768`)

| Item                                                                                                                                                            | Where                                                     | Verified                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Consolidated frontend specification                                                                                                                             | this file                                                 | review                                                                          |
| Arrangement model: mosaic (balanced grid, size spans, resizable tracks), columns, rows, focus, list, free (move/resize from every edge)                         | `terminal-arrangement.ts`                                 | `tests/terminal-arrangement.test.ts`                                            |
| Studio component: minimize/dock, maximize, drag reorder, pin, full screen, workspace filter, working bar, completion notices, orchestrator label, header badges | `TerminalStudio.tsx`, `terminal-studio.css`               | synthetic captures EN/PT 1440/390                                               |
| Communication effects per mode (arc, side lane, focus switcher), delivery shown separately from completion                                                      | `TerminalStudio.tsx`                                      | synthetic                                                                       |
| New terminal dialog: count, presets, per-terminal CLI/model/name, workspaces, accounts, orchestrator                                                            | `NewTerminalDialog.tsx`                                   | synthetic                                                                       |
| Mention composer with exact `@T-nnn` resolution and autocomplete                                                                                                | `MentionComposer.tsx`                                     | `tests/mention-composer.test.ts`                                                |
| Pane ⋯ menu, terminal details, account limit suggestion                                                                                                         | `PaneMenu.tsx`, `TerminalDetails.tsx`                     | synthetic                                                                       |
| Development preview page                                                                                                                                        | `preview/terminals.html`                                  | dev server only                                                                 |
| Native feature workspace renders the Studio and sends PTY hole rectangles through `arrange`; views hide under overlays                                          | `FeatureWorkspace.tsx`, `studio-native.ts`                | `tests/studio-native.test.ts` (synthetic host)                                  |
| Main-window Terminals / Studio shows the Studio; each card opens the real terminal                                                                              | `FeatureWorkspace.tsx`                                    | synthetic capture                                                               |
| Guided creation uses the real native catalog and `create-selected` (one request per CLI+model group)                                                            | `NativeTerminalCreator.tsx`, `native-terminal-catalog.ts` | `tests/native-terminal-creator.test.ts`, `tests/feature-preparation-ui.test.ts` |
| Evidenced Claude turn state (running/completed/failed) and last tool name                                                                                       | `studio-native.ts`                                        | synthetic                                                                       |
| Orchestrator label saved in the Feature                                                                                                                         | `FeatureWorkspace.tsx`                                    | synthetic                                                                       |

| Shell v2: sidebar search/new session, Needs you / Running (recent activity only) / Recent, temporary workspaces hidden, status bar, compact headings | `App.tsx`, `shell-sections.ts`, `shell-v2.css` | `tests/shell-sections.test.ts`, browser captures |
| Overview: running split from sessions without recent activity, compact KPI strip | `App.tsx` | browser captures |
| Browser Studio: one honest Desktop-only state | `Studio.tsx` | browser capture |
| Agents: per-CLI cards separating Observe from Managed terminal; `—` instead of `0` | `Agents.tsx` | browser capture |
| Models: filter help, coverage and export collapsed behind one-line summaries | `ModelAnalytics.tsx` | browser capture |
| Artifacts: two-column cards with a short readable excerpt | `shell-v2.css` | browser capture |
| Workspaces/Settings: one-line paths, quieter help text | `shell-v2.css` | browser capture |

Full suite at the latest commit: `pnpm lint`, `pnpm typecheck`, `pnpm test` 1414/1414.

### Terminal module review — 2026-11-06 (pane-768 + pane-824)

Read-only audits by pane-824 (handoffs h-1ak, h-1an, h-1ao, h-1ap, h-1aq, h-1ar) and fixes by
pane-768. All fixes have unit/renderer tests; none is owner-accepted on the native app yet.

| Fix                                                                                                                                                                                             | Commit                          | Verified                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------ |
| CLI never started in Studio: layout hides dropped the one-use opening intent; intent now follows the same document, new view focused once, pre-host refusals restore it, delayed canvas restore | `fc952cd`, `3efac75`, `2d68bec` | Rust tests (`hide_document`), review h-1ar |
| Arrange/dock resend loop removed; bounded backoff after refusals; viewport at send time                                                                                                         | `5a6ece6`, `3872f96`            | TS tests                                   |
| Drag keeps the last native rect (no revoke); layout per Feature; creator re-reads snapshot                                                                                                      | `5a6ece6`, `3872f96`            | TS tests                                   |
| Studio PTY body like the preview (12px, card tone); routine controls compact, failure states keep controls and reasons; no full screen for native cards                                         | `2e38895`, `3872f96`            | TS tests                                   |
| Quit: retirement wait 35 s (was 8 s, left the host fenced); immediate "Closing the owned terminals…" banner                                                                                     | `61d898b`, `1de27ee`            | Rust tests                                 |

### Pending

| Item                                                                                                                                                                                                               | Owner    | Blocked by                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------- |
| Owner native acceptance of the Studio (layouts, focus, keyboard, drag, Quit)                                                                                                                                       | owner    | new package                                        |
| MCP pair delegation/result projection: audited facade + Rust guards packaged in `d840e3c`                                                                                                                          | pane-817 | native/provider exchange and UI acceptance         |
| Studio v2 chrome: owned PTY focus/trailing frame packaged `3948fb6`                                                                                                                                                | pane-817 | owner native test                                  |
| Native OS notifications on completed/failed: packaged in `d840e3c`; native acceptance pending                                                                                                                      | pane-817 | owner OS/provider test                             |
| Claude "needs you": hook review fixes packaged in `d840e3c`; native acceptance pending                                                                                                                             | pane-817 | owner provider/OS test                             |
| Studio membership/chrome: native fence notifications packaged in `d840e3c`                                                                                                                                         | pane-817 | empty-Feature/header native acceptance             |
| Studio Open gesture: redundant dialogs removed; packaged `3948fb6`                                                                                                                                                 | pane-817 | native/provider acceptance                         |
| Native Stop/Retire/Quit review and proved exit: packaged `3948fb6`                                                                                                                                                 | pane-817 | native/provider acceptance                         |
| Codex/OpenCode session binding and turn state                                                                                                                                                                      | pane-817 | no proven identity yet                             |
| Current-workspace batch: exact admission reasons in source; pool 8                                                                                                                                                 | pane-817 | native/provider acceptance                         |
| Batch create across several workspaces                                                                                                                                                                             | pane-817 | multi-workspace design review (owner + pane-769)   |
| Mentions v1: recorded and answered unsupported/denied (no delivery route); communication events from the MCP pair journal                                                                                          | pane-768 | v2 authorized route design                         |
| Account limits: default Codex evidence and refresh/lock wired; native acceptance pending                                                                                                                           | pane-817 | native test; other profile/provider sources        |
| Account profiles per CLI, limit evidence, migrate/duplicate, copy conversation, token snapshot                                                                                                                     | pane-817 | steps 7–8                                          |
| Detach to a new window                                                                                                                                                                                             | pane-817 | native support                                     |
| Orchestrator choice inside the creation dialog (native)                                                                                                                                                            | pane-768 | terminal IDs returned by creation                  |
| Links drawn over native terminals are visible only in gaps                                                                                                                                                         | pane-768 | native views sit above the chrome                  |
| Rest of the frontend (Overview, Workspaces, Agents, Models, Artifacts, Settings) — audit items F1–F12                                                                                                              | pane-768 | owner release after terminal approval              |
| Preview parity still open: toolbar/dock heights fixed by the native chrome contract (36/34 vs ~47/38); overlays hide every PTY instead of only covered ones; pane ⋯ menu has no live actions; workspaces scope bar | pane-768 | chrome contract change; native overlay geometry    |
| MCP: Claude unreachable for MCP (pair schema codex/opencode only; pin 2.1.178 vs installed 2.1.318); batch terminals have no MCP; relay stops on any notification and lists tools without a grant                  | pane-768 | owner decision on MCP v2 (N endpoints, Claude pin) |
| Freezes still open: uncertain enrollment keeps creation fenced until restart (by design); native sheets have no timeout; blocking pipe writes under the terminal mutex (plausible)                                 | pane-768 | design review                                      |
