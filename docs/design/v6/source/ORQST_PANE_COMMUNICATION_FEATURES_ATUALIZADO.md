# ORQST — Pane-to-Pane Communication Specification

**Status:** Proposed requirement for the ORQST Agentic Mode. This document complements, rather than replaces, `ORQST_AGENTIC_MODE_SPEC.md`, the master implementation plan, existing ADRs, and `ROADMAP.md`.

## Mission

Implement native, local-first communication between multiple managed AI CLI terminal panes inside ORQST, independently of Overclock or any third-party terminal orchestrator. The Overclock examples are behavioral references only, not integration dependencies.

A user or authorized agent must be able to address an exact pane (for example, `T-003`), send a task while that pane is busy, track delivery and execution independently, receive the result, and handle closures safely.

## 1. Identity and lifecycle

- Every pane has an immutable internal `paneId` (UUID or equivalent), a human-readable workspace-scoped display ID such as `T-003`, and an editable display name.
- Persist `workspaceId`, `paneId`, display ID, agent provider, CLI version, selected model, native session reference, managed/external ownership, process state, and last-known activity where available.
- Display IDs must not silently refer to a different pane after restart or closure. Resolve names with ambiguity checks.
- Distinguish **hide panel**, **detach UI**, **stop task**, and **terminate managed process**. Closing a visual pane must not implicitly terminate its agent.
- External/observed sessions are read-only unless the relevant adapter can prove a separately authorized control channel. Never inject into arbitrary external terminals.

## 2. Communication architecture

```text
User / Agent A / Intent Planner
          |
          v
ORQST Orchestrator (authorization, routing, durable queue)
          |
          v
Pane Registry -> Agent Adapter -> Managed CLI Session in Pane B
          |                          |
          +<--- acknowledgements ----+
          +<--- task events/results --+
          |
          v
SQLite local + WebSocket events + Communication Inspector
```

- The Core owns the authoritative pane registry, message queue, permissions and task state. Electron/browser are clients only.
- Prefer supported provider-native structured interfaces for task submission and acknowledgements. A PTY is responsible for interactive terminal I/O, not a general-purpose agent messaging protocol.
- Expose authorized capabilities through an optional ORQST MCP server (`orqst_list_panes`, `orqst_send_to_pane`, `orqst_get_message_status`, `orqst_get_task_result`, `orqst_cancel_task`), using the same Core service and authorization rules. MCP is a transport/interface, not the source of truth.
- Do not claim universal CLI support. Each adapter must declare `canSend`, `canQueueWhileBusy`, `canAcknowledge`, `canReportTaskCompletion`, `canCancel` and their limitations.

## 3. Proposed message envelope

The following is a semantic example, **not** an existing API:

```json
{
  "schemaVersion": 1,
  "messageId": "msg-unique-id",
  "correlationId": "task-102",
  "workspaceId": "workspace-id",
  "sourcePaneId": "internal-source-pane-id",
  "targetPaneId": "internal-target-pane-id",
  "type": "task.request",
  "payloadRef": "local-authorized-content-reference",
  "deliveryPolicy": "queue-if-busy",
  "idempotencyKey": "task-102:review:v1",
  "permissionScope": "workspace-task-delegation",
  "deadline": null
}
```

- Payloads and references remain local; minimize duplicated provider histories and avoid logging secrets or complete prompts by default.
- Validate destination, workspace membership, sender authority, agent capabilities, task budget, concurrency limits, and payload size before accepting a message.
- Acknowledgement of queue admission is **not** acknowledgement of delivery, start, or completion.

## 4. Delivery and execution states

Model transport and execution separately, with timestamps and explicit unknown states.

| Delivery state | Meaning |
| --- | --- |
| `queued` | Persisted locally; not yet submitted to target CLI |
| `dispatching` | Adapter is attempting submission |
| `accepted` | Target interface confirmed acceptance; may still be queued internally |
| `delivered` | Target confirmed receipt, only if observable |
| `delivery_failed` | Submission failed with known cause |
| `target_closed` | Target closed before delivery or before confirmed processing |
| `delivery_unknown` | Outcome cannot be established after disconnect/crash |

