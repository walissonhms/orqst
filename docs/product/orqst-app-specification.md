# ORQST application specification — screens, actions and modules

**Status:** normative implementation instruction, written 2026-11-18 after the owner's
review of the diag25 Preview. Every worker that changes UI, terminals, orchestration
or alerts must read this document first, then the approved V6 HTML
([`ORQST_workspace_v6_features.html`](../design/v6/source/ORQST_workspace_v6_features.html)).

**Precedence:** owner decisions > this document > the V6 HTML (geometry and look) >
the five V6 Markdown sources (detail) > older documents. This document does not
replace the V6 package; it turns it into one concrete product with no open
interpretation. Where it marks something **Planned**, the UI must not show it.

---

## 0. What went wrong in diag25 and what this document fixes

The owner tested diag25 (`c9f15ee`) and reported: “everything is buggy, terminals
take long to open, many terminals show as unavailable, the old menu is still there,
the screens have no continuity”.

Root causes visible in the code base, which this specification eliminates:

| Problem                                   | Cause in code                                                                                                                                                                                                                                                                    | Rule that fixes it                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Screens “do not continue” into each other | Several competing Studio surfaces with their own chrome: `Studio.tsx`, `StudioWorkspace.tsx`, `TerminalStudio.tsx`, `FeatureWorkspace.tsx`, `FeatureCanvas.tsx`, `TauriStudioPreparation.tsx`, `StructuredAgents.tsx`, plus native documents in `apps/desktop/src/*-document.ts` | §2: one window, one shell, one Studio             |
| Old menu still visible                    | Old route chrome (`shell.css`, `shell-v2.css`) still mounted for some routes                                                                                                                                                                                                     | §3: one sidebar, everywhere                       |
| “Indisponível” everywhere                 | The word is used for at least six different facts (CLI missing, model missing, dead restored terminal, blocked pilot, stale metric, offline Bridge)                                                                                                                              | §6: exact state vocabulary                        |
| Slow terminal opening                     | Serial catalog/review/commit round trips before a card appears                                                                                                                                                                                                                   | §9: performance budgets, card appears immediately |
| UI reads as a legal document              | Long provenance disclaimers inline in every view                                                                                                                                                                                                                                 | §10: microcopy rules                              |

---

## 1. Product principles (non-negotiable)

1. **One coherent app.** One window, one sidebar, one header row, one Studio. Moving
   between screens never changes the frame around them.
2. **Terminals are the product.** The Studio opens first, shows real CLI terminals
   immediately and stays fast with 1, 4 or 12 terminals.
3. **Truthful, but short.** Never fabricate state. Say unknown things in 2–6 words
   with a tooltip or “Detalhes” for the long explanation.
4. **No dead cards.** A terminal that cannot run is never left in the grid as a grey
   “unavailable” box. It is either starting, running, waiting, failed with a reason
   and a button, or ended and moved out of the grid (§6).
5. **Context switch changes only the view.** Switching Feature or Workspace never
   stops, restarts or duplicates Core-owned processes.
6. **ORQST talks to ORQST without prompts.** Terminal-to-terminal messages inside a
   Feature never trigger a CLI “Allow” dialog for ORQST's own relay tools.
7. **Everything inside a Feature.** Every terminal belongs to a Feature. A Workspace
   always has a default Feature named “Geral” / “General”.
8. **Match the approved HTML.** Geometry, density, colors and order of controls
   follow V6. Do not redesign; do not copy its simulated data.

---

## 2. Window and module architecture

### 2.1 One window

- The Tauri app has **one main window** hosting the React dashboard shell.
- The terminal body inside each card is the only native/embedded element (xterm bound
  to the signed native PTY broker). The card chrome (header, menu, buttons) is React,
  rendered by the shell, never by a separate native document.
- No separate product windows for Feature workspace, structured agents, terminal
  preparation or terminal lab. Developer-only surfaces (`terminal-lab`, diagnostics)
  stay behind explicit developer flags and never appear in the owner's Preview.

### 2.2 Module consolidation (mandatory before new UI work)

