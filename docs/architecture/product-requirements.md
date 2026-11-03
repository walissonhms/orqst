# Product requirements and implementation coverage

## Audit basis — 2026-11-02

This public capability inventory follows the owner-approved desktop direction.
It records implementation coverage, not a completion report or a release claim.
The [roadmap](../../ROADMAP.md) defines the six phases and their acceptance gates.
Observer Core/Bridge separation and the local Analytics library are implemented
and integration-tested. A first browser ranking screen and bounded API also exist;
Phase 1 remains incomplete. The full Analytics workflow,
durable historical coverage and Desktop acceptance are still pending.

The audit inspected the workspace manifests, protocol, adapter normalization and
reader, SQLite schema/queries, bridge startup/routes, React views, locale catalogs,
unit/browser tests and existing ADRs. The stack is Node `>=24 <25`, pnpm 10.34.9,
strict TypeScript ~6.0.3, built-in `node:sqlite`, zod ^4.6.7, React ^19.3.1,
Vite ^8.3.5, Tailwind ^4.3.3 and i18next ^26.7.1, as declared in the
[root](../../package.json) and [dashboard](../../apps/dashboard/package.json)
manifests. These are declared constraints, not claims that every installed package
is exactly that version. No Electron/PTY dependency was declared in that baseline. The later ADR-030 slice
adds Electron45.2.1 as a checkout-only observer client; PTY remains absent.

**Existing** means implemented in the inspected baseline, with test references where
available; it does not mean freshly validated on a real machine. **Partial** means
only part of the requirement exists or development is in progress. **Absent** means
no runtime implementation was found; design/benchmark code alone does not implement
a product capability. All required acceptance checks remain in the roadmap.

## Evidence map

| Reference | Implementation and verification evidence                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P         | [Protocol schemas/types](../../packages/protocol/src/index.ts), [protocol documentation](../api/protocol.md).                                                                                                                 |
| C         | [Codex normalizer](../../packages/adapters/codex/src/normalize.ts), [reader](../../packages/adapters/codex/src/index.ts), [normalizer tests](../../tests/normalizer.test.ts), [observer tests](../../tests/observer.test.ts). |
| D         | [SQLite store](../../packages/database/src/index.ts), [store tests](../../tests/store.test.ts), [data model](data-model.md).                                                                                                  |
| B         | [Bridge startup](../../apps/bridge/src/main.ts), [routes/WS](../../apps/bridge/src/server.ts), [API tests](../../tests/api.test.ts).                                                                                          |
| U         | [React views](../../apps/dashboard/src/App.tsx), [live transport](../../apps/dashboard/src/use-observatory.ts), [browser tests](../../tests/browser/dashboard.spec.ts).                                                       |
| I         | [Claude descriptor](../../packages/adapters/claude/src/index.ts), [OpenCode descriptor](../../packages/adapters/opencode/src/index.ts), [capability evidence](../adapters/capability-model.md).                               |
| O         | [Optimizer design](token-optimizer.md), [preserved research/results](../benchmarks/token-optimization.md); research is outside runtime and CI.                                                                                |

## Requirement matrix

### Core and Bridge

| Requirement                                                    | Coverage | Evidence and remaining work                                                                                                                                                 | Phase |
| -------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Independent Core/Bridge responsibilities and provider adapters | Existing | ObserverCore and createBridge own lifecycle/resources; Core and Bridge lifecycle tests pass.                                                                                | 1     |
| Versioned normalized event contracts                           | Existing | P validates v1 and separate local observation/reference schemas; Core consumes them. Lifecycle transport/control remains planned.                                           | 1     |
| Projects, sessions, observed states and local history          | Existing | D/B/U support workspaces, associations and session history; not owned processes.                                                                                            | 1     |
| Managed process/session ownership                              | Absent   | No runtime control in B; future explicit observed/managed boundary.                                                                                                         | 4     |
| Started/running/completed/error/interrupted/waiting events     | Partial  | P/C cover observed turns; unsupported native paths remain fixture-only; no process/task completion inference.                                                               | 1, 3  |
| Approval pending and usage-limit evidence                      | Absent   | No validated dedicated approval/quota capability; input request compatibility is not proof of either.                                                                       | 3     |
| Metrics by source/model/session/project/time                   | Partial  | File provenance, timestamps, model and cumulative usage in P/C/D; compact durable interval evidence implemented; pre-upgrade gaps stay qualified.                           | 1     |
| Safe persistence/migrations and recovery                       | Existing | D/C and store/observer tests cover replay, checkpoints, truncation/rotation and retention; Schema 2 adds compact evidence/backfill; installed upgrade awaits review/backup. | 1     |

### Terminal, Monitor and Notifications