| Task state | Meaning |
| --- | --- |
| `pending` | Not started |
| `running` | Started with evidence from the adapter |
| `waiting_approval` | User authorization needed |
| `completed` | Verified task completion event/result |
| `failed` | Verified execution failure |
| `cancelled` | Cancellation confirmed |
| `outcome_unknown` | Cannot determine whether side effects occurred |

Do not map a terminal's exit or an idle prompt to task completion without provider-specific evidence. Never fabricate `delivered`/`completed` for adapters that cannot report them.

## 5. Busy panes and queueing

- If a pane is busy, ORQST may persist a message in its own queue, then dispatch when the adapter reports the pane is ready.
- If the provider itself accepts queued input during a turn, record that as **provider accepted**, not as processed.
- Preserve per-target ordering by default, with configurable priorities and bounded queue sizes. Do not interrupt an in-flight task just to deliver a new instruction.
- Provide queue position, message status, expiry, cancellation and user-visible reason for blocked delivery.
- On pane termination, mark pending messages accordingly and notify the sender. Do not automatically redirect to a different pane/model without explicit routing policy.

## 6. Retry, recovery and idempotency

- Persist message metadata, queue state, attempts, correlation IDs, task/result references and audit events in local SQLite, using migrations and transaction boundaries.
- Use at-least-once delivery semantics only where supported, with idempotency keys and duplicate suppression at the ORQST boundary.
- Do not promise exactly-once execution: an agent may act before a crash prevents acknowledgement. Mark ambiguous outcomes `delivery_unknown` or `outcome_unknown` and reconcile before retrying.
- Automatic retry is allowed only when no side effects are possible or when provider-specific reconciliation proves safe; otherwise require user review.
- Restart/reconnect must restore queues and references without rewriting native histories. Terminal processes do not survive a machine reboot; native session resumption is separate.

## 7. Agentic orchestration integration

- Support explicit commands such as: “Send T-003 a review request”, “Ask T-004 to test the result from T-001”, and “Close T-006 after its confirmed task completion.”
- Support high-level requests such as “Create a React login screen and Laravel backend; distribute the work.” The Intent Planner produces a reviewable task graph and chooses agents according to user defaults unless the user explicitly requests a provider/model.
- The orchestrator can create multiple panes of the same CLI with different supported models, names and permissions, subject to machine resource limits.
- Prefer existing compatible panes when authorized; otherwise create managed panes. Never reuse a pane merely because its display name matches.
- Prevent delegation loops with ancestry, maximum depth, hop count, timeouts, budget ceilings and per-task permissions.
- Shared repository writes require conflict prevention (for example Git worktrees and controlled integration) rather than concurrent unsupervised edits.
- Automatic terminal termination is limited to owned, managed panes and only after verified completion, no pending approvals, no uncommitted/unsaved work risk, and the user's configured closure policy.

## 8. Frontend — Communication Inspector

Use the approved ORQST Minimal Dark + Developer Studio design tokens and mascot identity.

- In Studio, show pane IDs and editable names in every terminal header; provide copy-ID, send-message, task-details and queue controls.
- Provide a collapsible **Agent Communication Inspector** with source -> destination, task/message preview, queued/accepted/running/completed/error states, timestamps, retries, approvals and clickable destination.
- Show directional connection lines or a lightweight timeline, not a visually overwhelming node editor.
- Make it obvious whether a message is **queued**, **accepted by CLI**, **being processed**, or **completed**.
- Provide actions to cancel queued messages, inspect results, retry only when safe, and navigate to the exact pane.
- Notifications: target closed before processing, message failed, approval needed, delegated task completed, uncertain outcome.
- Keep token usage and selected model visible in the pane header when known; use `unavailable` rather than invented figures.
- Respect reduced-motion and keyboard accessibility; localize all labels (en-US default, pt-BR supported).

## 9. Security and privacy

- Strict workspace and sender/target authorization; distinguish read-only observation from execution/control grants.
- Validate MCP callers and tool arguments. Do not expose a broad unrestricted terminal-input tool to arbitrary agents.
- Treat agent output as untrusted content, never as authorization to execute new operations.
- Require approval for privileged commands, sensitive file changes, cross-workspace operations, elevated budgets or destructive actions.
- Keep content local; Cloud must not persist terminal output, prompts or source code.
- Rate-limit messages, cap queue sizes and payloads, prevent recursion and provide auditability without duplicating private transcripts.

