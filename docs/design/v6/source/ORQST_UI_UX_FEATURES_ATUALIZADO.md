# ORQST — Master UI/UX & Frontend Implementation Specification

**Audience:** Codex engineering agent  
**Status:** Approved product design direction; implementation must reflect verified backend capabilities.  
**Design references:** The approved nine-screen ORQST collage and the original mascot/wordmark image, supplied separately. These are visual references, not literal UI data or evidence that features exist.

## 0. Mission and operating rules

Build the official, production-oriented frontend for **ORQST — The Intelligent Command Center for AI Coding Agents**. ORQST is an open-source, local-first developer studio for observing, running, coordinating and optimizing Codex, Claude Code, OpenCode and future CLI agents.

The interface must feel like a **premium native developer tool**: calm, precise, highly configurable, visually distinctive, quick to navigate and excellent with many simultaneous workspaces. Use the approved reference imagery; avoid generic admin templates, crowded dashboards, decorative cards without purpose, fake data in production and excessive gradients.

**Before changing code:** inspect the current repository, README, ROADMAP, ADRs, API contracts, existing dashboard and recent work. Produce a short capability inventory (implemented / partial / planned / unavailable) and avoid duplicating ongoing work. Preserve current working observability, SQLite, WebSocket, sessions, APIs and tests. Reuse the React/Vite/Tailwind/i18next stack and existing components. Do not restructure the backend merely to accommodate visual preferences. Where a backend capability does not exist, implement a truthful empty/disabled state with a documented contract, not a pretend working action.

**Coordination:** if another agent is editing the same repository, use a separate Git branch/worktree and coordinate integration boundaries. Never overwrite concurrent work. Keep commits focused and reversible. Use English for source code, identifiers, documentation and default UI; support pt-BR through translations. No hardcoded user-facing strings.

## 1. Visual DNA: ORQST dark purple

### 1.1 Approved design direction

- **Minimal Dark + Developer Studio + Intelligent Observability**.
- Deep navy/near-black foundations; restrained purple surfaces; bright purple actions and carefully used neon highlights; generous contrast and compact density.
- Flat, crisp panels with subtle borders and occasional restrained glows on active or urgent elements. No full-screen neon gradients or excessive glassmorphism.
- The mascot is a brand signature, not a constant distraction. Its expressive eyes communicate agent state only where useful.
- Design for sustained developer use: legibility, fast scanning, keyboard operation, resizable panes and reduced motion.

### 1.2 Design tokens (initial palette)

| Token | HEX | Intended use |
|---|---|---|
| `--orqst-bg` | `#080B1E` | Main application canvas |
| `--orqst-surface` | `#141329` | Sidebar, panels, cards |
| `--orqst-elevated` | `#241A3E` | Dialogs, popovers, hover elevation |
| `--orqst-primary` | `#8424E8` | Primary actions, selected states |
| `--orqst-neon` | `#B45CFF` | Live/active indicators, focused highlights |
| `--orqst-lavender` | `#D9C9FF` | Secondary accent and chart palette |
| `--orqst-text` | `#F5F3FF` | Primary text |
| `--orqst-muted` | `#9994B2` | Secondary text |
| `--orqst-success` | `#53D6A0` | Completed/healthy |
| `--orqst-warning` | `#F5B95E` | Attention/approval |
| `--orqst-danger` | `#F17890` | Error/failure |

Treat these as **design starting tokens**, not unchangeable WCAG-compliant values: audit contrast and adjust derived foreground/border/hover colors as necessary. Use a tokenized scale for typography, spacing, radii, elevation, shadows, borders and charts. Avoid inline hardcoded HEX in individual components. Add a coherent light theme only if it does not delay or compromise the official dark theme; dark is the default.

### 1.3 Typography and iconography

- UI: Inter (or existing equivalent); terminals/code/technical metrics: JetBrains Mono (or existing equivalent).
- Compact, consistent typographic hierarchy. Avoid oversized marketing-style headings in the working UI.
- Use one coherent icon set, consistent stroke weights and 16–20 px icons in navigation/controls.
- Prefer semantic status color plus text/icon, not color alone.
- Respect keyboard focus, contrast, zoom, screen readers and reduced-motion preferences.

### 1.4 Motion and mascot

- Motion should signal **real changes**: agent running, completed, error, approval pending, high usage and Fast mode where supported.
- Animate counters only when confirmed usage updates arrive; do not fake live token streaming.
- Optional flame for a user-defined consumption threshold, lightning for a supported Fast setting, subtle success/error transitions and a small eye animation for the mascot.
- Keep effects low-cost and nonblocking; provide a global animation toggle and `prefers-reduced-motion` support. Never use fire as an unconditional indicator of high costs; explain the threshold and metric.
- Prepare reusable mascot assets (original image or properly licensed vector derivatives); never use screenshots as production icons.