| Requirement                                                          | Coverage | Evidence and remaining work                                                                                                              | Phase |
| -------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Electron terminal with multiple tabs/sessions per project            | Absent   | U is shared with a minimal Electron observer client; no PTY, terminal tabs or execution.                                                 | 2     |
| Live terminal output, interactive input and controlled interruption  | Absent   | Timeline streaming is implemented; terminal transport and authorized control are not.                                                    | 2, 4  |
| Execute installed agents with supported configuration/permissions    | Absent   | B never launches agents; version-specific start/control must be validated.                                                               | 3, 4  |
| Foreground/minimized monitoring while monitor runs                   | Partial  | Independent bridge/service and browser stream exist; native Desktop minimized behavior unvalidated.                                      | 2     |
| Native macOS completion/error/attention/approval/interruption alerts | Partial  | U has browser Notification API for completion/failure/input, not native Electron integration or all categories; OS delivery unvalidated. | 2, 3  |
| Click notification opens corresponding session                       | Partial  | U notification drawer opens sessions; native OS click routing absent.                                                                    | 2     |
| History, pending count, preferences/silence and tray icon            | Partial  | D/U history, unread count and category/sound preferences exist; native silence policy and tray absent.                                   | 2     |
| Source-confirmed state; silence is not completion                    | Existing | P/C preserve unknown/evidence semantics; no idle completion rule.                                                                        | 1–3   |

### Artifacts and Model Manager

| Requirement                                                         | Coverage | Evidence and remaining work                                                                                                          | Phase |
| ------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| Structured Markdown recognition; manual extraction when ambiguous   | Absent   | U shows captured responses as plain text; no artifact extraction.                                                                    | 2     |
| Independent artifact panel with safe source/preview/edit            | Partial  | Manual source/preview/draft, restore and explicit-close confirmation implemented; draft/version persistence absent.                  | 2     |
| Copy raw Markdown/rendered text; save .md; external editor          | Absent   | No artifact clipboard/save-dialog/editor workflow.                                                                                   | 2     |
| Artifact project/session/agent/date provenance and original/history | Partial  | P/Core provide versioned references to retained message evidence without bodies or extraction; no artifact document/version history. | 1, 2  |
| Confirm overwrite; never silently replace files                     | Absent   | No artifact file writer exists; confirmation is required before adding one.                                                          | 2     |
| Project/agent/model selectors always accessible in session          | Partial  | U selects workspace/session and displays model; no agent/model execution selector.                                                   | 2     |
| Agent/project model defaults and session override                   | Absent   | No configuration path in B/U.                                                                                                        | 2, 4  |
| Supported models/capabilities, valid combinations, reasoning/Fast   | Absent   | I/P have observation flags, not validated model discovery/configuration.                                                             | 2, 3  |
| Model changes only when supported, restart/impact explicit          | Absent   | Observing model changes in C does not implement changing them.                                                                       | 3, 4  |

### Live Metrics

| Requirement                                                               | Coverage | Evidence and remaining work                                                                                                                  | Phase |
| ------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Permanent token header in session, terminal and artifacts                 | Partial  | U session table/usage view has totals; no permanent shared header or terminal/artifact views.                                                | 2     |
| Input/output/cache/total without duplicate subsets                        | Existing | C/D enforce Codex cumulative semantics and mirror priority; tests cover replay/cache. Provider parity unproven.                              | 1, 3  |
| Animate only real updates; last confirmed value and update time           | Partial  | U refreshes observed totals; no qualified stale/update-time header or count animation.                                                       | 2     |
| Supported Fast lightning, configurable high-use flame and state reactions | Partial  | U has a static flame and exact distance for the temporary confirmed-total threshold; Fast and broader state reactions remain absent.         | 2     |
| Mascot eye/context motion, reduced motion and performance                 | Absent   | No required mascot reaction system.                                                                                                          | 2, 6  |
| Session/project limits; verified-price-only cost                          | Partial  | U offers a temporary session visual threshold on confirmed totals; persistent/project limits, verified prices and enforcement remain absent. | 2, 4  |

### Mandatory Model Usage Analytics