| Keep as the single owner                                     | Merge into it, then delete the duplicate                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `AppShell` (from `App.tsx`): sidebar + header + route outlet | Old chrome in `shell.css`, `shell-v2.css` and any per-route header                                                   |
| `FeatureStudio` (one component, from `FeatureWorkspace.tsx`) | `Studio.tsx`, `StudioWorkspace.tsx`, `TerminalStudio.tsx`, `FeatureCanvas.tsx`, `FeatureCanvasSummary.tsx`           |
| `PaneCard` + `PaneMenu`                                      | Pane header/menu code inside `terminal-document.ts`, `managed-terminal.ts`, `managed-agents-document.ts`             |
| `NewTerminalDialog` (one form for create and edit)           | `NativeTerminalCreator.tsx`, `TauriStudioPreparation.tsx` as user-facing screens; keep their logic as hooks/services |
| `CommunicationInspector`                                     | `MentionComposer.tsx` stays as its input; `StructuredAgents.tsx` UI is removed while the structured pilot is blocked |

Rules for the consolidation:

- First list each file's live callers (`rg`) and its tests. Move behavior, keep tests,
  then delete the dead component in the same branch. Never delete Core/native
  authority code (broker, fences, leases, journal); only UI duplicates.
- The Core, native broker, catalog and journal contracts do not change for this
  consolidation.

### 2.3 Navigation map

```text
Main window
├── Sidebar (155 px, always)
│   ├── WORKSPACES list  (+ Novo Workspace)
│   ├── FEATURES list of the selected Workspace  (+ Nova Feature)
│   └── Footer: global route icons · CORE ONLINE status
└── Content
    ├── Studio            (default route; the selected Feature)
    ├── Visão geral       (Overview / attention center)
    ├── Comunicação       (Communication Inspector)
    ├── Métricas          (usage, models, limits)
    ├── Artefatos         (Markdown deliverables)
    ├── Notificações      (drawer, not a page)
    └── Configurações     (settings tabs; includes Agentes/CLIs)
```

**Not in navigation (Planned, hidden):** Kanban, workflow graph, intelligent router,
Cloud, browser use. Agents/CLI discovery lives in Configurações › Agentes, not as a
top-level route. Do not show “Planned” placeholders in the sidebar.

---

## 3. App shell

### 3.1 Geometry (from the approved HTML)

| Element                      | Value                                              |
| ---------------------------- | -------------------------------------------------- |
| Sidebar width                | 155 px (46 px icon rail below 720 px window width) |
| Brand row                    | 44 px, `ORQST` wordmark + ORQST logo mark          |
| Header row (content)         | 45 px, single row, no second toolbar               |
| Studio stage inset / gap     | 4 px / 5 px divider                                |
| Pane header                  | 31 px                                              |
| Minimized dock (Studio only) | 33 px                                              |
| Base font                    | 12 px Inter; terminal 11 px monospace              |

Colors use the existing tokens in `tokens.css`, aligned with the HTML values:
`--bg #07080c`, `--panel #090b10`, `--line #262334`, `--muted #818095`,
`--text #dedde9`, `--purple #a17bff`, `--green #63d9a6`. Cards have square corners
(radius 0); buttons 5 px; menus and dialogs 8–10 px.

### 3.2 Sidebar

- **WORKSPACES**: one row per Workspace: `▣ Name   N` (N = Feature count). Selected row
  uses the active style (background `#211b32`, 2 px purple left border).
  `+ Novo Workspace` opens the Workspace dialog (§5.6).
- **FEATURES** heading with a `+` on the right. One row per Feature of the selected
  Workspace: `◇ Name   N` (N = open terminals in that Feature, counted from Core
  evidence). Tooltip = description. `+ Nova Feature` opens the Feature dialog.
- Right-click / `⋯` on a Feature row: Renomear, Duplicar configuração, Arquivar,
  Remover (with confirmation; §5.6).
- **Footer**: a row of 16 px icons with tooltips — Visão geral, Comunicação,
  Métricas, Artefatos, Notificações (with unread badge), Configurações, Buscar (⌘K).
  Below them `● CORE ONLINE` (green), `● CONECTANDO…` (amber) or `● CORE OFFLINE`
  (red, with “Reconectar”).
- The sidebar is identical on every route. Clicking a Feature from any route returns
  to the Studio of that Feature.

### 3.3 Header row

Left: `◈  Workspace / Feature` breadcrumb (bold) + `·` + current route name in muted
text (Studio shows the Feature status: `ativa`, `planejada`, `bloqueada`).

Right, on the Studio route, exactly in this order:

`▦ Grade` · `↺ Restaurar` · `↗ Delegar` · `＋ Terminal` (primary)

Then, separated by a 1 px divider: account limits chip (§8.3) and the language is
**not** here (it lives in Configurações › Geral).

