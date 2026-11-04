# ORQST — Agentic Mode: Autonomous Multi-Agent Terminal Orchestration

**Status:** Product specification and implementation directive. Capabilities described here are requirements, not claims of existing implementation.

## Mission

Build a local-first, open-source **ORQST Agentic Mode** that accepts natural-language requests, creates and manages multiple independently identified terminal sessions, selects installed AI CLIs and supported models, delegates tasks, coordinates results, and cleans up temporary sessions safely. ORQST must not depend on Overclock or any third-party terminal orchestration application.

**Example:** “Build a React login screen and Laravel backend; distribute the work among agents.” ORQST interprets the request, prepares a plan, selects compatible agents, opens the required terminals, assigns work, monitors progress, handles reviews and integration, and reports the outcome.

**Explicit targeting:** “Ask Claude Opus to build the backend” overrides the configured default only after verifying that Claude Code and the requested Opus model are available. “Send the tests to T-004” targets that exact terminal; “Close T-006” requests an authorized, safe close.

## 1. Audit first, then implement incrementally

1. Inspect the current repository, ROADMAP, ADRs, API contracts, frontend specification and working Core/Bridge before editing. Identify implemented, partial and missing features.
2. Update `ROADMAP.md`, relevant ADRs, architecture/API documentation and `CHANGELOG.md` to make Agentic Mode an explicit deliverable with dependencies and acceptance criteria.
3. Implement in small compatible phases. Preserve existing observability, local SQLite data, APIs and external-session monitoring. Do not overwrite native CLI histories.
4. Maintain English as the code/documentation/default UI language, with pt-BR localization.
5. Run lint, typecheck, unit/integration tests and builds for each phase. Document limitations and evidence. Do not claim an integration works until verified against the installed CLI/version.
6. Advance through authorized, non-destructive implementation phases without pausing for routine decisions. Ask for approval for destructive changes, unexpected expenses, credentials, permission escalation, security-sensitive policy decisions or irreversible migrations.

## 2. Terminal Manager — multiple independent terminals

- Open **multiple terminals of the same provider simultaneously** (e.g. 2 Codex and 4 Claude Code), with different models and tasks, subject to configurable system resource/concurrency limits.
- Every terminal has an immutable internal UUID and a visible, stable, non-ambiguous ID such as `T-001`, `T-002`, plus a user-editable name (e.g. `Backend API`, `Frontend`, `Reviewer`). Never silently reuse a visible ID within its workspace history.
- Persist workspace ID, terminal ID, provider, requested/actual model, native session ID where available, lifecycle state, task association, ownership (user-created/orchestrator-created/external-observed), creation time and last confirmed activity.
- Provide list, create, rename, attach, detach, focus, split, resize, pause/cancel task when supported, and close operations. Distinguish **hide pane**, **detach UI**, **stop task**, **terminate process**, and **close terminal**.
- Closing Electron must not automatically kill managed processes while the Core remains active. Recovery after Core crash or reboot must be documented honestly; never imply that a previous PTY process survives reboot.
- Do not automatically control or terminate externally observed CLI sessions without an explicit capability and authorization grant.
- Terminal output remains accessible to the user; structured agent-to-agent messages use the Orchestrator rather than blindly typing into another PTY.

## 3. CLI Discovery and Model Manager

- Detect installed Codex, Claude Code and OpenCode CLIs, their executable locations, versions, supported session/command capabilities, and model discovery mechanisms where safely available.
- Validate availability, authentication status when safely observable, model compatibility and provider-specific options; never read, expose or log secret tokens.
- Support configurable defaults per workspace, provider and task role (frontend, backend, review, testing, documentation). Allow a default provider/model for newly spawned terminals.
- An explicit user request for a provider/model takes precedence over defaults. If unsupported, unavailable or ambiguous, ask for clarification/alternative; **never silently substitute another model**.
- Allow per-terminal model selection and record the actual model if reported. A mid-session model switch is only offered if supported; otherwise create a new compatible session with an explicit continuity plan.

