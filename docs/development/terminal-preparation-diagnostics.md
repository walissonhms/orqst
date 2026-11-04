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