## 2. Information architecture and application shell

### 2.1 Primary navigation

Use a persistent collapsible left sidebar with icon-only and expanded modes. Suggested sections:

1. **Overview** — operational command center.
2. **Studio** — integrated terminals and live agent work.
3. **Workspaces** — projects, layouts and sessions.
4. **Agents** — CLI discovery, adapters and model configuration.
5. **Observability** — events, usage, costs, performance and health.
6. **Models & Analytics** — model rankings and comparisons.
7. **Orchestration** — tasks, delegations, agent collaboration and flows.
8. **Kanban** — task states and assignments.
9. **Artifacts** — Markdown and generated deliverables.
10. **Notifications** — attention center and event history.
11. **Settings** — personalization, privacy and integrations.

Group related sections when the sidebar would become too long. Preserve a minimal collapsed state and quick navigation. Provide a command palette (`Cmd/Ctrl+K`) for workspace, agent, session and action search.

### 2.2 Top bar and global affordances

Always show the active workspace and, when a session is selected, provider, agent, model, mode/capabilities, current status and **persistent token indicator**. Place notifications, quick actions and user preferences on the right. Avoid duplicating large summary cards in every view. Show cost only if pricing/billing provenance supports it; distinguish estimated from actual.

### 2.3 Responsive and flexible panes

- Desktop-first, useful at laptop sizes; supports browser and Electron shell.
- Resizable split panes, tabs, maximization, collapsible inspectors and keyboard shortcuts.
- Support two or more projects open at once with clear context boundaries and optional side-by-side layouts.
- Persist panel sizes, open tabs, active workspace, filters and view preferences locally; restore on reopening without claiming to restore dead OS processes after reboot.
- Narrow windows collapse sidebars and inspectors; avoid unusable multi-column compression. On mobile, prioritize monitoring and notifications over terminal-heavy interaction.
- Empty, loading, reconnecting, stale, offline, error and permission-denied states must be designed, not left blank.

## 3. Detailed screen specifications

### 3.1 Overview — Command Center

**Goal:** answer in seconds: what is running, what finished, what failed, what needs my attention, and what is being consumed?

- Compact operational strip: active agents, completed tasks, pending approvals, failures, tokens, estimated spend (only if available).
- A prominent **Attention Center** for approvals, errors and blocked tasks, with one-click navigation to the source session.
- Live activity feed, grouped by workspace, showing event type, provider/model, task, timestamp and reliability of status.
- Agent status list with clear running/idle/waiting/completed/error/stale distinctions; no inference that a last-known `running` status proves the process is alive.
- Small usage sparkline and quick access to Observability; optional mascot greeting only in the overview, not occupying valuable terminal space.
- All widgets are rearrangeable or collapsible; save preferences per user locally.

### 3.2 Studio — Multi-terminal workspace (highest priority)

**Goal:** a professional workspace for simultaneous Codex, Claude Code, OpenCode and shell sessions.

- Terminal tabs with provider/model badges, state, unread/attention indicator and close/rename actions.
- Horizontal and vertical split layouts; drag handles, maximize panel, focus mode, tab reordering and workspace-specific session groups.
- Integrated terminal rendering (evaluate xterm.js or existing equivalent) connected to the real Core/PTy runtime when available. Support keyboard, copy/paste, selection, search, scrollback, resize and clear controls.
- Never fabricate a shell prompt, agent output or execution result in production. Disable Start/Stop/Resume when backend capability is unavailable, with a useful explanation.
- Compact session toolbar: workspace, CLI, model selector, reasoning/Fast options if supported, run state, total tokens, estimated cost and approval badge.
- Optional right inspector tabs: **Activity**, **Tasks**, **Metrics**, **Artifacts**, **Approvals**. Inspector hidden by default on smaller displays.
- One-click navigation from a notification to the relevant terminal, task and event.
- Persist terminal layout and session references. Clarify that closing Electron may leave a separate Core running; process survival, Core crash recovery and reboot recovery have different guarantees.
- Do not assume that an externally launched CLI terminal can be controlled merely because it can be observed.

### 3.3 Workspaces — Project management

