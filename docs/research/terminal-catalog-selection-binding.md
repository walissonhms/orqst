# Selected terminal catalogue binding — 2026-11-04

Baseline: `df0da2cf02c0a7ae046281b978740a423bb9535b`.

## Evidence and reproduced defect

The owner reported opening `dist/native-preview-policy-notifications/ORQST Preview.app`,
then **+Terminal → Codex CLI → gpt-6.1-sol → Open**. The reported alert identifies
`stage: catalog`, `code: catalog_changed`, `effects: not_started`. This establishes
that this attempt was refused before provisioning/runtime opening. It does not
establish effects, or their absence, for any previous attempt.

Three isolated synthetic regressions run against the exact baseline source each
reproduce `Terminal preparation catalog: catalog_changed` at create-selected:

1. Only `models_cache.json.fetched_at` changes while a configured gpt-6.1-sol is selected.
2. Only another cached model's slug changes.
3. Only the unselected Claude executable is removed.

`terminalPreparationCatalog` hashed `[workspace.fence, feature.revision, providers]`.
Each `providers.models.options[].selection.files` included every provider source
file, including Codex `models_cache.json`, even for native-config/default choices.
Thus changing fetched_at changed its full file SHA, all Codex model IDs, and the
aggregate catalogId. Removing Claude changed providers and catalogId independently.
The original comparison rejected before resolving the selected Codex option.

The native `terminal_creation.rs::run` uses the same fixed helper/argv and filtered
environment for catalog and create-selected; `tauri-terminal-preparation-host.ts`
passes the same trusted context and environment to both paths. No static UI/host
context discrepancy was identified. Provider ordering is fixed; current time was
not directly hashed, but cache fetched_at influenced both full-file SHA and expiry.

These are proven sufficient causes in source and synthetic reproduction. No live
catalogue snapshot was captured for the human attempt, so the actual changed field
in that attempt remains unproven. Other Codex panes refreshing a cache are a possible
trigger, not established historical causality. There is no evidence here of a disk,
timeout, authentication, model access or provider failure.

## Source and compatibility review

The project remains Node 24, pnpm 10.34.9, strict TypeScript 6, React 19, Tauri 2,
existing Core and node:sqlite. Existing `prepareTerminalCreation`, source readers,
native review, private host pipe, binary pins, manifest/profile validation and
launch dispatch fences are reused; no alternate runtime or model probe is added.

| Pinned source                                                                                                                                     | Functions and dependencies                                                                                                               | Decision and contract difference                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Anywh Codex definition](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/codex.ts)        | `parseCodexModelList`, `codexRuntimeDef.models`: JSON-RPC model/list IDs, labels and hidden/default filtering; runtime types             | Keep ORQST. The explicit selected model identity is useful reference, but this contract has no ORQST native snapshot, workspace/Feature fence or passive cache proof.                                       |
| [Anywh model probe](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/probes/modelCatalog.ts)    | `probeModelCatalog`: child_process.spawn, `buildChildEnv`, runtime executable resolution, 15-second probe lifecycle                      | Do not import. Active app-server/CLI probing is outside passive discovery and this task's authority. Its per-runtime HOME/cwd also cannot replace ORQST's trusted context.                                  |
| [Anywh selectable agents](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/selectableAgents.ts) | `refreshSelectableAgents`, per-agent catalog publication, asynchronous probe tracking                                                    | Keep ORQST. Independent provider publication supports separating unrelated evidence, but it supplies neither immutable native review nor selected-source revalidation.                                      |
| [Tucano Codex engine](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/codex.ts)                  | `userCodexProvider`, `codexEnv`, `codexArgs`: fs, smol-toml, CLI helper; explicit `-m turn.model`, isolated HOME and ephemeral execution | Do not import. It rebuilds executable turns and provider configuration rather than preparing ORQST's same-user interactive CLI. It provides no compatible passive catalogue snapshot/revalidation contract. |

