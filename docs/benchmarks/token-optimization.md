# Token optimization — research and benchmark

## Status and conclusion

Phase 0 research completed on 2026-11-02 using the `e2f4896` application baseline.
The standalone experiment does not implement a production optimizer, change
provider adapters or start Phase 1. [Architecture and integration contracts](../architecture/token-optimizer.md)
and [ADR-025](../architecture/decisions.md#adr-025--independent-token-optimizer-and-evidence-gated-activation)
define the future boundary.

**Measured on these synthetic tasks:** Economy used 5.975% fewer total reported
provider tokens; the guarded Intelligent prototype used 8.768% fewer. All 42
selected executions passed their bounded scenario checks. These are observed
Codex usage differences, not character-count estimates, monetary savings or
verified production gains. The artificially duplicated context, narrow tasks and
limited quality oracles substantially limit generalization. Keep production
optimization inactive until representative correctness and net benefit are proven.

The [sanitized measurement data](token-optimization-results.json) includes every
selected row, six invalid initial PHP-scoring rows, checks, hashes, timings, cache
counts and the computed summary. No raw session, response, prompt transcript,
credential or real project data is included. Synthetic fixture source is public.

## Research findings and licensing

Sources were inspected on 2026-11-02. Third-party implementations are references;
no code or model weights were copied, installed or added to production dependencies.

| Technique                         | License / compatibility                                                                                                                                                        | Performance and correctness/security assessment                                                                                                                                            | Experiment status                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Microsoft LLMLingua / LLMLingua-2 | Engine MIT; inspect each weight/dependency separately. The selected XLM-RoBERTa MeetingBank model card also declares MIT. Python/model runtime is separate from the Node Core. | Token selection can remove rare constraints or necessary code. Requires local compute, model downloads and task-specific quality/overhead evidence; upstream ratios are not ORQST results. | Researched, not installed or timed                               |
| Aider repository map              | Apache-2.0 reference; any reuse requires notices/dependency review. An independent selector need not import Aider.                                                             | Dependency-graph-ranked context within a budget is a useful direction. A map does not replace edit targets or full dependency/security context.                                            | Researched; no Aider graph/map benchmark                         |
| Exact context deduplication       | Independent implementation using existing Node APIs                                                                                                                            | Collapse only identical immutable snapshots with source/version/scope/role evidence; preserve repeated events and protected blocks. Hashing/selection time is measured locally.            | Economy prototype                                                |
| Selective repository context      | Independent design; future parser/index dependencies need review                                                                                                               | Trusted relevance metadata can remove optional unrelated material. Production needs actual dependency/retrieval coverage and fallback, not an oracle marking files irrelevant.             | Guarded Intelligent fixture prototype                            |
| Lossy prompt compression          | Depends on implementation and weights                                                                                                                                          | Compression ratio alone says nothing about code integrity, instruction priority or downstream repairs. Never treat compressed material as higher-priority instructions.                    | No learned compressor; negative loss canary only                 |
| Context summarization             | Provider/model terms plus local implementation                                                                                                                                 | Summary generation consumes tokens and can omit exceptions; retain verifiable source references and measure summary/repair usage in the total.                                             | Not benchmarked                                                  |
| Tool-output optimization          | Provider interface plus local implementation                                                                                                                                   | Bound large outputs while retaining exit status, errors, correlations and full-output retrieval. Removing repeated log lines can change event meaning.                                     | Not benchmarked; repeated-log preservation tested                |
| Provider-native caching           | Provider feature, not a generic open-source compressor                                                                                                                         | Preserve compatible prefix structure. Cached input may lower latency/cost without removing logical input tokens. Provider-specific cache read/write accounting must remain distinct.       | Native cache counts observed, not controlled or ablated          |
| Concise responses                 | Task/provider capability, not a separate library                                                                                                                               | Keep required code, tests and results. Do not suppress errors or impose different output requirements across benchmark modes.                                                              | Same bounded output contract in all modes; no verbosity ablation |

Primary references:

- [LLMLingua source at 5a4c78a](https://github.com/microsoft/LLMLingua/tree/5a4c78ae18ab17a98cf997e8259354e546081d64),
  [MIT license](https://github.com/microsoft/LLMLingua/blob/5a4c78ae18ab17a98cf997e8259354e546081d64/LICENSE),
  [runtime dependencies](https://github.com/microsoft/LLMLingua/blob/5a4c78ae18ab17a98cf997e8259354e546081d64/setup.py)
  and [Microsoft model card](https://huggingface.co/microsoft/llmlingua-2-xlm-roberta-large-meetingbank).
  The package declares PyTorch/Transformers and other Python dependencies; their
  resource, license and supply-chain implications need a separate integration review.
- [Aider repository-map design](https://aider.chat/docs/repomap.html) and
  [Apache-2.0 license at 5dc9490](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/LICENSE.txt).
- [Official Codex non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode)
  documents JSONL usage and structured output. Installed CLI help was also checked.
- [OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching)
  describes rendered-prefix reuse and how changed context/settings can affect it.
- [Claude caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
  separates uncached input, cache creation and cache reads. Do not apply the Codex
  inclusive-input formula blindly to Claude's raw API fields.
- [Claude programmatic interface](https://code.claude.com/docs/en/headless) and
  [OpenCode SDK](https://opencode.ai/docs/sdk/) provide candidate structured surfaces.
  They were not executed in this benchmark; only controls actually exposed by a
  validated adapter can be optimized. ORQST cannot rewrite a native CLI's private
  context or claim cross-provider support from these documents alone.

## Environment and isolation

- macOS arm64; Node 24.22.2; pnpm 10.34.9; Codex CLI 0.162.1.
- Requested model: `gpt-6.1-sol`, reasoning effort `low`, fixed across conditions.
  The stream does not expose an immutable model snapshot; alias/server variability
  is a limitation. No temperature/seed setting was assumed available.
- PHP 7.4.33 was detected and used only for `php -n -l`. No Laravel application
  or framework version was installed/assumed. React context is a pure typed
  view-model task; no full React application was mounted.
- Existing esbuild and Playwright/Chromium validate synthetic candidate artifacts.
  Generated TypeScript is transpiled in Node and executed only in a fresh browser
  context without host bindings, with no granted permissions and blocked network/
  connect policy. PHP is grammar-checked and linted, never executed as generated PHP.
- Native calls use a temporary workspace, read-only sandbox, `--ephemeral`,
  `--ignore-user-config`, hooks/plugins disabled, the same output schema and no
  requested tools. All selected runs reported zero tool calls. Tool avoidance is
  checked, not claimed as a CLI-wide tool-disable mechanism.
- Fixtures are supplied from this benchmark only; no application database, native
  source history or real repository content is read. Native harness/system/tool
  overhead is included in reported input usage and is not separately tokenized.
- No benchmark code is imported by ORQST or automatic test/CI commands. Normal
  application functionality, data, dependencies and current API contracts remain intact.

## Methodology

Seven fixed synthetic scenarios × three modes × two repetitions produce 42
selected executions (14 per mode). Rotate mode order by scenario/repetition;
execute sequentially to avoid concurrency changing the task. Two repeats do not
fully counterbalance all positions or establish a confidence interval. Prompts,
protected instruction hashes and fixture digest are recorded.

All modes have identical tasks, protected instructions, requested model, schema,
reasoning effort and sandbox. Only supplied context snapshots differ:

- Disabled retains all three identical required-source snapshots and an unrelated
  synthetic theme inventory.
- Economy keeps one identical required-source snapshot, retaining the inventory.
- Intelligent additionally omits the inventory only for explicitly trusted,
  optional/unrelated fixture metadata on low-risk tasks. PHP, long-context and
  multi-step tasks fall back to the exact Economy prompt. This is a conservative
  metadata-driven prototype, not learned adaptive intelligence.

This fixture intentionally contains redundancy to make a deterministic experiment
possible. It is not representative evidence of how often real agent harnesses
supply such snapshots. The selector has no actual repository graph or retrieval
model. Do not reuse its fixture relevance labels as a production relevance policy.

Measure `turn.completed.usage` from each native execution. Normalize inclusive
input and output as `total = input + output`; cached input is a subset and is not
added again. Preserve reported cache-write/reasoning details separately without
adding subsets to totals. Missing metrics stay unavailable. No character-to-token
heuristic or tokenizer estimate is used for the headline savings.

Wall time covers native CLI/provider execution, not pure model generation.
Optimizer preparation time is recorded separately. Harness retries/repairs are
zero; provider-internal retries are unavailable, not assumed zero. No model is
called for the optimizer itself. Monetary cost is unavailable because no validated
billing/model-rate mapping was supplied; subscription usage is not assumed to be
pay-as-you-go API spend.

`reduction_pct = 100 × (baseline_total − optimized_total) / baseline_total`.
Aggregate percentages use sums of the same quality-qualified pairs, not an
unweighted average of scenario percentages. Failed or missing-quality pairs do
not qualify as benefits; raw consumption is retained separately.

## Actual provider measurements

Totals below cover the 42 selected, quality-qualified executions. Cache writes were reported as zero. The runs reported 168 reasoning-output tokens
already included in the 6,261 output-token total; they are not added again.
Unknown retries remain unknown. Output uses the provider's inclusive category. Times vary with
network/provider state and do not demonstrate an inference-speed improvement.

| Mode                  | Runs passing bounded checks | Input   | Output | Total   | Cached input subset | Native wall time, summed seconds | Total-token reduction |
| --------------------- | --------------------------- | ------- | ------ | ------- | ------------------- | -------------------------------- | --------------------- |
| Disabled              | 14/14                       | 305,300 | 2,139  | 307,439 | 17,408              | 123.360                          | Baseline              |
| Economy               | 14/14                       | 287,008 | 2,062  | 289,070 | 69,632              | 102.022                          | 5.975%                |
| Intelligent prototype | 14/14                       | 278,424 | 2,060  | 280,484 | 69,632              | 103.611                          | 8.768%                |

Input reductions were 5.991% and 8.803%. Supplied prompt-byte reductions were
40.284% and 59.986%, much larger than total-token reductions because native harness
overhead remains. Byte reduction is an offline context-size measurement, not a
provider-token or cost estimate. Total optimizer preparation across 14 runs was
1.125 ms Disabled, 1.688 ms Economy and 1.201 ms Intelligent on this small fixture;
these timings do not characterize large-repository indexing or learned compression.

### Per-scenario comparison

Values are mean reported total tokens over two executions per condition. Exact
input/output/cache/timing/quality for every execution is in the linked JSON.

| Scenario                            | Disabled | Economy  | Economy reduction | Intelligent prototype | Intelligent reduction |
| ----------------------------------- | -------- | -------- | ----------------- | --------------------- | --------------------- |
| PHP/Laravel-style query             | 20,287   | 20,043   | 1.203%            | 20,043                | 1.203%                |
| React/TypeScript selector           | 20,268   | 20,065.5 | 0.999%            | 19,006.5              | 6.224%                |
| Bug fixing                          | 20,388.5 | 20,157.5 | 1.133%            | 19,115                | 6.246%                |
| Code review                         | 20,302   | 20,090.5 | 1.042%            | 19,005.5              | 6.386%                |
| Documentation                       | 20,386   | 20,133.5 | 1.239%            | 19,067                | 6.470%                |
| Long context                        | 31,577   | 23,781   | 24.689%           | 23,781                | 24.689%               |
| Multi-step parse/validate/aggregate | 20,511   | 20,264   | 1.204%            | 20,224                | 1.399%                |

The long-context duplicated snapshot dominates the aggregate benefit. Intelligent
and Economy have identical protected/context prompts on guarded tasks; small
output/time differences are provider variability, not evidence of extra Intelligent
reasoning. In multi-step repetition 2, Intelligent used 22 more total tokens than
Economy despite identical prompt hashes. No selected optimized pair grew relative
to its Disabled baseline, but one strategy is not uniformly best relative to the other.
Cache-hit state was not controlled; the different cached totals preclude a causal
claim that these token percentages equal monetary savings.

## Quality validation and failed experiments

| Scenario               | Independent bounded checks                                                                                                                              | What remains unverified                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| PHP/Laravel-style      | Restricted Eloquent expression grammar with bound tenant/status predicates and order; reference-row scoping; PHP syntax lint                            | Real Eloquent execution, Laravel integration, SQL and authenticated HTTP behavior                           |
| React/TypeScript       | Transpilation and browser execution of selector: tenant isolation, finished-task exclusion, stable order, empty cases, frozen input and object identity | Full TypeScript semantic checking of generated artifacts, React rendering/hooks and application integration |
| Bug fixing             | Cumulative/mirror deduplication, unordered rows, multiple/empty session IDs, nonfinite/negative/fractional values and input immutability                | Every provider usage shape and real application accounting                                                  |
| Code review            | Exact known findings, correct files and substantive remediation                                                                                         | Unknown-bug discovery; finding IDs are supplied, so this is a scoped remediation task                       |
| Documentation          | Exact commands/runtime, loopback, read-only/no-Cloud and notification-permission boundaries; no selected unsupported-feature phrases                    | Exhaustive semantic correctness and human editorial quality                                                 |
| Long context           | Four exact policy values, legal-hold exception, fail-closed tenant policy and no native-history deletion                                                | Arbitrary long-context code reasoning or lossless semantic compression                                      |
| Multi-step programming | Parse/validate/aggregate function, malformed inputs, null/arrays, no numeric coercion, prototype-safe tenant keys and immutability                      | Autonomous multi-turn agent workflows or a full repository edit/build/test cycle                            |

Protected instructions and original required source content remain byte-for-byte
present in every optimized prompt; unit checks verify this, provenance-sensitive
deduplication and risk/unknown-selection fallbacks. Bounded output checks do not
prove that every important instruction is semantically followed in all situations.

The initial six PHP runs failed an overly strict evaluator: it required a statement
semicolon even though the task requested an expression, and exact fact strings
instead of labels followed by explanations. A diagnostic response showed this
format mismatch. The evaluator was corrected, with negative tests still rejecting
a missing tenant predicate. Only those six cells were rerun with unchanged prompts,
model and configuration. The 36 non-PHP checks are unchanged. Initial PHP scoring
rows remain in `excludedScoringRows`; they are not silently rescored or presented
as confirmed model failures. The diagnostic is not part of the comparison.

A deliberately lossy offline canary substituted 30 for the 365-day legal-hold
exception and was rejected. Broken artifacts and missing required labels are
rejected across all seven scenarios. These are regression tests, not an actual
LLMLingua evaluation. Never claim savings for such failed outputs.

Resource accounting retains 48 benchmark calls (42 selected plus six invalid
initial scoring cells) and two diagnostic calls. They consumed **1,036,384 total
reported provider tokens**, including 120,758 in excluded scoring cells and 38,633
in probes/diagnosis. This is experiment consumption, not saved production usage.
There were no harness retries; the six replacement cells are explicit scoring
re-experiments, not hidden repairs. No provider-internal retry count or dollar
cost is inferred.

## Reproduction

Use the repository's required Node 24/pnpm toolchain and existing dependencies.
Chromium is needed for the browser quality checks; install it through the existing
Playwright setup if missing. PHP lint requires a compatible local `php` command.
Do not change a global PHP/runtime or install Laravel merely to reproduce this
restricted fixture. Public reproduction must never use real captured sessions.

```bash
# Deterministic prototype/quality regressions; no model requests
node --test scripts/benchmarks/token-optimization/benchmark.test.mjs

# Offline: prompt bytes/hashes only, usage and model quality remain unavailable
node scripts/benchmarks/token-optimization/run.mjs \
  --output /tmp/orqst-token-offline.json

# Explicit provider execution: consumes real usage with the existing Codex login
node scripts/benchmarks/token-optimization/run.mjs \
  --live --model gpt-6.1-sol --repetitions 2 \
  --output /tmp/orqst-token-live.json

# Summarize measured pairs, retaining quality exclusions
node scripts/benchmarks/token-optimization/summarize.mjs /tmp/orqst-token-live.json
```

Optional `--scenario php-laravel` reproduces just that scenario. The current
corrected evaluator should not need the initial scoring rerun. `--timeout-ms`
(default 60,000; maximum 120,000) bounds each CLI process. The reported-token guard
(default 1,500,000) stops admission after the reported threshold; it is not a
hard provider spending cap and cannot bound an in-flight request's unreported use.
Outputs are aggregate/hash/quality records, not raw responses. Treat any new live
benchmark as explicit developer work, never automatic CI or application startup.

The public result combines six corrected PHP measurements with the original 36
non-PHP measurements; each pair uses the same evaluator version. Reproduction
recomputes the same fixture/task conditions, not identical model outputs, cache
state, time or exact numerical savings. Model/config/provider availability can vary.

## Verification in this change

Executed successfully: `pnpm lint`, `pnpm typecheck`, `pnpm test` (25 existing
application tests), `pnpm build`, and the standalone benchmark test command
(10 optimizer/quality/accounting tests). The live comparison above used 42
selected executions, with invalid initial scoring cells and diagnostics retained
in experiment accounting. Offline prompt comparison was also executed.

The existing application Chromium suite and real-history ingestion acceptance were
not rerun for this isolated experiment. Browser functional checks described here
exercise synthetic benchmark candidates, not the application UI. No Claude Code,
OpenCode, LLMLingua, Aider or full Laravel/React integration benchmark was run.

## Recommendations before production

1. Preserve an independent optimizer plan/evidence boundary during future Core
   design. Start with exact immutable-snapshot deduplication and protected-context
   assertions; do not enable transformations during Phase 1 extraction.
2. Validate relevance/dependency coverage on real, explicitly authorized repositories
   before selective context. Include rare exceptions, conflicting instructions,
   generated/binary files, mixed tenants, source changes and missing retrieval.
3. Add complete Laravel/React edit/build/test workloads and multi-turn tasks with
   repairs and total-usage accounting. Repeat across provider versions, workloads
   and controlled cache conditions with sufficient samples for uncertainty.
4. Compare cache-aware costs separately from raw token counts using verified rates
   and billing modes. Include summaries/router/compressor calls, failures, repairs,
   local compute and latency; make unknown measurements visible.
5. Keep LLMLingua/model compression optional research until resource, weight/license,
   security and task-quality evidence justify a local integration. Do not copy Aider
   code or add heavy dependencies merely to implement a repository-selection idea.
6. Gate the intended safe managed-session default on representative correctness and
   measurable net benefit, with opt-out, traceability and conservative fallbacks.
   External sessions remain unchanged without explicit authorization.

The current evidence supports continuing conservative research. It does not
justify automatic production activation, a general percentage savings promise,
full cross-provider support or Phase 1 implementation.