On other routes the right side holds that route's own actions (filters, refresh) in
the same button style. Never show a second toolbar row.

### 3.4 Command palette (⌘K)

Searches Workspaces, Features, terminals (by `T-###`, name, `@alias`, CLI, model) and
actions (“Novo terminal”, “Delegar”, “Ir para Métricas”). Enter navigates or runs the
action through the same code path as its button.

### 3.5 Global states

- Core offline: a 28 px banner under the header — “Core desconectado · Reconectando…
  [Tentar agora]”. Terminal cards keep their last frame and show “desconectado”.
- Loading: skeletons only during genuine loading, max 300 ms before showing them.
- Errors: inline, next to the control that failed, with one action.

---

## 4. Studio (route `/studio`, default)

The Studio is the Feature workspace from the approved HTML. It shows **only**
the selected Feature's terminals.

### 4.1 Stage layouts

- **Grade** (default): 2 × 2 docked grid with draggable vertical and horizontal
  dividers (20–80 % clamp). With more than 4 docked terminals the grid grows
  (3 × 2, 3 × 3, …) and scrolls; it never shrinks a card below 320 × 180 px.
- `▦ Grade` toggles between Grade and Colunas (one row of columns). The pane menu
  offers the full layout list (Mosaico, Colunas, Linhas, Foco) under “Layout”.
- `↺ Restaurar` un-maximizes, un-floats, un-minimizes all and returns to Grade.
- Empty slot: dashed border, text `＋ Espaço livre`; click opens the New Terminal
  dialog targeting that slot.
- Empty Feature (no terminals): one centered call to action
  “Nenhum terminal nesta Feature · [＋ Terminal]”.
- Layout (mode, divider ratios, slot order, floating rects, minimized set, focus)
  persists **per Feature** in SQLite and restores on return and on app restart.

### 4.2 Pane card

```text
┌───────────────────────────────────────────────────────────────┐
│ ● Codex  ★ PILOTO  T-001  Orquestrador  gpt-6.2  12.4k  − □ ⋯ × │  31 px
├───────────────────────────────────────────────────────────────┤
│  real xterm output of the CLI                                 │
│  …                                                            │
└───────────────────────────────────────────────────────────────┘
```

Header items, left to right:

1. Status dot (6 px): green running/ready, amber waiting for you, purple pulse when a
   message arrives, red failed, grey ended/unknown. Tooltip gives the state text.
2. CLI name in bold purple (`Codex`, `OpenCode`, `Claude`, `Antigravity`). Never
   “Claude Code” in the UI (owner decision).
3. `★ PILOTO` badge if this terminal is the Feature orchestrator.
4. Display ID chip `T-001` (stable, never reused).
5. Friendly name (ellipsis). Tooltip: `@alias · model · cwd`.
6. Model (short), then token total when the adapter reports it; `—` otherwise.
7. Buttons: `−` minimize, `□`/`❐` maximize/restore, `⋯` menu, `×` close.

Orchestrator card has a 2 px purple top border. Header is the drag handle for
swap (docked) or move (floating).

Body: the real terminal (xterm + FitAddon, PTY resize on every size change). Click
focuses the terminal and gives it keyboard input. No fake prompt, no input box
drawn by React. While starting, the body shows a 1-line spinner
“Iniciando Codex…” that is replaced by the first PTY frame.

### 4.3 Pane menu `⋯` (exact items and order)

1. `⚙ Configurações / renomear` → edit dialog (§5.1 in edit mode)
2. `★ Definir orquestrador` / `★ Remover orquestrador`
3. `▢ Tornar flutuante` / `▢ Encaixar na grade`
4. `− Minimizar`
5. `□ Maximizar / restaurar`
6. `▣ Duplicar configuração` (new independent terminal, same CLI/model/cwd, name + “2”)
7. `↗ Enviar mensagem…` → Delegate dialog with this terminal as recipient
8. `⟳ Reiniciar` (only this terminal; confirmation if running)
9. `ⓘ Detalhes e logs` → side drawer with UUID, session id, cwd, PID evidence,
   timeline, last error
10. separator, then `⏹ Encerrar processo` (danger; confirmation)

Menu: 215 px wide, background `#201a2d`, border `#4a3c64`, radius 8 px. Closes on
outside click and Escape. Keyboard navigable.

### 4.4 Card actions — exact semantics

