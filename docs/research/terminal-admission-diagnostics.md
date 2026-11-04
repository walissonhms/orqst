# Admission diagnostics reference review — 2026-11-04

Baseline `19f68b4`; review is static source at the pinned revisions below. Existing
separate research checkouts were used without starting upstream software. ORQST's
AGENTS, current overview/managed-terminal design, reuse audit and approved V6 source
package were consulted. The historical `docs/architecture/implementation-plan.md`
and `tucano-audit.md` named by AGENTS are not versioned in this baseline; their
local owner-supplied copies were read during integration and remain unchanged. The current implementation remains the source of truth.

- [Anywh architecture](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md),
  [Agent Host](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md)
  and [runtime contract](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md)
  were checked before the implementation sources.
- [Anywh runtime types](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/types.ts):
  `RuntimeFailure`, `FailureClass`, `classifyFailure` separate error classification
  from drivers, but carry free-form text and provider categories, not ORQST's
  reservation/effect evidence. Dependencies: TypeScript runtime contracts and their
  existing driver/host consumers. **Keep ORQST's private startup transport**, with
  bounded schema enums derived from operation boundaries, not provider prose.
- [Anywh native sidecar](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs):
  `tailnet_sidecar_identity` returns raw failed-exit stderr. Dependencies include
  Tauri, shell plugin, serde and tokio; its tailnet process is unrelated to admission.
  **Do not copy this diagnostic output contract**: raw stderr may expose private
  paths/configuration. Retain the existing ORQST Node/PTY owner and bounded failure.
- [Tucano Codex engine](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/codex.ts):
  `codexParser().end` appends `lastLines(stderr)` to an error if a turn ended without
  a reply. Dependencies: fs/os/path, smol-toml, `engines/cli.ts`, engine types and
  shared localization. **Keep ORQST**: ephemeral turn output does not prove native
  preparation, admission, execution, exit or ownership, and unrestricted text is
  incompatible with this UI diagnostic boundary.

Exact root [Anywh LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
and [Tucano LICENSE](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE)
were re-read: Apache-2.0. The pinned Git trees have no NOTICE/COPYING paths. Selected
source headers were inspected; no new upstream code, assets or dependencies are
incorporated. Existing attribution remains unchanged. Overclock is a UX reference;
no source/license grant or source reuse is inferred.

The earlier read-only investigation supplies a supported hypothesis: a new selection
may have reached startup and encountered an older reservation, then lost its reason
across generic errors. There is no correlated historical startup frame proving that
this caused the first alert, and this patch does not prove a historical deadlock.