- Grid/list toggle with project name, local path, agent count, recent activity, token usage and alerts.
- Create/open/rename/archive workspace; path access through explicit user selection.
- Pinned/recent workspaces, search, sorting, filters and quick resume of the last layout.
- Two projects can remain open simultaneously, with separate terminal tabs and metrics scopes.
- Workspace details: sessions, agents, tasks, artifacts, usage and local settings.
- Avoid indexing or exposing arbitrary user files without permission.

### 3.4 Agents — CLI Discovery & Integrations

- Discovery panel for **Codex CLI**, **Claude Code**, **OpenCode** and extensible future adapters.
- Per CLI: installed/not detected, detected path (where safe), version, observed capabilities, authentication status only if safely knowable, session support, available models and last check.
- Refresh detection and manual path configuration; guided installation/help where missing. Never display tokens, passwords or credential file contents.
- Distinguish **Observe-only** and **Managed** capabilities. Present a capability matrix instead of pretending every CLI supports every feature.
- Agent profiles: name, purpose, preferred CLI/model, default workspace, permissions, resource budget and automation policy.
- Integrations settings for adapters, CLI tools, optional MCP connections and future plugins; show connection health and granted scopes. Connecting a tool never silently grants terminal execution.

### 3.5 Observability — Live and historical metrics

- Dashboard KPIs: total tokens, input/output/cache, active sessions, task outcomes, wall time, token throughput when measured, estimated cost and budget status.
- Charts: time-series usage, tokens by provider, cache breakdown, task duration, failures, spending trend and workspace comparison.
- Filters: today, 7 days, 30 days, custom period, workspace, agent, model, session and managed/external source.
- Drill down from chart point to exact sessions/events where provenance exists.
- Every metric has observed/estimated/unavailable classification, source, unit, time range and last update. Missing usage is **not zero**.
- Cached tokens are not added twice; normalize provider-specific cache semantics. Show actual invoice costs only if known; API token estimates are not subscription bills.
- Predictive cost/time charts are clearly marked experimental with assumptions, ranges and unavailable states where evidence is insufficient.

### 3.6 Models & Analytics — Most used vs most efficient

- Hero summary: most-used model, total tokens, sessions, tasks, estimated cost and usage coverage.
- Ranking by **reported total tokens** (default), switchable to session count, task count, time and estimated spend.
- Compare 2+ models (e.g., DeepSeek vs GPT) by input/output/cache, average tokens per comparable task, task success, latency and cost when supported.
- Bar chart, usage-over-time line chart, provider distribution and per-workspace breakdown.
- Clearly separate **most used** from **most efficient**; fewer total tokens can simply mean fewer tasks.
- Show model identifier, provider, version if available, measurement coverage and unknown-model bucket. Avoid fabricated model attribution.
- Export CSV/Markdown reports with privacy-safe aggregates and filters.

### 3.7 Orchestration — Collaboration and workflow

- Visual workflow board showing source agent → ORQST Orchestrator → destination agent → result, with explicit task states.
- A separate **Agent Collaboration** timeline/chat: structured delegations, sender, recipient, instructions summary, acknowledgments, outputs, errors, timestamps and links to artifacts. This is not a direct terminal-to-terminal text injection.
- Create delegation, choose target agent/model, specify task, limits and permission scope; track progress, cancel when supported and inspect result.
- Support simple list/timeline view first; optional graph view for multi-step dependencies. Avoid making a giant n8n-style canvas the default.
- Visually mark pending approval, timeout, retries, failure and ambiguous state; guard against loops and duplicate execution in the backend.
- Future **Intelligent Agent Router**: explain why an agent was selected, alternative choices, budget/availability constraints and handoff history. Never imply automatic failover preserves a model's hidden memory; show context reconstruction and user approval where needed.
- Features lacking backend support must be explicitly labeled **Planned** or disabled, not shown as successful.

### 3.8 Kanban — Tasks and delivery

- Columns: Backlog, Running, Waiting for Attention, Failed, Completed (customizable only where backend supports it).
- Cards show task title, agent/model, workspace, priority, age, dependencies and status.
- Click to open inspector with event history, artifacts, approvals, execution metrics and related terminal.
- Drag-and-drop only for authorized state transitions; otherwise use read-only boards.
- Provide list view and filters for high task volumes.

### 3.9 Artifacts — Markdown and generated files

- Split layout: searchable artifact list on the left, preview/editor on the right.
- Markdown render, raw Markdown source, syntax highlighting, code copy, **Copy Markdown**, **Copy rendered text**, **Save as .md**, **Open in external editor**.
- Automatic extraction of clear Markdown responses; manual selection/extraction when ambiguous. Do not rewrite or delete native agent histories.
- Associate with workspace, session, task, agent, timestamp and original source reference. Handle unavailable native source honestly.
- Safe Markdown rendering: sanitize HTML, block unsafe URLs and script execution; avoid automatic remote image fetch where privacy matters.
- Save through user-selected location; warn before overwriting; keep edits local and separate from immutable original responses.
- Support future file types through a pluggable viewer contract, without implying they are implemented now.