| Action                        | Effect on view                                                                                                                                                                       | Effect on process                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Minimize `−`                  | Card goes to the dock                                                                                                                                                                | None                                                               |
| Maximize `□`                  | Card fills the stage (inset 4 px); `❐` restores                                                                                                                                      | None                                                               |
| Float                         | Card leaves the grid; draggable, resizable (min 250 × 160)                                                                                                                           | None                                                               |
| Drag header onto another slot | Swap positions                                                                                                                                                                       | None                                                               |
| Close `×`                     | If the process is running: dialog “Fechar T-002?” with **Ocultar** (keep running, goes to the dock), **Encerrar processo**, Cancelar. If already ended: removes the card immediately | Only “Encerrar processo” stops it                                  |
| Encerrar processo             | Card shows “encerrando…”, then moves to the Ended list (§6.3)                                                                                                                        | Graceful stop, then force after timeout, through the native broker |
| Reiniciar                     | Same card, new session, same ID                                                                                                                                                      | Stop + new launch, only this terminal                              |

Closing a card is final for the view: an ended terminal never reappears in the grid
unless the user chooses “Reabrir”.

### 4.5 Minimized dock (Studio only, 33 px)

`MINIMIZADOS` label, then one button per minimized terminal: `▣ Name ↗` (click
restores to its previous place). Right side: event line
`● N terminais · Feature` or the latest real delegation event
`↗ @orquestrador → @backend · entregue`.

### 4.6 Delegation visuals

When the Core reports a real message between two visible terminals of this Feature,
draw the dashed animated curve from sender to recipient and pulse the recipient
(3 × 0.45 s). Reduced motion: no animation, only the dock event text. Never animate
without a Core event.

---

## 5. Dialogs

All dialogs: width `min(390px, 90vw)`, background `#1d1828`, border `#56466f`,
radius 10 px, title 16 px, labels above inputs, footer right-aligned
`Cancelar` · primary action. Enter submits, Escape cancels. Validation errors inline
under the field.

### 5.1 Novo terminal / Configurações do terminal

Fields, in order:

1. **Nome** — default “Novo agente”.
2. **Alias para menções @** — `[a-z0-9_-]+`, unique within the Feature, default from
   name. Inline error “Alias já utilizado nesta Feature”.
3. **CLI** — select of CLIs from the catalog: Codex, OpenCode, Claude, Antigravity
   (and future ones). Each option shows its availability (§7). A CLI that is not
   installed is shown disabled with “não instalado” and a “Como instalar” link to
   Configurações › Agentes. Never list it as selectable.
4. **Modelo** — select of models reported by that CLI's catalog, plus “Padrão do
   CLI”. Free text only if the adapter supports custom models.
5. **Pasta** — defaults to the Feature folder (or Workspace root). “Alterar…” opens the
   native folder picker.
6. **Orquestrador desta Feature** checkbox (unchecked by default).
7. Collapsed **Avançado**: reasoning/effort, Fast mode, initial task — only the
   options the adapter confirms.

Submit behavior (create):

- The dialog closes immediately; the card appears **immediately** in the target slot
  in state `iniciando`. All catalog/review/commit work happens behind the card.
- If opening fails, the same card shows the failure state with the reason and
  `Tentar novamente` · `Alterar CLI` · `Ver logs` (§6.2). Nothing else in the Studio
  changes. Uncertain attempts are preserved, never repeated automatically.

Edit mode: same form titled “Configurações · Name”. Name, alias and orchestrator
apply immediately. CLI/model/folder changes require a new session: the button
reads “Salvar e reiniciar” and asks for confirmation.

### 5.2 Delegar

Opened by `↗ Delegar` or the pane menu. Fields: **De** (default: the orchestrator or
focused terminal), **Para** (searchable picker: `T-004`, name, `@alias`, CLI, model;
only terminals of this Feature unless the user picks “Outra Feature…”, which needs
permission, §8.1), **Mensagem**. Footer shows the delivery policy in one line:
“Entrega na fila do T-004 quando o turno atual terminar”. After send, the dialog
closes and the dock shows the receipt state.

### 5.3 Nova Feature / Renomear Feature

Name (required), description (optional), status (`ativa` default, `planejada`,
`bloqueada`), folder/worktree (optional, under the Workspace). Create → selects it,
empty Studio with “＋ Terminal”.

### 5.4 Arquivar / Remover Feature

