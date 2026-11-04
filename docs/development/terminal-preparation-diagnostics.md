# Native terminal preparation diagnostics

The passive helper reports only an allowlisted failure envelope. Stage is tracked
at the call boundary, rather than inferred from an exception's text. Before
provisioning, a known failure may report `effects:not_started`; entering provision,
inspecting created files, assigning a Feature or opening the runtime reports
`effects:possible`. This describes terminal file/runtime effects, not an assertion
that discovery never initializes metadata preferences.

The native pipe validates the exact fields and enum values. Native commit/open
latches override a helper claim of `not_started`. Missing replies, timeouts,
malformed frames, failed exits and unknown errors always remain `possible`, even
if the last observed stage precedes commit. No latch, grant, focus/generation
check, reservation or file is cleared by diagnostics. There is no automatic retry.

Normal preparation presents CLI → model → Open under the existing drawer title.
Model availability remains unverified. Technical provenance and runtime explanation
are in explicit Advanced details; abnormal catalog states and bounded localized
failure messages remain visible. Advanced manual path selection retains its empty
disposable project requirement; normal workspace binding permits a nonempty project.

Security review: this extends only the existing native IPC reply and private
helper stdout. It exposes no new HTTP/WebSocket route or execution authority.
Raw exception messages, stderr, paths, configs, proofs, PIDs and credentials are
never copied into the failure envelope. Native stderr is drained without display.

## Validation and remaining acceptance

Focused selection/IPC tests passed 12/12, passive preparation tests passed 23/23,
and static EN/PT rendering passed 1/1. The preparation suite includes disposable
passive helper subprocesses and synthetic binary pin substitution; it starts no
provider, Core, PTY or server. The first static renderer run failed because its
test incorrectly rejected the existing Advanced CSS class; the assertion and PT
fixture label were corrected, with no product guard changed. Typecheck passed
after local worktree dependency links were corrected; the first run had missing
package resolution. Full lint, typecheck, rustfmt (edition 2021) and `git diff --check` passed.

No Cargo, application build, resource staging, installation, native opening,
provider probe, credential/auth database read or Preview interaction was run.
The historical failure remains unproven; see the
[source and reuse review](../research/terminal-preparation-diagnostics.md).

## Combined source integration — 2026-11-04

Diagnostic source `dc92dd9db3fea78445d06a9aa4bf5494d642c58c` is integrated on
`f45f74004014687fbc709cf2d44e1a0654a6181b`, which already contains OpenCode source
`2db2ed0fa6b8c1d6a60daed3e28c1724bf26ae1f` as `7253c90`. README, roadmap and
changelog retain both additive histories, with diagnostics first. Production
diagnostic sources match the original delivery; discovery/model/profile sources
are unchanged by this integration.

The first combined run passed 49/50 tests. One OpenCode drift assertion still
expected the former exception text; it now checks the exact
`revalidation/catalog_changed/not_started` envelope and zero commit calls for both
changed bytes and removal. This adapts the regression to the new contract without
relaxing the executable pin, catalogue revalidation or runtime guards.

Final integration checks pass on Node `24.22.2` / pnpm `10.34.9`: 50/50 in the
combined run plus 2/2 pure OpenCode profile cases, for 52 distinct tests. The shared
selected-preparation file runs once in that final set; the four original shared
cases are not counted again. Static EN/PT rendering uses temporary test output
only. Passive helper subprocesses use synthetic pins and never start a provider,
Core, PTY or server. Commands:

```bash
pnpm exec tsx --test tests/terminal-selected-preparation.test.ts tests/tauri-studio.test.ts tests/tauri-terminal-preparation.test.ts tests/tauri-studio-preparation-ui.test.ts tests/terminal-model-selection.test.ts tests/opencode-launch-plan.test.ts tests/provider-mcp-config.test.ts
pnpm exec tsx --test --test-name-pattern='OpenCode execution requires|OpenCode MCP factory' tests/opencode-profile.test.ts
pnpm lint
pnpm typecheck
rustfmt --edition 2021 --check apps/tauri/src-tauri/src/terminal_creation.rs
git diff --check
```

Repository lint (including formatting), typecheck, Rust formatting and diff checks
pass. Rust formatting parses source; it does not establish compilation or test
success for the native failure validator.

Review confirms that unknown native transport/exit failures retain `possible`,
native commit/open evidence cannot be downgraded, and diagnostics grant no retry,
focus, input or execution authority. Raw stderr, paths, configuration, proofs and
credentials are absent from failure replies. OpenCode retains `['--standalone']`
and per-process V2 initial model defaults composed with generated MCP through
`OPENCODE_CONFIG_CONTENT`; native precedence/fallback means the effective model
and variant remain unverified. See the [OpenCode source review](../research/opencode-executable-equivalence.md).

The historical Codex failure is still unproven. Full tests/build, Cargo, resources,
installation, native UI/provider acceptance and uncertain-state recovery are
excluded from this integration. The active `a48bce0` Preview executable/resources,
earlier reservations, quarantines, fixtures and logs remain preserved.