### 3.10 Notifications — Attention Center

- Notifications for confirmed completion, failure, approval request, user input required, interruption, budget threshold and provider limits when observable.
- Severity, timestamp, workspace, agent/model, task, unread state and direct action to open source.
- In-app notification center with filters, mark read, dismiss, bulk actions and quiet hours.
- Native Electron notifications on macOS first, with tray/menu-bar badge and background Core monitoring where supported; browser notifications only with permission.
- Deduplicate repeat events, do not notify on every token update, and never mistake stale data for completion.
- User preferences per event type and workspace; notification content can be privacy-minimized.

### 3.11 Settings — Power and simplicity

Use tabs or grouped navigation: **General**, **Appearance**, **Agents**, **Models**, **Terminals**, **Notifications**, **Metrics & Budgets**, **Privacy & Storage**, **Integrations**, **Advanced**.

- General: English default, pt-BR translation, time zone, date/time format, startup behavior.
- Appearance: theme, density, font size, terminal font, animations, mascot reactions, reduced motion.
- Agents/models: CLI paths, capabilities, model defaults, reasoning/Fast options if supported, provider connection state.
- Terminal: shell, default layout, scrollback limits, copy/paste behavior and safe-close preferences.
- Notifications: severity, sound, quiet hours, OS permissions and privacy.
- Metrics: preferred units, token visibility, alert thresholds, budget configuration, cost estimation disclaimers.
- Privacy/storage: local SQLite location, cache retention, native-history references, export, deletion with confirmation and data-source coverage.
- Integrations: MCP, adapters and future Cloud connection; scopes and revocation.
- Advanced: logs with redaction, diagnostics, version, update channel and reset options with confirmation.

### 3.12 Onboarding — First-run experience

- Welcome screen with mascot and clear explanation of local-first behavior.
- Detect installed CLIs and versions, report what is available and what needs installation.
- Choose/create workspace, select CLI/model, test only safe read-only capabilities, configure notifications.
- Explain observe-only versus managed sessions, what remains local and what provider requests may leave the machine.
- Offer a quick guided tour and a **Skip for now** path. Avoid mandatory cloud signup.

## 4. Cross-cutting interaction patterns

### 4.1 Model selector

A compact selector lives in the Studio session header and creation flow, not buried only in Settings. Show only models confirmed by the adapter. Allow default per workspace/agent and session override. When changing models mid-session is unsupported, explain the limitation and offer a safe new-session workflow. Fast/reasoning controls only appear when actually supported.

### 4.2 Live Metrics micro-UI

Always-visible, compact token badge with an expandable breakdown. Animate confirmed deltas, show `last updated` when stale and a dash/unavailable state for missing data. High-usage flame thresholds must be user-configured and meaningful; no invented quota percentage or context remaining.

### 4.3 Search and keyboard-first UX

Global command palette; shortcuts for switch workspace, open terminal, new tab, split pane, focus mode, notifications and search. Document shortcuts and ensure no collisions with terminal keystrokes.

### 4.4 Loading and errors

Skeletons only during genuine loading; show reconnect banner for WebSocket loss, explicit offline state, retry affordances, safe permission errors and provenance when metrics are partial. Avoid misleading `0` when data is missing.

### 4.5 Accessibility and performance

Keyboard navigation, focus management, semantic labels, screen reader support, contrast audit, scalable fonts, reduced motion and virtualized long event/terminal lists where needed. Avoid high-frequency React re-renders from token/event streams; batch visual updates while retaining accurate data.

## 4A. Agentic Studio — mandatory pane communication UI extension (2026-11-03)

This section extends and takes precedence over any earlier simplified terminal/orchestration screen description. Read `ORQST_AGENTIC_MODE_SPEC.md` and `ORQST_PANE_COMMUNICATION_SPEC.md` alongside this document. **No Overclock integration is requested.** ORQST owns its pane lifecycle, queue, permissions and orchestration UX. Do not present conceptual capabilities as already implemented.

### 4A.1 Three complementary Studio modes

Provide an always-accessible view switcher (with remembered per-workspace preference):