| Requirement                                                                  | Coverage | Evidence and remaining work                                                                                                              | Phase   |
| ---------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Dedicated Most Used Models screen; model/provider ranking                    | Partial  | Library, bounded API and browser ranking implemented; provider identity and real multi-model acceptance pending.                         | 1, 2    |
| Default rank by reported total tokens; alternative sessions/runs/active time | Partial  | D has cumulative session totals; no period/model rank or evidenced execution/active-time basis.                                          | 1, 2    |
| Today/7d/30d/custom; all/one project; agent/provider/model filters           | Partial  | Calendar/custom/workspace/exact agent/model and implemented-adapter filters exist; provider filter unavailable.                          | 2       |
| Model bars, time evolution, percentage share; leader/token/session cards     | Partial  | Share bars and leader/token/session cards implemented; time evolution absent.                                                            | 2       |
| Input/output/cache breakdown; separate tokens from money                     | Partial  | Aggregate and browser breakdown implemented; cost qualification unavailable.                                                             | 1, 2    |
| Observed model/provider/session/project/time/source/reliability              | Partial  | P/C retain source/model context; qualified local attribution exists; provider identity and durable coverage remain incomplete.           | 1       |
| Unidentified model bucket; no inferred assignment                            | Partial  | SessionView.model is nullable and U displays unknown; Analytics bucket/contained-interval policy and browser unknown labels implemented. | 1, 2    |
| Cumulative deduplication, imported/managed distinction, coverage             | Partial  | Canonical deduplication, observed origin and qualified period/retention gaps implemented; managed mode absent.                           | 1, 2, 4 |
| Side-by-side two or more models, including different agents                  | Partial  | Current rows compare reported usage/sessions; provider access, task equivalence and real multi-model acceptance pending.                 | 2, 3    |
| Total/per-run/mean/median successful-task tokens, time/success/cost          | Absent   | No task outcome/attempt/equivalence dataset; unavailable must not become zero.                                                           | 1, 2, 4 |
| Input/output/cache/reasoning distinctions by availability                    | Partial  | P has input/output/cached/total; reasoning and provider-specific cache-write distinctions unavailable in current Usage.                  | 1, 3    |
| Equivalent project/category/difficulty/period comparisons                    | Partial  | Descriptive/non-equivalent guard implemented; task equivalence and qualified efficiency comparison remain absent.                        | 1, 2    |
| Distinguish most used, efficient successful task and verified best value     | Absent   | No outcome-qualified efficiency/value ranking.                                                                                           | 2       |
| Task outcomes, failures, repair attempts and coverage; no token-only quality | Partial  | C records turn outcomes/tool events; these do not establish task correctness or repairs.                                                 | 1, 2, 4 |
| CSV/Markdown report without prompts/secrets/private content                  | Absent   | No Analytics exporter or export-field allowlist yet.                                                                                     | 2       |
| Source-reconciled multi-model totals, functional filters, no fictitious data | Partial  | Unmocked two-model synthetic browser/API/observer reconciliation passes; real multi-model acceptance pending.                            | 2       |

### Token Optimizer and distribution

| Requirement                                                            | Coverage | Evidence and remaining work                                                                                                               | Phase          |
| ---------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Disabled/Economy/Intelligent, opt-out/fallback/audit                   | Partial  | O specifies modes and synthetic prototypes; no runtime optimizer/toggle.                                                                  | 5              |
| Qualified Phase 0 synthetic benchmark evidence                         | Existing | O retains 42 selected executions, 5.975% Economy and 8.768% guarded Intelligent reported-token reductions; not production/cash savings.   | Historical / 5 |
| Exact deduplication with provenance/protected context                  | Partial  | O research only; no authorized runtime transformation.                                                                                    | 5              |
| Real complete-task correctness/net cost/cache validation               | Absent   | Synthetic validators do not prove production quality or benefit.                                                                          | 5              |
| No private CLI prompt modification or removal of required instructions | Existing | Runtime has no interception/optimizer; maintain this boundary in future design.                                                           | 1–5            |
| Packaged desktop/installers/updates and platform coverage              | Partial  | macOS user-service helper exists; no Desktop installer/update or Windows/Linux acceptance.                                                | 3, 6           |
| Accessibility/performance and local diagnostics                        | Partial  | Responsive/browser tests and observer diagnostics exist; full Desktop accessibility/soak/local diagnostic policy pending.                 | 6              |
| Local privacy, credential protection and project boundaries            | Partial  | Loopback, cookie/Origin/CSP, private files and redaction exist; managed-project grants and artifact/terminal isolation still need review. | All            |

## Gaps and decisions

The existing `Usage` read model uses numeric defaults and a latest session model;
it cannot prove measured zero, active time, task success or historical per-model
allocation. Retained session totals outlive detailed events, so historical period
coverage cannot be reconstructed reliably after retention. New Analytics must make
these limits explicit rather than relabel existing totals.

Phase 2 is broader than the previous Desktop observer phase. Its terminal UI depends
on Phase 4 authorization before executing agents; provider support is accepted per
operation in Phase 3. The Desktop MVP is not complete while that path is missing.
Analytics is mandatory even when managed execution, other providers or cost data
are unavailable; present supported observations with explicit coverage limits.

See [Analytics semantics](model-usage-analytics.md), [open decisions](../../ROADMAP.md#open-decisions-and-explicit-gates)
and [ADR-026](decisions.md#adr-026--six-phase-desktop-delivery-and-mandatory-local-analytics).