## 10. Tests and acceptance criteria

Implement automated unit/integration tests and, when safe and available, end-to-end tests for:

1. Two real managed panes with distinct IDs: send a task from A to B and receive a verified result back in A.
2. Busy destination: queue without interrupting the active turn; deliver in order when safe.
3. Target closes before dispatch: mark `target_closed`, notify sender and do not claim delivery.
4. Target accepts but closes before processing: distinguish accepted from completed; preserve uncertain state.
5. Core restart: recover queue metadata and reconcile safely without duplicate execution.
6. Unauthorized sender or cross-workspace target: deny with audit event.
7. Two Codex + four Claude Code panes with independent model configuration and correct targeting (use mocks where provider access is unavailable).
8. Duplicate requests and retries: idempotency, loop prevention, timeout and budget enforcement.
9. Closing a visual pane does not kill its process; managed auto-close follows user policy.
10. Frontend Inspector accurately renders real state, unknown metrics and actionable notifications.

**First functional milestone:** create two real, identified managed CLI panes, delegate one bounded task, observe acknowledgement separately from completion, and deliver the result to the initiating pane. If provider limitations prevent a step, report it honestly and implement tested fallbacks rather than simulating success.

## 11. Detailed normative behavior and definitions

The words **MUST**, **SHOULD**, and **MAY** indicate requirement strength. This section expands the preceding contract and resolves ambiguity; it does not assert that any feature is already implemented.

### 11.1 Entities and ownership

| Entity | Definition | Identity and ownership |
| --- | --- | --- |
| Workspace | Local project boundary, directory and policy | Immutable `workspaceId`; no implicit cross-workspace operations |
| Pane | Addressable UI/runtime slot associated with a session | Immutable `paneId`, human-friendly `T-001` label scoped to workspace |
| Managed session | Agent instance started and supervised by ORQST | ORQST may send tasks and stop it within granted policy |
| Observed session | CLI started externally, discovered through native sources | Read-only unless a separately proven and authorized control channel exists |
| Process | OS process / PTY lifecycle | PID alone is never stable identity; record creation/ownership metadata |
| Turn | Provider-native unit of work | May complete without task or process completing |
| Task | ORQST-level requested outcome | Durable `taskId`, source/target, dependencies and result evidence |
| Message | A communication attempt or response | Durable `messageId`; references task and correlation |
| Delivery attempt | One adapter dispatch try | Unique `attemptId`, timestamps and transport evidence |

**Identity rules:** A display ID MUST be shown in every pane header and copyable. Users MAY rename a pane (e.g. `T-004 · Security Review`); renaming MUST NOT change the immutable ID. Closed IDs MUST NOT silently be recycled in a way that points old messages to new panes. The orchestrator MUST resolve both `workspaceId` and immutable pane ID before dispatch. Name-only references with multiple matches MUST require disambiguation. Every new pane must have an explicit lifecycle owner (`user`, `orchestrator-run`, or another authorized actor) and creation reason.

### 11.2 Creation, reuse and termination

The user may request: **“Create two Codex panes and four Claude Code panes; use different models and assign each a name.”** The orchestrator MUST validate CLI installation, compatible provider model, authentication availability without reading secrets, OS resources, workspace permission and concurrency policy. Explicit user provider/model choices override defaults; if unavailable, return a precise error and ask before substituting. When a provider does not support model changes in an existing session, create a compatible new session only if authorized.

A task planner may automatically open as many panes as required **within configured resource and spending limits**. It SHOULD prefer a suitable idle pane when reuse is safe; it MUST NOT reassign an unrelated busy pane or silently change its model. Each created pane MUST be traceable to a run and visible in the UI.

**Four separate actions MUST exist:** `hidePane` (visual only), `detachPane` (disconnect client), `stopTask` (provider-aware cancellation), and `terminatePane` (managed process shutdown). `terminatePane` SHOULD attempt graceful shutdown and wait for a bounded period before any force-kill; force-kill requires appropriate authorization. Never terminate an externally owned process by default. Automatic closure MUST be opt-in or governed by a visible, revocable policy, and MUST check pending messages, approvals, unresolved tasks and worktree changes.