1. **Focus** — one maximized terminal with narrow context inspector; next/previous pane keyboard navigation.
2. **Split** — 2–6 simultaneously visible interactive PTY terminals, horizontal/vertical nesting, drag resize, swap, detach to tab and restore layout.
3. **Fleet** — scalable compact overview for 6–30+ panes with searchable cards/table, grouping by project, provider, model, state and owner; virtualization where appropriate. Fleet cards summarize state and last verified activity; clicking opens Focus/Split. Do not render dozens of live terminal canvases at once.

Keep a collapsible **Agentic Command Bar** anchored near the top or bottom of Studio. User may type: “Build a React login and Laravel backend; distribute work”, “Send T-004 to review T-002”, “Launch two Codex and four Claude terminals”, or “Close T-006 after it finishes.” Show an editable, inspectable execution plan before privileged/high-impact actions. For low-risk actions, use user-configured automation policies; no silent escalation.

### 4A.2 Pane identity, discoverability and lifecycle

Every pane header must show a **stable, unique, never ambiguously reused visible label** (e.g. `T-001`) plus editable friendly name (e.g. `Backend API`), provider, actual selected model, task, state, ownership and last verified update. A persistent internal UUID is separate from the display ID. Show full UUID in details/copy action, not in every header.

Pane header compact layout: `T-003 · Frontend` | `Claude Code / Sonnet` | `Running` | `18.2k tokens` | queue badge | menu. Model and token metrics are real, not illustrative in production. Provide accessible icon-only buttons with tooltips for Focus, Split, Rename, Send task, Inspect, Hide, Stop task and Close. **Hide**, **Detach**, **Stop task** and **Terminate process** are distinct commands with explicit labels and appropriate confirmation.

Allow manual **New Terminal** with workspace, provider, model, reasoning/fast mode if supported, working directory, display name and optional initial task. Orchestrator may create multiple terminals of the same CLI with different models, constrained by configured concurrency, machine resources and actual provider support. Show ownership `user-managed` / `orchestrator-managed` and whether automatic close is enabled. External observed sessions cannot be taken over or terminated without verified capability and authority.

### 4A.3 Natural-language task planning and distribution

The command bar has an explicit **Plan → Review → Run** interaction: parse requested providers/models and task dependencies; present a task graph or concise ordered list with pane assignments, model, cost/budget assumptions, parallelizable tasks, approvals and isolation strategy. Explicit provider/model requests override defaults. If `Claude Opus` is unavailable, show why and request a choice; never silently substitute.

After launch, show a persistent **Plan Progress** strip: planned / queued / running / blocked / reviewing / completed / failed, plus actual per-pane mapping and an action to inspect or cancel. If parallel agents modify the same repository, show Git worktree/branch isolation and integration conflict indicators; do not claim merges happened unless confirmed.

### 4A.4 Pane-to-pane messages and queue UX

Build a dockable **Communication Inspector** with tabs `Messages`, `Queue`, `Delegations`, `Approvals`, `Audit`. Users can filter by source/destination pane ID, provider, workspace, task/correlation ID, status and time; search by metadata without requiring duplication of native histories.

Each communication entry must show:
- `T-001 Codex → T-004 Claude`, sender/recipient names and models, timestamp, task/correlation ID.
- A short message preview (only when permitted/available), with expandable source and linked artifact/result.
- **Separate delivery and task execution status.** Suggested delivery states: `queued`, `dispatching`, `accepted`, `delivery_failed`, `target_closed`, `unknown`. Suggested task states: `pending`, `running`, `waiting_approval`, `completed`, `failed`, `cancelled`, `unknown`. Do not equate accepted with processed or completed.
- Queue position/age when reliably available, retry eligibility, reason for failure and a clear action to inspect.

When the target is busy, show `Queued for T-004 · waiting for current turn` only if the adapter confirms queue semantics; otherwise show `Delivery not supported while busy` with a safe alternative. When a pane closes before consumption, show `Target closed before processing`; preserve the unsent item and allow **manual retry** after verifying target identity and idempotency. Do not auto-resend actions that might duplicate side effects. Show `Unknown delivery state` after disconnects until reconciled.

Offer **Send to pane…** from each terminal and task, with target picker searchable by `T-004`, friendly name, provider, model and workspace. The destination must be unambiguous; if multiple panes match, ask the user to choose. The composer shows recipient, message, permission scope and queue behavior before sending. Provide copy-message and open-target actions. No direct uncontrolled PTY keystroke injection by default; prefer structured adapter/MCP operations where supported.

### 4A.5 Lifecycle and automation controls