Anywh's `docs/architecture.md`, `docs/agent-host.md`, `relay/src/runtimes/README.md`
and the referenced implementation were inspected in a separate checkout at the
exact pinned SHA. Tucano's engine/types and root license were rechecked at its
exact pinned SHA. Both root LICENSE files are Apache-2.0; `git ls-files '*NOTICE*'`
returned no file in either checkout, and inspected source headers add no separate
component notice. No code/assets/dependencies are copied; ORQST LICENSE/NOTICE
remain unchanged. Overclock is only the existing visual reference: no layout is
changed, no source repository/license is assumed and no assets are incorporated.

## Correction and invariants

- `catalogId` remains a SHA-256 digest of the trusted context locations, resolved
  workspace fence and current Feature revision. Workspace identity, current view, archive status, directory/DB
  identity and Feature revision remain authoritative.
- Each opaque model choice binds its selected provider, canonical executable/path
  and reviewed hash, HOME, PATH, provider-specific native environment selectors,
  label, value, provenance and relevant configuration evidence. Other providers'
  executables/models do not enter that identity. PATH still matters because it is
  reviewed as the process tool environment, even for a fixed executable.
- Native-config/default choices retain whole hashes for all provider configuration
  files, including missing-file evidence; they do not consume models_cache. Cache
  choices additionally bind the selected visible slug/display label and exact
  cache client version. The bounded reader, permissions, no-follow/canonical checks,
  duplicate-slug rejection and 128-entry budget remain enforced. Unknown cache
  fields and other entries are not launch selection evidence.
- The 64-hex opaque choice contains a 48-bit original expiry and a 208-bit SHA-256
  evidence digest. The host reconstructs and compares it only against current
  safe discoveries. Non-cache choices encode no expiry. A cache refresh may
  increase its current freshness deadline but cannot renew the previously selected
  deadline. Removal/hiding/ambiguity, changed selected label/slug/version, older or
  expired source, changed configuration/executable/native context all refuse.
  These IDs grant no authority; native review and signed launch remain separate.
- Revalidation resolves the exact choice after native review and again after the
  asynchronous commit latch, before provisioning. Provision and the existing launch
  profile continue checking model proofs, source expiry and workspace binding.
  The native latch is never cleared or retried by this fix. Native failure handling
  still promotes effects to `possible` once its latch has committed; the passive
  helper's pre-provision `not_started` evidence cannot downgrade native authority.
- Existing manifests without semantic cache evidence still validate their original
  whole-file hashes. New cache proofs add only `files[].codexModel` within the
  private model selection schema. Public request/reply shapes and Rust validators
  are unchanged. Native review remains complete and bounded; no UI strings change.

## Verification and limits

The original three isolated tests fail on baseline source and pass on corrected
source. The focused suite covers stable choices, irrelevant cache/provider changes
before click/during review/during commit; selected cache/model/label/source/expiry,
configuration, executable, native HOME/PATH, workspace inode and Feature revision
drift at the same boundaries; unchanged MCP pair compatibility; cancellation and
signed launch refusal using a synthetic backend whose start method never executes.
A persisted cache choice is also checked after refresh and at its original expiry.

[Actual checks](../development/terminal-catalog-selection-binding.md) passed: 97
focused tests, complete TypeScript typecheck, focal ESLint/Prettier and diff checks.
No provider, probe, Core process, PTY session, application, resource staging, Cargo,
install, packaging, runtime reset or human/session state mutation is performed.
The worktree and source commit await root integration; existing apps remain intact.
Native/provider opening and effective-model acceptance require separate authorized
integration/packaging and testing. This does not promise successful real opening.

Coordination: the new report that OpenCode offers only CLI default, and that macOS
native reviews are oversized, belongs to separate work. Dynamic OpenCode discovery
would share model-selection/catalogue ownership and must preserve these selected
bindings. A smaller review surface must retain complete accessible detail and
informed confirmation; it must not weaken this transaction or block this fix.