### 11.3 Defaults and natural-language precedence

Configuration hierarchy (highest priority first): **explicit current user instruction > current run policy > workspace defaults > global defaults**. Security constraints, available provider capabilities and resource limits override all requested preferences. Agent-generated suggestions do not override user authority.

Examples:

| User says | Expected behavior |
| --- | --- |
| “Send T-003 the API review.” | Resolve exact pane in current workspace, authorize and queue task |
| “Ask Claude Opus to implement the backend.” | Select Claude Code and an actually supported Opus model; reuse/create pane as authorized |
| “Build a login screen and Laravel API; distribute the work.” | Generate a task dependency graph, choose defaults, create needed panes and assign bounded tasks |
| “Close T-006 when finished.” | Record conditional closure; execute only after verified completion and safe-close checks |
| “Send the same request again.” | New task only if explicitly intended; otherwise use correlation/idempotency and warn about duplicates |
| “Use T-003” where T-003 is in another workspace | Deny by default; require explicit cross-workspace approval |

A natural-language parser or LLM produces **proposed structured intent**, never direct execution authority. The Core validates the resulting typed operation. Simple exact-pane operations SHOULD use deterministic parsing when possible to avoid unnecessary token consumption.

## 12. Transport-independent command and event contracts

The names below are proposals for typed Core commands, not claims of existing API routes. The exact schema must be versioned and documented before implementation.

| Command | Required fields | Successful result | Important failure |
| --- | --- | --- | --- |
| `pane.list` | `workspaceId` | panes + capabilities + freshness | unauthorized |
| `pane.create` | `workspaceId`, provider, model request, name, ownership, policy | `paneId`, display ID, resolved model, state | CLI missing / model unsupported / resource limit |
| `pane.rename` | `paneId`, new name | updated pane | conflict / unauthorized |
| `pane.send` | `messageId`, target, task/payload ref, delivery policy, idempotency key | queue admission receipt | target gone / denied / invalid payload |
| `pane.messageStatus` | `messageId` | delivery + task status and evidence | not found / forbidden |
| `pane.result` | `taskId`, access scope | result reference and provenance | pending / unavailable |
| `pane.stopTask` | `taskId`, reason, authorization | cancellation requested/confirmed separately | unsupported / unknown outcome |
| `pane.terminate` | `paneId`, shutdown policy | termination requested/confirmed separately | not owned / pending work |
| `pane.queueCancel` | `messageId` | cancelled only if not dispatched | already accepted / unknown |

**MCP exposure:** Offer narrowly scoped MCP tools for authorized agents as a facade over these same Core commands. MCP registration is optional and per-agent/per-workspace. Do not automatically install MCP configurations into existing third-party CLI profiles. An MCP tool result MUST include the distinction between **queue admitted**, **provider accepted**, **task started**, and **task completed**. The UI, MCP and API MUST use the same state model. No arbitrary `terminal.write` MCP tool for agents in the initial implementation.

### 12.1 Example request

```json
{
  "schemaVersion": 1,
  "messageId": "msg-01JEXAMPLE",
  "taskId": "task-42",
  "correlationId": "run-8",
  "workspaceId": "ws-project-a",
  "source": {"paneId": "pane-codex-a", "actorType": "agent"},
  "target": {"paneId": "pane-claude-review"},
  "kind": "task.request",
  "payloadRef": "local://authorized/task-42/request",
  "deliveryPolicy": "queue-if-busy",
  "idempotencyKey": "run-8:task-42:review:1",
  "limits": {"maxDepth": 3, "maxAttempts": 2, "deadlineSeconds": 900},
  "permissionGrantRef": "grant-local-123"
}
```

The `local://` reference is illustrative; implement an explicit secure local reference resolver rather than treating this as a URL fetch. Avoid storing full prompts twice. Validate content version/hash at dispatch and enforce size limits.

### 12.2 Example receipts and events

