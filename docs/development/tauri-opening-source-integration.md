# Tauri opening source integration — 2026-11-04

This source delivery integrates the UI-lock and admission/startup increments on
published baseline `19f68b4c6c66368f636ea047ebe8da5918ec73aa`. It does not establish
the cause of the historical alert/hang, change the open Preview app or accept
native/provider opening.

| Original candidate                         | Integrated commit | Scope                                                                                       |
| ------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------- |
| `128f16ac9b3dfa3431ed2e770846fc78539a157e` | `029eae6`         | Release state before native UI getters; revalidate metadata context and request ownership   |
| `72a0189640a5698e5655d0012493d0e8c4ac835d` | `5e2b034`         | Passive reservation preflight, bounded startup failure, keyed append and reader EOF cleanup |

The combined code freeze is `5e2b03454f336d0d7417ffa2565a3b25262226f8`.
The delivery tag `delivery/2026-11-04-tauri-opening-source` also includes this
integration documentation; subsequent logger work must use the combined source.
This tag identifies source delivery, not a package or release.

## Integration review

The only conflict was the reader's captured identities in `terminal.rs`. The
resolution retains both the metadata reply epoch and host owner/epoch/initial
files. Preparation and Features snapshot their state, release mutexes before
native document getters, then revalidate. Metadata reply consumption preserves
the document/version, generation and exact pending-request Arc checks after the
getter wait. Getter-free final checks retain the existing documented lock order.

Append validates native owner/epoch/initial files and presentation/revision before
dispatch, and the original outstanding request after asynchronous boundaries.
A legitimate authoritative receipt can advance membership/layout revisions.
An old append result cannot clear a new Core or request's latch. Reader EOF takes
only its matching host atomically under Terminals, then stops outside the guard.
An exact source comparison confirmed that `stop_running` retains the baseline
cleanup body byte for byte. Public Stop retains its intentional unconditional take.

The existing pinned [UI-lock research](tauri-ui-locks.md#reference-research-and-reuse-decision)
and [admission research](../research/terminal-admission-diagnostics.md) were reviewed
against the separate Anywh `546f189c` and Tucano `0501956d` checkouts: architecture,
Agent Host/runtime contract, sidecar locking/identity, failure types and CLI parser
error projection. Root Apache-2.0 LICENSE hashes match the existing records; neither
pinned tree contains NOTICE/COPYING. No upstream source, asset or dependency is
incorporated by integration. Repository-local instruction and historical architecture
documents were read; their unversioned copies remain unchanged.

Security review: no HTTP/WebSocket, cookie, CSP, observer or execution authority is
added. Native-only identity remains private. Startup UI receives only fixed
stage/code/effects, preserving `possible` for uncertain effects. Existing reservations,
manifests, journals, quarantines and apps are preserved. No reconciliation, adoption,
signal, reset or release of human capacity occurred.

## Current checks

Existing Node 24.22.2, pnpm 10.34.9 and Rust 1.99.1 were reused without installation,
dependency duplication or Cargo target creation. Every command below passed:

```sh
pnpm lint
pnpm typecheck
pnpm exec tsx --test --test-reporter=spec --test-name-pattern='^(?!private )' tests/terminal-admission-inspection.test.ts tests/terminal-startup-failure.test.ts tests/terminal-selected-preparation.test.ts tests/terminal-enrollment-client.test.ts tests/terminal-team.test.ts tests/interactive-profile.test.ts tests/tauri-studio.test.ts tests/tauri-studio-preparation-ui.test.ts tests/tauri-terminal-preparation.test.ts tests/terminal-enrollment.test.ts tests/managed-terminal-pair.test.ts tests/feature-view.test.ts tests/tauri-terminal-layout.test.ts
RUSTC=/path/to/existing/rustc node scripts/test-tauri-ui-locks.mjs
rustc --edition=2021 -D warnings --test apps/tauri/src-tauri/src/terminal_admission.rs -o /temporary/directory/tests
/temporary/directory/tests
rustfmt --edition 2021 --config skip_children=true --check apps/tauri/src-tauri/src/terminal_creation.rs apps/tauri/src-tauri/src/features.rs apps/tauri/src-tauri/src/terminal.rs apps/tauri/src-tauri/src/terminal_admission.rs tests/native/tauri-ui-locks.rs tests/native/tauri-metadata-locks.rs
git diff --check
git diff --cached --check
```

The combined Node run passed **187 distinct cases**, zero failures/cancellations/skips.
Log review showed that the requested negative-lookahead name filter did **not**
exclude four existing private helper subprocess cases or the private-metadata
namespace case. Those cases ran and passed; they are not described as excluded.
The four helpers use disposable synthetic homes/manifests and intercepted IPC
review answers, with no real consent, app, Core, PTY or provider. Other cases use
fake inherited IPC/fork, in-memory backends and metadata services. Test bundling
creates only disposable fixture output, never product resources/packages. The
isolated candidate's earlier exclusion claim is not relied on for this delivery.
The Rust checks passed **5 extracted production lock/metadata cases + 3 production
identity-gate cases** with `-D warnings`; temporary harness/binaries were removed.
They do not compile the full Tauri crate or validate real Tokio/WebKit/schema dispatch.

Before committing the first slice, its 5 Rust cases, 28 focused Node cases,
full lint/typecheck, rustfmt and diff checks also passed. Those preceding results
are not added to the combined 187-case count. Final documentation receives its own
format and diff check. Initial default Node/pnpm discovery selected incompatible
versions; selecting existing Node 24/pnpm 10 corrected the environment without
changing project dependencies. Available disk remained approximately 25 GiB.

## Remaining gates

- Logger writer/API/hooks are separate work; no logger candidate is included here.
- Full Cargo/native compilation, Clippy, product build/resources/bundle and packaging
  await logger integration, review and a final shared source freeze to avoid two builds.
- Full `pnpm test`, browser tests, `validate:local`, application/Core/PTY/provider
  startup, real consent and native/platform acceptance were not run. Ingestion is unchanged.
- Historical cause and any review of old reservations remain unresolved. Ready or
  admitted metadata never proves provider execution, effective model or process exit.
- Closed source worktrees may be removed only after original/integrated commits are
  preserved remotely, clean status and absence of active work are confirmed. External
  logs/evidence and logger worktrees remain protected.