## 4. Natural-Language Intent Planner

- Accept free-form instructions in the ORQST Agentic Mode command bar.
- Parse intent into a **typed, inspectable execution plan**: goal, tasks, dependencies, assigned provider/model/terminal, working directory, permissions, expected artifacts, validation, budget, deadlines and cleanup policy.
- Resolve explicit terminal references (`T-004`), aliases and named roles deterministically. Reject ambiguous targets.
- Use deterministic parsing for simple actions (list, focus, rename, close a specified terminal) to avoid unnecessary model calls. Use a user-configured planning model only for genuinely complex decomposition, with its token/cost overhead included in observability.
- Respect instruction precedence: explicit current user request > authorized workspace policies > configured role defaults > system recommendations. Never let agent-generated text grant new permissions.
- Offer **Manual**, **Plan & Approve**, and **Auto within limits** modes. The automatic mode must require explicit opt-in and enforce the same safety policies.

## 5. ORQST Orchestrator and Pane-to-Pane Communication

- Agents communicate bidirectionally via ORQST's structured orchestration layer, not a dependency on Overclock.
- Build versioned task/message envelopes with `taskId`, `parentTaskId`, `correlationId`, source/destination agent and terminal IDs, workspace ID, payload reference, state, attempt, idempotency key, permission scope, deadline, budget, result reference and error details.
- Provide a durable local queue in SQLite and auditable state transitions: planned, queued, running, waiting_for_approval, waiting_for_input, completed, failed, cancelled, interrupted, unknown/reconciling.
- Support task delegation, response delivery, progress updates, result retrieval, cancellation, deadlines, retries with reconciliation, and bounded fan-out/depth. Do not claim exactly-once execution for side-effectful operations.
- Expose a **local ORQST MCP Server** for capable agents, with narrowly scoped tools such as `orqst_list_terminals`, `orqst_create_terminal`, `orqst_delegate_task`, `orqst_get_task_status`, `orqst_get_task_result`, `orqst_request_approval`, `orqst_close_terminal`. Tool names are proposed; validate schema and actual adapter compatibility.
- MCP is an agent-facing control surface; PTY is the terminal I/O surface. Use native CLI APIs/SDKs when better suited and verified. Avoid an unrestricted generic `execute_any_command` MCP tool.
- Enforce workspace boundaries, authorization, approval for sensitive operations, maximum terminal count, resource budgets, cycle prevention and prompt-injection resistance.

## 6. Automatic terminal allocation and lifecycle

For a request requiring multiple roles:

1. Decompose the request into tasks with dependencies and acceptance checks.
2. Choose installed compatible agents/models using explicit instructions first, then user defaults, then policy-based recommendations.
3. Reuse an authorized compatible idle terminal or create a new named/numbered terminal. Show the decision in the UI.
4. Start independent tasks concurrently within CPU/RAM/agent/budget limits; serialize dependent work.
5. Track task execution, agent responses, native usage and failures; notify on completion or when attention is required.
6. Validate outputs, run authorized checks, and integrate results without losing user changes.
7. Close **orchestrator-owned temporary terminals** after confirmed completion only if the user's cleanup policy allows it. Never auto-close user-owned or external sessions; do not close sessions with uncommitted work, pending approvals or unresolved execution without confirmation.
8. Preserve task metadata, terminal identity, artifacts and metrics after cleanup; avoid duplicating entire native histories.

**Example allocation:** `T-001` Codex / backend, `T-002` Claude Code / frontend, `T-003` OpenCode / integration tests. This is illustrative; ORQST must not hardcode these assignments.

## 7. Shared repository safety

- Multiple agents editing one repository must not overwrite each other's changes. Prefer per-task Git worktrees/branches where appropriate, with explicit integration and conflict resolution.
- Enforce workspace-scoped paths, protected files, explicit approvals for destructive commands, and safe handling of untracked/uncommitted files.
- Require a clear review/merge strategy for simultaneous frontend/backend tasks and tests.
- Never interpret arbitrary tool output, Markdown, logs or agent responses as privileged instructions.