```json
{"messageId":"msg-01JEXAMPLE","deliveryState":"queued","taskState":"pending","evidence":"sqlite-committed"}
{"messageId":"msg-01JEXAMPLE","deliveryState":"accepted","taskState":"pending","evidence":"adapter-native-acceptance"}
{"messageId":"msg-01JEXAMPLE","deliveryState":"accepted","taskState":"running","evidence":"provider-turn-started"}
{"messageId":"msg-01JEXAMPLE","deliveryState":"delivered","taskState":"completed","resultRef":"local://authorized/task-42/result","evidence":"provider-turn-completed-with-task-match"}
```

These are separate chronological events, not four simultaneous states. The final event is valid only when the adapter actually exposes corresponding evidence. If receipt cannot be proven, preserve `accepted` and do not fabricate `delivered`. A generic process exit is insufficient evidence of successful task completion.

### 12.3 State transitions and failure handling

**Delivery:** `queued → dispatching → accepted [→ delivered]` or `queued/dispatching → delivery_failed | target_closed | delivery_unknown`. State `accepted` MAY remain the last known transport state while the task runs. A crash between send and receipt requires `delivery_unknown`, not a blind retry.

**Task:** `pending → running → completed | failed | waiting_approval | outcome_unknown`. `waiting_approval → running | cancelled | failed` depends on explicit user action and provider evidence. A cancellation request is not proof of `cancelled` until acknowledged.

A terminal closure must classify each message by stage: before dispatch (`target_closed`), after provider acceptance but before confirmed processing (unknown processing outcome), and after execution with missing acknowledgement (`outcome_unknown`). Emit a user-facing notification containing target ID, message ID, last verified state, and safe next actions. Do not claim that a message "did not enter" unless there is evidence it was never accepted.

## 13. Queue engine and concurrency

- SQLite is authoritative for queue records, state transitions and event ordering; use WAL, transactions, migrations and one controlled writer where appropriate.
- A queue admission receipt is returned **only after durable commit**. UI reconnection must replay current state and avoid double-counting events.
- Preserve FIFO per target by default; if priority overrides exist, document fairness and starvation prevention.
- Limit queued messages per pane, payload size, maximum age, parallel active tasks per provider and global resource usage. Surface queue saturation rather than silently dropping messages.
- Dispatch only when the adapter has a safe, verified way to accept work. If the provider exposes no busy/ready signal, keep queued and show **waiting for safe dispatch**, rather than guessing from terminal text.
- A user MAY cancel a queued item. If dispatch may already have occurred, report **cancellation uncertain** and reconcile.
- Track lease/worker identity to prevent concurrent dispatchers claiming the same queued message; use transactional claims and expiry reconciliation.
- Keep an append-only local audit of **state changes and references**, not full provider transcripts. Establish configurable retention and secure deletion of ORQST-owned metadata.

### 13.1 Duplicate prevention

Idempotency key scope MUST include workspace, target and logical operation. Duplicate admission returns the original `messageId`/status instead of creating a second dispatch. Idempotency at the ORQST boundary **cannot guarantee** exactly-once external side effects. A retry after uncertain acceptance MUST require reconciliation or human approval for side-effecting tasks (file edits, installs, deploys, purchases, deletions).

### 13.2 Recovery matrix

| Event | Required recovery |
| --- | --- |
| Electron window closes | Core continues; reconnect restores panes, queue and event history |
| Browser disconnects | No implicit process termination; replay updates on reconnect |
| Core restarts | Restore durable state, reattach if possible, reconcile uncertain deliveries before retry |
| Managed CLI exits | Record process exit separately from task result; notify pending senders |
| Computer reboots | Restore layout/IDs/references; restart/resume only by explicit configured policy and provider support |
| External CLI closes | Update observed state; never try to restart it automatically without permission |

## 14. End-to-end example: multi-agent login implementation

**Request:** “Build a React login screen and Laravel backend. Distribute tasks. Have Claude review the API and OpenCode run tests. Close temporary panes when everything is done.”

