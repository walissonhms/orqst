# Terminal preparation failure boundaries — 2026-11-04

Baseline: `d7f09da`. The owner confirmed that the failed Codex `gpt-6.1-sol`
opening reached configuration confirmation. This does not identify the historical
failing stage or establish absence of writes. The active Preview is from
`a48bce0`; it was neither operated nor replaced by this source change.

## Source findings

`tauri-terminal-preparation-host.ts` discarded every caught exception and emitted
one generic stderr line. `terminal_creation.rs::run` discarded stderr, and
`execute` showed the same refusal/uncertainty text for all failures. The generic
message incorrectly prescribed an empty project for normal workspace-bound
selection; only the advanced unbound path has that requirement.

`prepareTauriTerminals` recomputes the catalog before selection and after native
review. A mutable model source can therefore cause a pre-provision refusal. The
synthetic regression changes a native config during review and proves zero commit
calls and zero terminal files. This is a regression scenario, **not the proven
cause of the owner's attempt**. Discovery, catalog identity, model selection and
OpenCode profiles belong to the separate coordinated change. Do not remove either
revalidation, refresh a selection silently or retry an old request to mask drift.

## Reference inspection and decisions

The existing separate research checkouts were read without running an upstream
runtime. Required Anywh `docs/architecture.md`, `docs/agent-host.md` and
`relay/src/runtimes/README.md` were consulted, followed by the actual sources.

- [Anywh `tailnet_sidecar.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs):
  `tailnet_sidecar_identity` returns raw sidecar stderr on failed exit. Dependencies:
  Tauri, serde, tokio and the shell plugin. **Keep ORQST's existing sidecar boundary**;
  raw stderr may contain paths, configuration or credentials and is unsuitable for
  this diagnostic contract.
- [Anywh runtime types](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/types.ts):
  `RuntimeFailure`, `FailureClass` and optional `classifyFailure` separate failure
  classification from driver effects. **Keep ORQST**; provider error classification
  does not prove whether native provisioning or Core admission already had effects.
- [Tucano Codex engine](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/codex.ts):
  `codexParser().end` appends `lastLines(stderr)` when a turn exits without a reply.
  Its `EngineEvent` in `src/core/engines/types.ts` permits arbitrary error messages.
  Dependencies include its CLI engine/child stream helpers and shared localization.
  **Do not use**; ephemeral turn failure and unrestricted stderr display cannot
  establish ORQST ownership or native effect boundaries.

Exact root LICENSE files were re-read at these revisions; both are Apache-2.0.
`git ls-files '*NOTICE*'` returned no paths in either checkout. No new upstream
source/assets/dependencies were incorporated. Existing ORQST attribution remains.
Overclock remains a UX reference only; no source/license or asset reuse is inferred.
