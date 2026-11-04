# Approved V6 product reference — 2026-11-04

The owner approved `ORQST_V6_FEATURES_PACOTE_CODEX.zip` as the official UI/UX and
functional architecture reference. V6 supersedes earlier specifications wherever
requirements differ. Preserve existing implementation and historical evidence;
the package describes requirements, not capabilities already accepted.

## Original sources

All six files are preserved byte-for-byte under `source/`. Their original language,
older internal V5 headings, illustrative CLI/model choices and simulated content
remain unchanged. Archive and individual SHA-256 hashes are in
[manifest.json](manifest.json). Original references are excluded from automatic
formatting. They are documentation inputs, never production terminals.

- [Master specification](source/ORQST_MASTER_SPEC_FEATURES_ATUALIZADO.md)
- [MCP and features](source/ORQST_V5_MCP_FEATURES_ATUALIZADO.md)
- [UI/UX](source/ORQST_UI_UX_FEATURES_ATUALIZADO.md)
- [Agentic workflows](source/ORQST_AGENTIC_FEATURES_ATUALIZADO.md)
- [Pane communication](source/ORQST_PANE_COMMUNICATION_FEATURES_ATUALIZADO.md)
- [Approved interactive visual reference](source/ORQST_workspace_v6_features.html)

The complete sources were read before V6 implementation. The HTML was rendered and
visually inspected at 1440×900 with reduced motion: compact workspace/feature
sidebar, breadcrumb/actions, four dense docked panes, restrained purple accents
and a minimized-pane footer. That inspection validates the reference only.

## Normative interpretation

The hierarchy is **Workspace → Feature → TerminalPane → AgentSession**. Feature
is persisted, with independent configuration, terminal membership, tasks, history,
permissions, orchestration policy and docked/floating layout. Stable IDs are
distinct from display names. Context switches never start, stop or replace
Core-owned processes. Native history remains immutable.

An unqualified `@handle` resolves only within its Feature. Duplicate handles in
different Features are allowed. Cross-Feature/Workspace communication needs an
explicit destination, authority and audit. Marking an orchestrator grants nothing.
The existing Core queue, grants, PTY and provider adapters remain authoritative;
MCP and UI are clients, not alternate engines. Do not intercept all PTY typing
to implement mentions. Admission, provider acceptance, execution and verified
result remain separate states, including unknown outcomes.

Match the supplied visual reference. Retain native CLI rendering/output, show only
verified model capabilities, and animate actual Core events with reduced-motion
support. A/B and current concurrency bounds are implementation limits, not product
hierarchy. Do not copy the prototype's fake activity into runtime.

See the [V6 capability matrix and acceptance checklist](../../architecture/v6-feature-checklist.md)
and [reuse review](../../research/v6-feature-foundation.md).