If the Feature has running terminals: list them and offer **Manter em execução e
arquivar** (terminals move to “Geral”), **Encerrar e arquivar**, Cancelar. Remove
requires typing the Feature name. Never delete native CLI history. “Geral” cannot be
removed.

### 5.5 Fechar terminal

See §4.4. Text: “T-002 · Backend está em execução.” Buttons: **Ocultar** (default),
**Encerrar processo** (danger), Cancelar. Checkbox “Não perguntar para Ocultar”.

### 5.6 Novo Workspace

Name + folder picker (required). Creates the Workspace with the “Geral” Feature and
selects it.

---

## 6. Terminal states — exact vocabulary

### 6.1 States shown on cards

| State key          | pt-BR label     | Dot          | Meaning (evidence)                             | Card actions                              |
| ------------------ | --------------- | ------------ | ---------------------------------------------- | ----------------------------------------- |
| `starting`         | Iniciando       | pulsing grey | Open requested, no PTY frame yet               | Cancelar                                  |
| `ready`            | Pronto          | green        | PTY alive, CLI at its prompt                   | —                                         |
| `running`          | Executando      | green        | PTY alive, turn in progress (adapter evidence) | —                                         |
| `waiting_for_user` | Aguardando você | amber        | CLI asked for input/approval                   | Focus                                     |
| `unknown`          | Sem sinal       | grey         | PTY alive but turn state not evidenced         | — (still fully usable)                    |
| `failed`           | Falhou          | red          | Launch or process failure with a reason code   | Tentar novamente · Alterar CLI · Ver logs |
| `disconnected`     | Desconectado    | grey outline | Core or broker link lost                       | Reconectar                                |
| `ended`            | Encerrado       | —            | Process ended (exit evidence)                  | moves to the Ended list                   |

A PTY that is alive and drawing is never labelled “indisponível”. `unknown` turn
state is a tooltip detail, not a card-wide blocker.

### 6.2 Failure reasons (short label + one action)

| Reason                            | Label                                                  | Primary action                             |
| --------------------------------- | ------------------------------------------------------ | ------------------------------------------ |
| CLI not installed                 | “Codex não instalado”                                  | Como instalar                              |
| Not authenticated                 | “Faça login no Codex”                                  | Abrir terminal de login                    |
| Model not in catalog              | “Modelo indisponível”                                  | Alterar modelo                             |
| Catalog changed during open       | “Catálogo mudou”                                       | Tentar novamente (refreshes catalog first) |
| Native authority refused          | “Ação recusada”                                        | Ver logs                                   |
| Process crashed                   | “Processo terminou (código N)”                         | Reiniciar                                  |
| Structured pilot blocked (Claude) | not shown on cards: Claude opens as an interactive PTY | —                                          |

### 6.3 Restored and ended terminals

On app start the Studio reconciles the Feature's saved layout with Core evidence:

- Process still alive (kernel-verified, owned): card restored in place, `ready`/`running`.
- Process gone: **no card in the grid.** The terminal goes to the Feature's
  **Encerrados** list (a collapsible section at the end of the dock:
  `Encerrados (3) ▾`). Each entry: `T-003 Frontend · Claude · encerrado há 2h` with
  **Reabrir** (new session, same name/alias/CLI/model/cwd, same `T-###`) and
  **Remover da Feature** (keeps history and evidence).
- Uncertain ownership: entry in Encerrados with “estado incerto” and **Ver detalhes**;
  release only through the documented kernel checks.

This rule removes the “many terminals unavailable” grid seen in diag25.

---

## 7. CLI support matrix (shown in Configurações › Agentes and in the CLI select)

| CLI                 | Opens as                                | Terminal-to-terminal messages                                                                                                                       | Tokens/limits     | Notes                                                                              |
| ------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| Codex               | Interactive PTY                         | Yes, ORQST relay MCP, auto-approved for ORQST tools only                                                                                            | Yes when reported | Default for new terminals                                                          |
| OpenCode            | Interactive PTY                         | Yes, ORQST relay MCP, auto-approved                                                                                                                 | When reported     | First frame must render (no blank body)                                            |
| Claude              | Interactive PTY with the unmodified CLI | Yes through the relay where the CLI supports MCP                                                                                                    | When reported     | Structured pilot (`claude -p`) blocked by provider terms; never shown as an option |
| Antigravity (`agy`) | Interactive PTY                         | **No** (per-session MCP unavailable) — card shows “sem mensagens ORQST” in Detalhes, and it is excluded from the Delegate “Para” list with a reason | Not reported      | Read-only observer for history                                                     |