In Fleet and Inspector, support user-authorized actions `Create`, `Rename`, `Focus`, `Send task`, `Stop task`, `Close after completion`, `Close idle`, `Terminate`, `Reopen layout`. Show pending approval, unsaved changes, queued messages, active jobs and native session resumability before terminating. Closing a visual pane does **not** imply killing the CLI. If auto-close is enabled, only close orchestrator-owned panes after confirmed completion, no pending approval/queue and the configured grace period. Provide cancellation of scheduled close and clear audit trail.

### 4A.6 Metrics, notifications and animation

**Token totals remain visible in the global top bar and every pane header.** Display total, input, output, cached, model, measurement provenance and last update; show `—` / `Unavailable` instead of fake zero. Provide per-pane budget warnings and fleet totals with deduplication. A compact purple usage pulse is appropriate; the small flame appears only at a configurable threshold, and lightning only when a provider-supported fast mode is actually active. Respect reduced motion and never obscure terminal text.

Native and in-app notifications must deep-link to the pane/task/message: task complete, failed, needs approval, recipient closed, delivery failed, budget threshold, provider quota when observed. Deduplicate repeat events and allow per-workspace quiet hours. Mascot may react subtly to attention/completion but must not distract from failures.

### 4A.7 Responsive behavior and accessibility

At 1440px and above, support sidebar + Split/Fleet + optional inspector. On narrower windows collapse the inspector to a drawer and keep a single active terminal visible. Persist pane layout locally in SQLite-backed preferences without duplicating full native transcripts. Keyboard: command palette, jump to pane by ID, cycle panes, split, focus, open communication inspector, inspect pending approvals. Every status uses text + icon, not color alone. Full keyboard operation, clear focus, screen-reader labels and reduced-motion support are mandatory.

### 4A.8 UI component contracts and realistic states

Suggested components: `AgenticCommandBar`, `ExecutionPlanReview`, `PaneFleet`, `PaneCard`, `PaneHeader`, `PaneIdentityBadge`, `PaneModelSelector`, `PaneQueueBadge`, `PaneSplitLayout`, `CommunicationInspector`, `MessageDeliveryTimeline`, `DelegationGraph`, `TaskProgressStrip`, `PaneLifecycleDialog`, `ApprovalDrawer`, `FleetUsageSummary`.

Provide authentic loading, empty, error, disconnected, permission-denied, unsupported-capability and stale-data states. No fake terminals, fabricated live token counts or clickable actions that pretend success. If a backend operation is not implemented, mark the UI as planned/disabled and document the required API contract.

### 4A.9 Acceptance scenarios (test with real backend where supported)

1. Open 2 Codex and 4 Claude Code panes with individually chosen supported models; all panes have distinct stable visible IDs and readable names.
2. Reopen the app and recover the layout/identities without falsely claiming that terminated processes survived reboot.
3. Select `T-003`, send a message to `T-005`, observe queue/acceptance and final task result as separate transitions.
4. Send while recipient is busy: queue only if provider confirms; otherwise explain inability without losing the message.
5. Recipient closes before processing: show `target_closed`, preserve provenance, offer safe manual retry, never claim task completed.
6. Type “Build login frontend and backend and distribute tasks”; inspect planned agent/model assignments and launch authorized panes; track progress and approvals.
7. Type “Use Claude Opus for backend”; enforce model availability and explicit-choice precedence.
8. Close a completed orchestrator-owned pane without terminating unrelated panes or losing linked artifacts; distinguish Hide vs Terminate.
9. Filter Fleet and Communication Inspector by pane ID, workspace and state; navigate to original task/result.
10. Confirm real metrics, unknown-value labels, keyboard accessibility, reduced motion and no visual overflow at high pane counts.

### 4A.10 Coordination and release gates

Coordinate with the Core team using versioned typed contracts; do not independently invent executable backend routes. Implement this UI progressively as the corresponding Core/PTY/adapter/MCP features land. Update `ROADMAP.md`, `docs/design/design-system.md`, API contract references, README and CHANGELOG to distinguish implemented, partial and planned. Preserve the approved ORQST dark-purple palette, mascot and all existing observability flows. Add component/integration/E2E tests for key interactions, queue states, identity persistence and dangerous close confirmation.


## 5. Component architecture

Suggested reusable components (adapt to current code): `AppShell`, `Sidebar`, `Topbar`, `CommandPalette`, `WorkspaceSwitcher`, `WorkspaceTabs`, `TerminalPanel`, `TerminalToolbar`, `SplitPane`, `AgentStatus`, `CliDiscoveryCard`, `ModelSelector`, `LiveTokenBadge`, `MetricsPopover`, `UsageChart`, `ModelRanking`, `AttentionCenter`, `NotificationItem`, `ArtifactViewer`, `MarkdownEditor`, `DelegationTimeline`, `OrchestrationGraph`, `KanbanBoard`, `TaskInspector`, `MascotStatus`, `EmptyState`, `ErrorState`, `ConnectionStatus`.