1. **Parse:** Extract deliverables, explicit agent choices, dependencies, repo/workspace, allowed operations and closure policy. Ask only when a missing decision is material (e.g., which repo or unsafe production deployment).
2. **Plan:** Create task graph: `frontend`, `backend` (parallel if isolated), `integration` (depends on both), `review` (depends on backend), `tests` (depends on integration/review), `summary`.
3. **Select:** Resolve provider/model per task using explicit requests first, then configured role defaults. Check availability, login, cost mode and limits. Do not silently switch provider/model.
4. **Create:** Allocate identified panes, e.g. `T-001 Backend · Codex`, `T-002 Frontend · Claude`, `T-003 Review · Claude Opus`, `T-004 Tests · OpenCode`. Record ownership and selected model for each.
5. **Isolate:** Use Git worktrees or another validated edit-isolation strategy for concurrent writers. Define integration owner and conflict-resolution gate.
6. **Dispatch:** Submit bounded task envelopes and record queue admission separately from provider acknowledgement.
7. **Observe:** Update each pane status, token usage, cost estimate, task graph and communication timeline from real adapter events. Unknown remains unknown.
8. **Collaborate:** A completed backend task sends a result reference to review; reviewer returns findings; integration task merges authorized changes and runs tests.
9. **Approval:** Stop at permission boundaries for destructive commands, credentials, external effects, production deployments or policy violations.
10. **Finish:** Verify requested artifacts, tests and task graph completion. Notify user and provide links to local results.
11. **Close:** Auto-close only panes owned by this orchestration run and proven safe to terminate. Preserve user-owned panes and incomplete tasks.

**User override:** “Mande o Claude Opus criar o backend” MUST route to a compatible Claude Code pane/model instead of a default Codex backend assignment. If Opus is unavailable, present alternatives; never pretend that a different model fulfilled the request.

## 15. Frontend specification — Studio and Communication Inspector

Use ORQST's approved Minimal Dark + Developer Studio palette (`#080B1E`, `#141329`, `#241A3E`, `#8424E8`, `#B45CFF`, `#D9C9FF`), semantic success/warning/error colors, and reduced-motion support. This specification complements the separate UI/UX master document.

**Studio pane header:** `T-003 · Security Review | Claude Code | [verified model] | Running | [last confirmed tokens]`. Provide copy ID, rename, focus, split, send message, view queue, stop task, hide and terminate (permission-dependent). Always distinguish `close visual panel` from `terminate process` in labels and confirmation dialogs.

**Communication Inspector:** filter by workspace, run, pane, direction, message type and status. Each row shows source/target display ID, timestamp, correlation/task, short safe preview, delivery badge and separate task badge. Clicking opens the exact pane and task. Provide queue position, retries, latest evidence, result link, blocked reason and safe retry/cancel actions. Use a compact timeline with directional arrows; no mandatory giant node canvas.

**Orchestrator composer:** one prominent natural-language input plus optional advanced controls (provider/model overrides, concurrency, budget, auto-close, review-before-run). Preview the task plan and agent assignments when necessary. Clearly mark requested actions that need user approval. Support both direct exact-pane commands and multi-agent high-level instructions.

**Notifications:** `task completed`, `needs approval`, `target closed`, `delivery failed`, `outcome unknown`, `budget exceeded`, `provider unavailable`. Deep-link to the relevant pane/message and show the last verified evidence. Never animate an unverified state as successful.

**Accessibility:** keyboard navigation for pane selection, queue inspection, copy ID and status; accessible color contrast; no color-only distinctions; `prefers-reduced-motion`; localization in en-US and pt-BR.

## 16. Security, threat scenarios and privacy checks

1. **Prompt injection:** Text from one agent or tool output is untrusted. It MUST NOT grant permissions, override the task scope, or request privileged actions on behalf of a user.
2. **Workspace isolation:** Cross-workspace send, result retrieval, or termination is denied by default. IDs cannot be guessed to bypass access checks.
3. **Capability grants:** Read-only observation does not imply write, send, cancel or terminate. Grants should be scoped by actor, workspace, operation, target and expiration.
4. **Terminal control:** A PTY is a process I/O channel, not an unrestricted MCP command executor. Avoid terminal-input injection into external sessions.
5. **Sensitive data:** Do not log credentials, tokens, complete prompts, source code or raw terminal buffers to Cloud. Local payload references must enforce path/scope validation and not allow traversal.
6. **Resource exhaustion:** Set limits on concurrent panes, queue length, messages per minute, context size, token budget and execution duration. Expose clear user controls.
7. **Process termination:** Do not kill processes based solely on PID without validating ownership and process identity. Preserve user-owned sessions.
8. **Supply chain:** Do not copy Overclock implementation. Review licenses and compatibility of MCP/PTY/adapter dependencies before inclusion.