Availability per CLI = installed (path + version) + login state when safely knowable

- model list. The catalog is cached and refreshed in the background (§9); the
  “Atualizar” button in Configurações › Agentes forces a refresh.

---

## 8. Communication, permissions and alerts

### 8.1 Messages between terminals

- Inside the CLI: the agent uses the ORQST relay tools (`send`, `list`, `reply`) to
  reach `@alias` in the same Feature. No “Allow” prompt for ORQST tools.
- From the UI: Delegate dialog (§5.2) or `@` mention composer in the Communication
  Inspector.
- Resolution: `@alias` resolves inside the current Feature only. Other Features need
  `@feature/alias` plus a permission granted in Feature › Permissões, and are audited.
- Refusals shown to the user in short text: `sender_unassigned` → “Terminal sem
  Feature: mova para uma Feature”; `unknown_terminal` → “@alias não existe nesta
  Feature”; `not_permitted` → “Sem permissão para @alias”.
- Message states (separate delivery and task): `na fila`, `entregue`,
  `em execução`, `concluída`, `falhou`, `destino encerrado`, `desconhecido`.
  Never “concluída” from PTY text alone.

### 8.2 Communication Inspector (route `/comunicacao`)

Tabs: **Mensagens**, **Fila**, **Delegações**, **Auditoria**. Each row:
`T-001 Codex → T-004 Claude · 14:02 · entregue · em execução`, preview (expand),
actions: Abrir destino, Copiar, Tentar novamente (only for `destino encerrado` /
`falhou`, after identity check). Filters: Feature, terminal, state, time.
Feature › Permissões matrix (from `FeaturePermissions.tsx`) lives as a tab here.

### 8.3 Account limits and costs

Header chip on Studio: per-provider usage the adapter reports, e.g.
`Codex 62 % · 5h` with a popover (window, renewal, source). Missing data shows `—`,
never 0 %. Full view in Métricas › Limites.

### 8.4 Notifications

- Events: task completed (confirmed), failed, waiting for you, message
  delivery failed, recipient ended, limit threshold.
- In-app drawer from the sidebar bell: list with severity icon, `T-###`, Feature,
  time; click → navigates to the Feature and focuses the card. Mark read, clear all.
- macOS native notification for “aguardando você” and “falhou” when the window is
  not focused; click focuses the card.
- Deduplicate; never notify on token updates or stale data.

---

## 9. Performance budgets (acceptance gates)

| Measure                                            | Budget                              |
| -------------------------------------------------- | ----------------------------------- |
| App launch → Studio interactive with saved layout  | ≤ 2 s                               |
| `＋ Terminal` submit → card visible (`iniciando`)  | ≤ 100 ms                            |
| Submit → first PTY frame (Codex, OpenCode, Claude) | ≤ 3 s p95 on the owner's Mac        |
| Feature switch                                     | ≤ 150 ms, no process start/stop     |
| Route switch (Studio ↔ Visão geral)                | ≤ 150 ms, terminals keep scrollback |
| Typing latency in a terminal                       | ≤ 16 ms render                      |

Implementation rules: the CLI/model catalog is probed once at startup and in the
background (TTL 10 min or on demand), never synchronously in the open path; open
requests for different terminals run in parallel; the UI never waits on a network or
process round trip to draw the card. Measure with `native.jsonl` stage timings and
record before/after numbers in each delivery.

---

## 10. Microcopy rules

- Labels ≤ 4 words; status ≤ 3 words; inline notices ≤ 1 line.
- Long provenance and limitation text moves to a `ⓘ` tooltip or the “Detalhes”
  drawer. The main view never shows paragraphs of disclaimers.
- Use “terminal”, “Feature”, “Workspace”, “orquestrador” consistently. CLI names:
  Codex, OpenCode, Claude, Antigravity.
- Every string through i18next with keys in `en-US.json` and `pt-BR.json`.
  Audit existing strings longer than 120 characters in visible UI and shorten them
  (keep the long version as `*.detail` for tooltips).

---

## 11. Other screens

### 11.1 Visão geral (`/visao-geral`)

Header actions: período, Atualizar. Content top-to-bottom:

1. Strip of 5 counters: terminais ativos, aguardando você, falhas, mensagens hoje,
   tokens hoje (`—` when unknown).