Define typed props and shared state/query boundaries; avoid monolithic components. Keep data adapters separate from presentation and mock fixtures isolated to storybook/tests/development previews. Use existing API/WebSocket contracts; propose versioned extensions where necessary. Never add production endpoints or fake control handlers just to make the UI appear functional.

## 6. Phased implementation and backend dependencies

**Phase A — Audit + design foundation:** inspect existing code and parallel changes, document screen inventory, establish tokens, typography, navigation shell, responsive grid, iconography and i18n; preserve existing routes and data.

**Phase B — Existing-data screens:** improve Overview, Workspaces, Observability and Notifications using actual current Bridge data; introduce clear unavailable/stale states, token badge and charts; add unit/UI tests.

**Phase C — Desktop shell and Studio:** connect to real Electron/Core/PTy once available; build terminal tabs, splits, session toolbar, reconnection and persistence; do not fake interactive terminal functionality.

**Phase D — Product tools:** Agents/CLI Discovery, Model Manager, Models & Analytics, Artifacts, Kanban and settings; use real capability discovery, metrics and native references. Graceful disabled states where backend is pending.

**Phase E — Orchestration UX:** collaboration timeline, delegation forms, workflow view and router explanations once actual orchestration contracts exist.

**Phase F — Polish and release:** mascot animations, fine-grained motion, accessibility, performance, responsive behavior, keyboard shortcuts, packaging checks, screenshot review and user documentation.

The frontend phases may run in parallel with Core development in separate worktrees, but **integration milestones must be gated on real backend contracts and tests**. No arbitrary rewriting of backend architecture.

## 7. Mandatory deliverables

1. `docs/design/design-system.md` with token palette, typography, spacing, component states, accessibility and motion rules.
2. `docs/design/ui-ux-specification.md` or an equivalent existing document linking to the nine-screen approved reference and this specification.
3. Updated `ROADMAP.md` with screen-by-screen delivery and backend dependencies; update `README.md` and `CHANGELOG.md` appropriately.
4. Implemented reusable frontend components and screens, using current code and real available data.
5. Automated tests for navigation, model/agent selection states, metric correctness, unavailable states, notifications, Markdown safety and workspace layout persistence where implemented.
6. Screenshots at representative desktop/laptop widths and a checklist comparing each screen to the approved collage; note intentional differences.
7. A final matrix: **Implemented / Partial / Planned / Blocked** per screen and capability, with exact files and tests.

## 8. Definition of Done / acceptance tests

- Brand matches approved ORQST mascot/logo and purple dark palette; coherent across all screens.
- Layout is clean and configurable, with no unnecessary visual noise; usable on laptop and large desktop.
- Sidebar, navigation, workspace tabs, filters and inspectors behave correctly.
- Session/model controls show only real capabilities and do not imply unsupported changes.
- Tokens remain visible, correctly classified, and never fabricated; cache not double counted.
- Notifications distinguish completed, failed, blocked and attention-needed, with direct links.
- Model ranking supports filters, comparison and honest unknown/partial coverage.
- Artifacts render Markdown safely and support copy/save without accidental overwrites.
- Terminals are genuinely interactive only after PTY/Core support exists; otherwise explicit blocked state.
- Orchestration visualization reflects real tasks; no fake agent-to-agent communication.
- All UI strings are translatable; English and pt-BR work.
- Accessibility, reduced-motion, tests, build and existing observation features remain intact.

## 9. Execution instruction

Implement the approved UI/UX in the existing repository incrementally, beginning with audit and design foundation. Continue through non-destructive, technically unblocked frontend tasks without asking for approval at every minor step. Stop for destructive changes, security/privacy decisions, external charges, credential access, conflicting concurrent work or major architecture changes. Keep documentation and tests synchronized. Report exactly what is functional versus merely designed. **Do not claim the entire ORQST product is complete because the frontend looks complete.**


## Workspace → Feature → Terminais: requisito aprovado (04/11/2026)

**Hierarquia obrigatória:** `Workspace → Feature → TerminalPane → AgentSession`. Um Workspace representa o projeto e sua pasta raiz; cada Workspace possui Features independentes, com nome, descrição, status (`planned`, `active`, `blocked`, `completed`, `archived`), terminais, tarefas, histórico, permissões e layout. **Feature é entidade persistida, não só pasta visual.** A mesma Feature pode possuir N terminais de diferentes CLIs e modelos. O preset A/B não limita a quantidade.

