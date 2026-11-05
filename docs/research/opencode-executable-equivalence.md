# OpenCode executable equivalence review — 2026-11-04

Baseline: `a48bce03227fe23458f01f8e45d0d30556cc4ab6`. Scope: the existing
Tauri Studio CLI/model catalogue and selected preparation. No new adapter, session
manager, runtime, server, credential reader, API or native command is introduced.

## Existing implementation and failure

`discoverLocalClis` retains distinct canonical executable paths, deduplicating
symlink aliases but retaining separate copies and hardlinks. This is useful raw
installation evidence and remains unchanged. `discoverTerminalExecutable` checks
each candidate through `terminalExecutableSha256`: canonical native file,
`O_NOFOLLOW`, ownership, permissions, ancestor permissions, executable bit, bounded
SHA-256 and the exact provider pin. Previously every matching path was returned.
`terminalPreparationCatalog` then required exactly one path, so multiple copies of
the same reviewed OpenCode bytes produced `ambiguous_executable`. The renderer
consequently disabled Model/Open and suggested Advanced, although Advanced's legacy
`create` contract accepts only Codex/Claude. Installing OpenCode again is not a fix.

The existing OpenCode review is version `2.2.5`, SHA-256
`[historical CLI binary SHA-256 removed]`.
A package version, basename, extension, Mach-O header or inode by itself does not
establish equivalence to this pin. In particular `.exe` is not evidence of a
Windows binary; the actual file's native header and digest are checked.

The correction retains the first **successfully reviewed** OpenCode candidate in
existing canonical tool-PATH precedence, after independently checking every
candidate against that same single exact pin. This is implementation equivalence,
not a first-name-match policy. A custom environment PATH retains its order;
GUI-minimal PATH uses the existing selected/installers/system policy. Raw discovery
keeps every distinct installation. Codex/Claude selection policies are unchanged.
The native review discloses the chosen canonical executable and hash. Catalogue
rechecking detects a changed chosen path before provisioning; manifests bind that
exact path and hash, and the existing backend validates again before signed Start.
A later review may choose another equivalent copy; an already reviewed manifest
never substitutes a different path if its executable disappears or changes.
No differing hash/version is accepted, added to the pin set, or merged by this fix.

## Anywh: actual available runtime implementation

Exact source: `546f189c04415c3c5af5f40e3931a0a90b9aba31`, inspected through
its Git tree, starting with [architecture](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md),
[Agent Host](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md)
and [runtime contract](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md).
An all-tracked-files, case-insensitive `git grep opencode` at this exact commit
returns no matches. There is no OpenCode-specific executable/model/startup/result
implementation at this pin to copy or claim as accepted.

- [executables.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/executables.ts),
  `resolveAgentBin`, `isExecutable`, `WELL_KNOWN_BIN_DIRS`, `EXTRA_PATH_DIRS`:
  Node `fs`, `os`, `path`, and local `resolveShipped`. Resolves PATH first, then
  installer directories; a PATH match can remain a bare name. No native digest
  equivalence, exact binary pin or consent binding is performed there.
  **Keep existing ORQST discovery and narrowly adapt precedence behavior already
  present**; copying the upstream resolver would weaken canonical admission.
- [createSessionDriver.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/createSessionDriver.ts),
  `createSessionDriver`: `ClaudeSessionDriver`, `CodexSessionDriver`,
  `HostSessionDriver`; ACP is a design-validation draft in this revision.
  **Do not use for OpenCode**: no corresponding OpenCode driver exists here.
- [Claude def.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/claude/def.ts),
  `claudeRuntimeDef.models`, and [Codex def](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/codex.ts),
  `codexRuntimeDef.models`, use actual provider probes. They do not supply an OpenCode
  catalogue. **Do not import** probes into passive OpenCode discovery.