2. **Atenção** list (waiting for you, failed, delivery failed) with “Abrir” → Studio
   card.
3. Terminais por Feature: compact table (Feature, T-###, CLI, modelo, estado, última
   atividade). Click → Studio.
4. Atividade recente: real events, grouped by Feature.

Observed (external) sessions appear in a separate collapsed section
“Sessões observadas” — read-only, no actions.

### 11.2 Métricas (`/metricas`)

Tabs: **Uso** (tokens over time, by CLI/model/Feature; input/output/cache with cache
as a subset), **Modelos** (ranking + comparison, existing `ModelAnalytics`),
**Limites** (account limits per provider). Filters in the header row. Unknown is `—`.

### 11.3 Artefatos (`/artefatos`)

Left list (search, Feature filter), right preview with Renderizado / Markdown tabs,
actions Copiar Markdown, Salvar .md, Abrir no editor. Safe Markdown only.

### 11.4 Configurações (`/configuracoes`)

Left tab list: **Geral** (idioma, início), **Aparência** (tema, densidade, fonte do
terminal, animações), **Agentes** (CLI matrix §7 with path, version, login, models,
Atualizar, Como instalar), **Terminais** (pasta padrão, scrollback, confirmar ao
fechar), **Notificações**, **Métricas e limites** (limiares), **Privacidade e dados**,
**Avançado** (logs, diagnóstico, versão). One column of settings, 640 px max width.

### 11.5 Onboarding (first run only)

One screen: detected CLIs with status, choose Workspace folder, “Começar” → Studio of
“Geral” with an empty-state call to action. “Pular” always available.

---

## 12. Acceptance and delivery process

### 12.1 Owner checklist (the definition of done for the Preview)

1. Launch: Studio of the last Feature in ≤ 2 s; same sidebar and header as V6; no old
   menu, no second toolbar.
2. `＋ Terminal` → Codex: card appears at once, first frame ≤ 3 s. Repeat with
   OpenCode, Claude and Antigravity.
3. No grey “indisponível” cards. Ended terminals are under “Encerrados” with Reabrir.
4. In Codex: “peça ao @backend (OpenCode) para dizer oi e me retorne” → the answer
   returns, no Allow prompt, the curve animates, the dock shows the event.
5. Minimize, maximize, float, swap, divider resize, close (Ocultar vs Encerrar).
6. Switch Feature and back: same layout, processes still running, no re-launch.
7. Visão geral, Métricas, Configurações and back: frame never changes; returning to
   Studio keeps scrollback.
8. Notification for “aguardando você” focuses the right card.
9. ⌘Q quits cleanly; next launch restores the layout honestly.

### 12.2 Every delivery that touches UI must include

- Screenshots of the real dashboard at 1440 × 900 and 1280 × 800 next to the V6 HTML
  at the same viewport, for every state it changed. The orchestrator reviews them
  before accepting.
- Before/after timing numbers when it touches the open path.
- `pnpm lint`, `pnpm typecheck`, relevant tests and cargo tests actually run, with
  results; never root `pnpm build`.
- Branch pushed to origin, worktree removed after integration, no merge to `main`
  without owner acceptance.

### 12.3 Implementation lanes (parallel, each with its own branch/worktree)

| Lane                  | Scope                                                                                         | Depends on                                              |
| --------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| L1 Shell              | §2.2 consolidation of shell/route chrome, §3 sidebar/header/palette, §10 microcopy audit      | —                                                       |
| L2 Studio             | §4 single `FeatureStudio`, `PaneCard`, `PaneMenu`, dock, layouts, persistence                 | L1 shell outlet                                         |
| L3 Terminal lifecycle | §5.1 immediate card, §6 state vocabulary, Encerrados list, restore reconciliation, §9 budgets | pane-1000 findings (`fix/diag25-terminal-availability`) |
| L4 Communication      | §8.1–8.2 inspector, refusals copy, delegate dialog, Antigravity exclusion                     | L2 card API                                             |
| L5 Screens            | §11 Visão geral, Métricas, Artefatos, Configurações, onboarding                               | L1                                                      |
| L6 Alerts             | §8.3 limits chip, §8.4 notifications deep-link to cards                                       | L2                                                      |

The orchestrator integrates lanes in the order L1 → L3 → L2 → L4/L5/L6, builds one
Preview, runs the §12.1 checklist itself with screenshots, and only then hands the
Preview to the owner.