## 8. Agentic Mode frontend and UX

Follow the approved ORQST Minimal Dark + Developer Studio design system and purple palette:

- Background `#080B1E`, Surface `#141329`, Elevated `#241A3E`, Primary `#8424E8`, Neon `#B45CFF`, Lavender `#D9C9FF`.
- Provide an Agentic Mode command bar for natural-language requests; optional plan preview and confirmation; task DAG/list; live terminal allocation; drag-resizable pane grid; clearly visible terminal IDs and editable names; per-pane provider/model/status/token counters.
- Include a **Terminal Registry** showing all panes with ID, name, owner, provider, model, workspace, task, status and actions (focus, rename, close).
- Show communication between agents as a readable timeline: sender, receiver, task, delivery status, result, timestamp and related terminal. Clicking an event focuses the relevant pane.
- Keep token usage visible, with honest observed/estimated/unavailable labels, no double-counting cache, and per-agent/model analytics. Display orchestrator/planner overhead separately.
- Notifications for completed, failed, awaiting approval/input, budget reached and provider limit reached (only when detectable). Native notifications when the window is minimized and monitoring remains active.
- Support keyboard shortcuts, reduced motion, responsive layouts, persistence of splits/tabs, and en-US/pt-BR localization.
- Implement genuine backend wiring where available; otherwise show an accurate disabled/coming-soon state rather than a fake success flow.

## 9. Example user commands and acceptance tests

- “Create a React login screen and a Laravel API; distribute work among agents.” → produces an inspectable plan, opens appropriate terminals, tracks dependencies and results, validates changes.
- “Open 2 Codex terminals and 4 Claude Code terminals, each with its own supported model.” → creates six independently identified sessions within configured limits.
- “Ask Claude Opus to create the backend.” → checks the CLI/model, opens or reuses the correct terminal, and sends the task without silently switching models.
- “Send T-004 to review T-001's changes.” → resolves stable IDs and delivers an authorized structured delegation.
- “Close T-006 when its task is finished.” → registers safe cleanup and only terminates an eligible orchestrator-owned session under policy.
- “What is T-003 doing?” → shows last confirmed task/process status and timestamp; does not equate a completed turn with a completed task.
- “Use my default agent for testing.” → applies the configured role default, subject to capability checks.
- “Cancel all temporary terminals for this workspace.” → previews affected sessions and requires confirmation for active/unsafe termination.

Test invalid IDs, unsupported models, unavailable CLIs, stale sessions, crashes, cancellation, duplicate task delivery, loops, concurrent edits, denied permissions, missing usage and lost connection. Add automated tests at contract, adapter, orchestrator and UI levels.

## 10. Delivery and roadmap

Plan and implement progressively, aligned with the existing project roadmap:

- **Foundation:** audit, ADRs, contracts, lifecycle and permission model.
- **Terminal Runtime:** PTY-backed multiple terminals, identity, registry, persistence and lifecycle.
- **Agent Adapters:** verified discovery, execution and session capabilities for Codex, Claude Code and OpenCode.
- **MCP & Orchestration:** scoped tools, durable delegation, message routing, results and approvals.
- **Intent Planner:** natural-language task decomposition, explicit model targeting, defaults and allocation.
- **Autonomous Workflows:** parallel execution, Git isolation, integration, validation and safe cleanup.
- **Observability & UX:** live tokens, status, alerts, collaboration timeline, model analytics, artifacts and quality checks.

Preserve existing product milestones; add these as explicit dependencies and acceptance criteria rather than replacing unrelated work. The first useful Agentic Mode milestone must demonstrate at least two agents in separate identified terminals exchanging a real delegated task and returning a result through ORQST.

**Deliverables:** updated roadmap/ADRs/API contracts; implementation by phase; tests and builds; documentation and changelog; summary of verified CLI versions/capabilities; known limitations and remaining work. Do not claim that planned capabilities are already complete.


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
