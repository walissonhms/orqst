# Token Optimizer — architecture design

## Status and purpose

Foundational product requirement; Phase 0 research and isolated experiments only.
No production package, dependency, API, provider proxy, settings toggle or optimizer
is implemented. The current bridge, dashboard, APIs, native histories and observed
external sessions are unchanged. See [ADR-025](decisions.md#adr-025--independent-token-optimizer-and-evidence-gated-activation)
and [research/results](../benchmarks/token-optimization.md).

Optimize unnecessary usage without weakening task correctness, security, code
integrity, instruction priority or reliability. Prompt bytes, provider token usage,
cached-token rates, actual bills and task success are different measurements.

## Domain boundary and modes

The future Core composes an independent optimizer domain component. Adapters
provide capabilities and authorized context; the optimizer returns an inspectable
plan. Native SDK/CLI histories remain authoritative. No Electron or Cloud import,
provider credential ownership, terminal interception or session-file modification
belongs in the optimizer. Do not scaffold a production package in this phase.

| Mode        | Intended behavior                                                                                            | Gate/fallback                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Disabled    | Preserve supplied context and verbosity policy                                                               | Always available; current production has no active optimization                  |
| Economy     | Exact redundant-snapshot deduplication, supported selective context and bounded verbosity/output strategies  | Preserve protected data and provenance; unknown safety means retain the original |
| Intelligent | Select validated strategies using task complexity, adapter support, budgets and observed quality/performance | Fall back to Economy or Disabled when evidence/authority/relevance is uncertain  |

The experimental Intelligent mode uses explicit synthetic fixture relevance and a
risk guard. It is not a learned/adaptive production implementation. It does not
infer repository relevance from arbitrary text or silently prune dependencies.

The intended default for future managed sessions is safe Economy only after
correctness and measurable benefit are validated. Production activation and any
adaptive policy require a separate implementation/release review, gradual rollout,
visibility, per-task/workspace opt-out and a reversible disable path. External
sessions remain unaffected unless the owner explicitly grants an exposed operation;
observation access or adapter discovery is never that grant.

## Planned request, plan and evidence contracts

These are semantic interfaces, not exported TypeScript or registered endpoints.
Keep current v1 observation schemas unchanged. A later implementation defines
exact schemas and negotiation alongside [lifecycle contracts](../api/lifecycle-contracts.md).

| Interface              | Required meaning                                                                                                                                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OptimizationRequest`  | Contract/version, task/attempt and native-session references, authorized mode, local permission-scope reference, task risk/complexity evidence, capability snapshot, immutable protected instruction blocks, scoped source references, target budget and billing/model context when known      |
| `OptimizationPlan`     | Planner/strategy version, effective mode, retained/removed/reference-resolved blocks with reasons and hashes, protected-content integrity evidence, source/scope boundaries, original-to-result mapping, estimated usage explicitly qualified, overhead estimate and fallback/rejection reason |
| `OptimizationEvidence` | Matched baseline/attempt identity, prompt hashes, provider/model/configuration provenance, actual normalized input/output/cache usage when exposed, optimizer/summarizer/router usage, wall time, retries/repairs/failed attempts, task-validation outcomes and limitations                    |
| `OptimizationPolicy`   | Allowed transformations by task/provider, risk exclusions, quality thresholds, resource bounds, data retention, rollout and fallback rules; a policy reference is not authorization                                                                                                            |

Requests fail closed for missing required authority. Plans may decline optimization
without declining the user's task. Applying a plan checks the same source version,
authorization and task scope used during planning; stale content/grants invalidate
the plan. An estimate is not evidence of success or permission to exceed a budget.

## Integration responsibilities

| Future consumer          | Contract                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent adapters           | Advertise which user/context/tool-output/verbosity/cache controls really exist for the provider version; preserve native usage semantics           |
| Intelligent Agent Router | Supply model/capability/budget constraints and receive plan evidence; model-routing savings must be tested separately from fixed-model compression |
| Orchestration Engine     | Bind a plan to task/attempt and permissions; include delegation, retries, repairs and summarization in net usage                                   |
| Observability dashboard  | Show mode, applied transformations, fallback, quality, coverage and measured/estimated/unavailable values; no unconditional savings badge          |
| Token/cost analytics     | Deduplicate native usage, preserve cache-read/write distinctions and billing provenance, include optimizer overhead and failed attempts            |

These consumers are future boundaries, not claims that routing, execution or an
orchestrator exists in the current repository. Passive observation can display
native usage but cannot retroactively optimize another CLI's private context.

## Safety and correctness invariants

- Preserve instruction priority and exact required/security constraints. Duplicate
  prose is not automatically redundant if role, authority, scope or provenance differ.
- Deduplicate only immutable content snapshots proven identical in source/version,
  access scope, role and content. Do not collapse repeated tool/log events,
  identifiers, errors or causally distinct results merely because text matches.
- Never remove tenant/ACL rules, negative requirements, exceptions, tool schemas,
  pending approval context, correlation IDs or necessary source/code dependencies.
- Selection must have a verifiable relevance/dependency basis and a way to retrieve
  omitted content. Unknown relevance retains content. A repository map does not
  replace full code needed for edits, tests or security decisions.
- Summaries/compressed text remain untrusted derived data, retain source pointers
  and must not acquire instruction authority. Lossy strategies need a separate
  quality gate; a compressor may omit a rare constraint even at a good ratio.
- Tool-output optimization must preserve status, exit code, truncation/gap markers,
  necessary diagnostics and retrieval paths. It must not hide failures to look concise.
- Concise responses must still deliver required code, tests, evidence and outcomes.
  Do not alter a benchmark's task/output requirements between modes.
- Preserve cache-stable prefixes where possible. Fewer input tokens can increase
  uncached spend; cache reads are not an extra term added to an inclusive input total.
- Stay local by default. A third-party compression service requires separate privacy
  authorization; no optimizer text may leak through Cloud logs/telemetry/caches.
- Native source history and existing ORQST data are not rewritten by optimization.

## Evidence and activation gates

Use equivalent tasks/model/configuration, record hashes and rotate run order.
Count all reported provider input/output tokens, including failed attempts and
repairs, plus any model-based optimizer/router calls. Label provider-internal
retries unavailable when not exposed. Measure local compressor time/memory where
relevant; these are not tokens. Cache state and model-server variability must be
reported rather than assumed controlled.

Validate functional and negative/security cases independently of generated claims.
Task success requires more than the model saying it followed instructions. Retain
failures and token-growth cases. Reject a benefit claim for failed or incomparable
pairs; show raw consumption separately from quality-qualified subsets.

Before production: representative repository/framework workloads, complete edit/
build/test cycles, multiple runs/models/provider versions, cache-aware cost
analysis, quality non-regression and adverse-case validation. Establish thresholds
and uncertainty with evidence. Limited synthetic fixtures do not prove general
code quality, reliability, real-project savings or a production-safe default.

Review implementation and model-weight licenses separately, including transitive
packages, notices and downloads. This experiment independently implements simple
transformations; it does not copy LLMLingua or Aider code or install their models.