## 17. Implementation milestones and gates

| Milestone | Deliverable | Exit criteria |
| --- | --- | --- |
| M0 — Contract alignment | ADR, roadmap, schema and capability matrix | No ambiguity between delivery/task/process states; backward-compatible plan |
| M1 — Pane registry | IDs, ownership, models, lifecycle persistence | Six mock panes targetable independently; restart restores identity |
| M2 — Managed runtime | PTY/session manager and one verified adapter | Two real managed panes, reliable lifecycle, no arbitrary external injection |
| M3 — Durable communication | SQLite queue, dispatcher, acknowledgements, error handling | Busy queue, closed target, crash recovery and deduplication tests pass |
| M4 — MCP and collaboration | Scoped MCP tools plus result routing | Agent A delegates bounded task to B and receives verifiable result |
| M5 — Agentic planner | Natural-language planning, defaults, explicit overrides, auto-create/close | Login/backend scenario executes with correct models, permissions and task graph |
| M6 — UX and observability | Inspector, notifications, metrics, model labels | End-to-end UI accurately reflects confirmed state and unavailable metrics |

M0–M6 are capability milestones inside the existing project roadmap, not permission to overwrite the current roadmap or claim a feature is shipped. If two real providers are not available, mocks may validate the contracts, but the **real-provider milestone remains incomplete** until demonstrated.

### 17.1 Required automated test cases

- Exact ID resolution; rename; ambiguous names; ID non-reuse; workspace isolation.
- Create 2 Codex + 4 Claude panes with independent model requests; unsupported model rejected honestly.
- User explicit Claude Opus request overrides defaults; no silent fallback.
- Queue while busy, FIFO ordering, queue capacity, expiration, cancel before dispatch.
- Provider accepts while busy but has not processed; UI never labels this completed.
- Target closes before dispatch; target closes after acceptance; uncertain provider acknowledgement.
- Core crash between provider side effect and acknowledgement; no unsafe automatic retry.
- Duplicate message/idempotency; loop depth, time, token and resource limits.
- User closes window vs pane vs process; automatic close only for owned and safely completed panes.
- MCP caller without permission; malicious agent output; path traversal in local references.
- Real integration test: two managed CLI panes, delegated task, result returned, matching correlation IDs and provider evidence.
- Frontend test: Inspector links, notification deep links, stale metrics, disabled unsupported controls and localization.

### 17.2 Definition of done

A milestone is done only when code, migrations, tests, documentation and user-facing status agree. Report implemented vs partial vs planned, provider/OS versions tested, evidence and known limitations. Run lint, typecheck, tests and build; keep existing Bridge APIs stable. Update `ROADMAP.md`, relevant ADRs, lifecycle/communication API docs, README and CHANGELOG. Use scoped commits and avoid overlapping edits with another agent's worktree.

## 18. Instructions to Codex — action required

1. Read this document **and** the existing `ORQST_AGENTIC_MODE_SPEC.md`, UI/UX master specification, architecture ADRs and `ROADMAP.md`.
2. Compare them against the current code and produce a concise implemented/partial/missing capability matrix before coding.
3. Incorporate the detailed pane protocol into the authoritative roadmap and versioned contracts without replacing existing work or breaking observation-only behavior.
4. Implement approved non-destructive milestones incrementally, with tests after each; never simulate real CLI success.
5. For unsupported provider features, expose honest capability flags, graceful fallback and a documented gap.
6. Stop for new privileged operations, destructive changes, external spending, missing credentials or incompatible architectural decisions. Otherwise continue through authorized scope.
7. Report files changed, tests run, real-provider evidence, incomplete features and next milestone.

**Do not integrate with Overclock. The ORQST Core owns its own native pane registry, durable queue, adapter communication, MCP facade and lifecycle policies.**


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