[Anywh LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
is Apache-2.0. Its exact tree has no NOTICE file; inspected component headers have
no additional notice requirement. No upstream source or dependency is copied.
This absence is scoped to the pinned revision, not a claim about future Anywh.

## Tucano: real OpenCode V1/V2 implementations

Exact source: `0501956d127699300209902e889f3e69a0948766`. Git objects at that
commit were read explicitly; a checkout's newer HEAD is not substituted.

| Concern          | Exact source / functions and behavior                                                                                                                                                                                                                                                                                                                                                                                                                                               | Reuse decision and difference                                                                                                                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Installation     | [detect.ts](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/detect.ts), `which`, `adoptLoginShellPath`, `detectOpenCode`; [platform.ts](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/platform.ts), `withInstallDirs`, `executableNames`, `spawnable`. First executable on PATH; login shell `-ilc` supplies PATH; version command runs. Windows shim targets can be interpreted.       | **Keep ORQST** passive canonical candidates and exact native hash, plus existing installer fallbacks. No shell sourcing, provider version run, wrapper interpretation or arbitrary first executable. Preserve current reviewed PATH priority among byte-equivalent OpenCode copies.                    |
| Models           | `detectOpenCode` runs `--version` then V2 `models --standalone` (V1 `models`), parses `provider/model` lines, and `listedStatus` treats a nonempty list as logged in.                                                                                                                                                                                                                                                                                                               | **Do not import** into passive discovery: V2 command starts a private native server. ORQST retains `discoverTerminalModels` defaults/configured IDs, unverified availability and source digests; neither configured IDs nor cache prove entitlement. Dynamic OpenCode catalogue remains unimplemented. |
| Dispatch/model   | [opencode.ts](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/opencode.ts), `opencodeEngine`, `opencodeArgs`, `opencodeMajor`; [opencode-v2.ts](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/opencode-v2.ts), `runOpencodeV2`, `opencodeV2Args`. Version selects V1/V2; actual turn model reaches `-m`, V2 uses `run --server ... --format json --agent tucano --session ...`. | **Keep ORQST** full TUI `--standalone`. Root does not consume `--model`; use a V2 model object in per-process `OPENCODE_CONFIG_CONTENT`, composed with the existing MCP document. Do not import the headless turn/server adapter or switch to mini/run.                                                |
| Startup/identity | `opencodeHome` links V1 auth.json into private roots. V2 `opencodeV2Env` shares native data/DB credentials but isolates config/state; `startServer` spawns `serve --hostname 127.0.0.1 --port 0`, generates a password, waits for a log URL, and `mcpReady` polls its private MCP endpoint.                                                                                                                                                                                         | **Do not use**: ORQST preserves existing native identity, explicit shared-state/startup acknowledgements and reviewed standalone lease; creating another app-managed server, linking credentials, changing config identity or polling MCP would change ownership and the authorized scope.             |
| Return/lifecycle | `opencodeParser` parses JSONL `text`, `tool_use`, `step_finish`, `error`; `end` emits done only on successful exit. [cli.ts](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/cli.ts), `runCli`, spawns piped turns and handles abort. V2 `sessionUsage` exports session usage after the stream (last step may be missing), then `finally` deletes the created session and stops its private server.                                | **Keep ORQST** actual PTY output, signed operations, correlated Core/MCP transport and sticky uncertainty. No JSONL result is inferred from a TUI, and no session deletion, process signal or server adoption is imported. Synthetic discovery/profile evidence proves no provider result.             |

These modules use Node builtins, local Engine/Turn/Parser/platform contracts,
`GATEWAY_NAME` from the Claude integration, and local localization. They are not
standalone replacements for ORQST's provider/profile/signed runtime interfaces.
[Tucano LICENSE](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE)
and exact package metadata are Apache-2.0; its tree has no NOTICE file and inspected
component headers add no separate licensing condition. No Tucano code or dependency
is newly incorporated; the historical audit and existing attribution remain intact.

## Official OpenCode 2.2.5 source

Exact source: `9bbb8ce18c80f099e0e448775f59d965ead40a21`.

- [bin/opencode.cjs](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/cli/bin/opencode.cjs),
  `findBinary`, `run`: Node builtin launcher, environment override/cache/platform
  package resolution and spawning. **Do not import** or execute the launcher to
  discover installation; inspect existing canonical native bytes with ORQST.
- [commands/commands.ts](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/cli/src/commands/commands.ts),
  `Root`, and [handlers/default.ts](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/cli/src/commands/handlers/default.ts):
  Root has no model option and the handler does not pass a model to full TUI args.
  Mini/run model flags are different contracts and cannot prove Root support.
  The earlier draft claiming full TUI `--model` support was incorrect.
- [server-process.ts](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/cli/src/server-process.ts)
  forwards `OPENCODE_CONFIG_CONTENT` to native server config; [config.ts](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/core/src/config.ts),
  `load`, parses inline content after project config and before managed settings.
  [ConfigModel.Selection](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/schema/src/config/model.ts)
  accepts `{providerID, model, variant?}` or `provider/model[#variant]`;
  [Model.Ref.parse](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/schema/src/model.ts)
  splits at the first slash and optional hash, rejecting missing provider/model or
  empty/repeated variant fragments. ORQST's bounded safe-character parser enforces
  this grammar at catalogue discovery and again in the actual profile/environment.
  Object config fields are validated before joining, preventing delimiter confusion.
- [TUI context/local.tsx](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/tui/src/context/local.tsx),
  `configuredModel`, `fallbackModel`, `newSessionModel`, `preferredSelection`, reads
  the last config document with a model. A valid configured model precedes recent
  history and the first available model. [prompt/index.tsx](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/tui/src/component/prompt/index.tsx)
  sends `local.model.selection()` provider/id/variant into `data.session.create`
  when the first prompt creates a session. This source proves application of an
  initial native **default**, not an unconditional force-model contract.
  Managed settings can override inline configuration; an agent's configured model
  precedes fallbackModel; saved variant preferences precede config variants.
  Missing models/variants follow native fallback. No entitlement or effective model
  is established passively. **Keep native semantics** and disclose these limits in
  profile review; do not read or overwrite native preferences, auth or databases.
  If exact enforced provider/model/variant is required, the concrete alternative is
  manual selection/verification in the official full TUI. Automated enforcement
  would need an upstream full-TUI override contract or a separately approved change
  of interface; neither is implemented here.
- [handlers/models.ts](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/cli/src/commands/handlers/models.ts)
  resolves `ServerConnection` then calls native `client.model.list`. [server-connection.ts](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/cli/src/services/server-connection.ts),
  `resolve`, chooses standalone or managed service. [standalone.ts](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/cli/src/services/standalone.ts),
  `command`, `makeEndpoint`, `start`, starts a private `serve --stdio --port 0`
  with generated password and stdin ownership lease. **Keep existing ORQST**
  explicitly acknowledged standalone startup; do not run models as passive data.
  Native effect/descendant acceptance remains separate from this source review.

[OpenCode LICENSE](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/LICENSE)
is MIT. No root NOTICE or additional notice in the inspected CLI components;
unrelated subtree notices are not a licence grant for importing those subtrees.
The inspected model/startup code depends on `effect`, workspace `@opencode/*` and
Node builtins. No upstream source is copied, vendored, repackaged or added as a dependency. The native grammar is independently enforced using the existing Zod dependency.

## Verification boundary

Synthetic regressions exercise separate same-byte files, hardlinks, symlink aliases,
GUI-minimal fallback, unreviewed native bytes, executable shims, unsafe permissions,
review-time path/hash drift, default/configured model environment and MCP composition, native review disclosure
and pre-Start model-source fencing with zero backend starts. They reuse the actual
preparation, profile, backend and supervisor implementations with synthetic pins.
No provider, native app, installed CLI, server, database or authentication command is
run by these tests. Full build, Cargo, native WebKit/provider acceptance and dynamic
catalogue remain separate; the owner's active Preview and uncertain effects must
remain untouched. See [the preparation API](../api/terminal-preparation.md).

Current change checks on Node 24/pnpm 10: 18 focused tests (selected preparation,
model selection, launch plan and provider MCP config), plus two pure OpenCode
profile/environment cases. An isolated comparison executed the official
`Model.Ref.parse` function body against the ORQST parser for nine valid/invalid
references, substituting only branded-string constructors. This does not execute
the Effect `ConfigModel.Selection` codec, full TUI, provider or native services.
Full TypeScript and repository lint passed for this change. The full test
suite/build, Cargo, resources and installation are intentionally excluded by the
current coordination; they could run native/process fixtures or affect the Preview.

> 2026-11-05: The project owner directed removal of real CLI binary SHA-256
> values from the repository. The historical findings above are otherwise unchanged.