### Regras de identidade e isolamento
- `workspaceId`, `featureId`, `paneId`, `sessionId`, `taskId` são IDs estáveis; não usar títulos como chaves. Cada terminal pertence a uma Feature e um Workspace; o processo é gerenciado pelo Core, não pelo componente React.
- `@backend` é resolvido primeiro no escopo da Feature atual. Para outras Features, exigir referência explícita, por exemplo `@autenticacao/backend` (ou seletor de destino com IDs estáveis). Duplicidades não podem causar envio silencioso ao destinatário errado.
- Por padrão, a comunicação automática ocorre somente dentro da Feature; comunicação entre Features e Workspaces exige autorização explícita, confirmação de destino e trilha de auditoria. O agente não adquire privilégios ao ser marcado como orquestrador.
- Trocar de Feature ou Workspace altera apenas a visão ativa: não encerra processos, tarefas nem mensagens em andamento. Minimizar/ocultar pane não mata sessão. Encerrar processo é operação separada, com confirmação apropriada.
- Layout (`docked`, `floating`, proporções, ordem, panes minimizados, foco) persiste **por Feature**, não globalmente. Cada Feature pode ter seu próprio orquestrador e política de comunicação.
- Features podem ser criadas, renomeadas, duplicadas como configuração, arquivadas e removidas, com política clara de processos ativos, dados e confirmação. Nunca excluir histórico nativo de CLIs ao apagar uma Feature.

### UI V5 — adição sem redesenho
- Sidebar compacta: lista expansível de Workspaces → Features, contadores de terminais e botão `+ Nova Feature` dentro do Workspace selecionado. Mostrar estado e Feature ativa; permitir alternar sem perder o layout.
- Cabeçalho: breadcrumb `Workspace / Feature`, ações `+ Terminal`, `Delegar`, `Organizar` e gerenciamento da Feature.
- Área central: **exatamente a experiência de terminais docked V5 aprovada**, ocupando a área útil, com resize, drag/swap, minimizar, maximizar, menu `⋯`, terminal CLI nativo e animações de mensagens reais.
- Fluxo de criação de Feature: nome, descrição opcional, pasta/worktree opcional sob Workspace, status inicial, modelos/agentes padrão opcionais. Não exigir arquivo de configuração externo.
- Criar terminais no escopo da Feature ativa. O orquestrador pode abrir novos terminais dentro dela mediante autorização; selecionar CLI e modelo individualmente.
- Indicadores e métricas devem permitir filtros por Workspace, Feature, terminal, CLI e modelo. Não somar dados indisponíveis como zero.

### Persistência e eventos
Propor migrações aditivas para `features`, `feature_terminal_assignments` (se necessário), `feature_layouts`, `feature_permissions`, e relações por `featureId` em tarefas/delegações. Ajustar à estrutura SQLite existente, sem duplicar entidades. Criar eventos versionados `feature.created`, `feature.updated`, `feature.activated`, `feature.archived`, `feature.terminal_added`, `feature.terminal_removed`; preservar APIs v1 ou versionar novos contratos. Garantir reconciliação e recuperação sem sessões duplicadas.

### Cenários de aceitação
1. Workspace ORQST possui Features Autenticação (3 terminais), Dashboard (2) e Banco de dados (1); cada uma abre o layout salvo.
2. Alternar Autenticação → Dashboard → Autenticação mantém os processos e recupera o layout, sem reexecutar agentes.
3. Criar `@backend` em duas Features não confunde destinatários; comunicação cruzada sem permissão é bloqueada.
4. Criar Feature e terminais inteiramente pela UI, sem editar JSON externo; erros não travam a seleção.
5. Fechar/arquivar Feature com tarefas ativas apresenta escolhas explícitas e não encerra outras Features.
6. Delegar tarefas dentro da Feature, acompanhar eventos reais e retorno; animações refletem eventos do Core.
7. Atualizar README, ROADMAP, contratos, modelo de dados, documentação UI/UX, testes e CHANGELOG.

**Reuse-first:** antes de implementar qualquer parte acima, verificar Anywh (`https://github.com/anywh-sh/anywh`) e Tucano (`https://github.com/eduwxyz/tucano`) para recursos equivalentes; citar arquivo/commit/licença efetivamente verificados. Overclock (`https://overclock.sh`) é referência de experiência, não fonte presumida de código reutilizável.
