# Native terminal catalogue and selected preparation

This private native IPC contract adds no observer HTTP/WebSocket execution route.
The renderer sends identifiers only. The owned Tauri helper receives its observer
database and private preferences directory separately through native argv 4.

`catalog` accepts exactly `action`, `workspaceId`, and nullable `featureId`.
`create-selected` additionally accepts `catalogId`, `provider` (`codex`, `claude`,
`opencode`), opaque `modelId`, and `count` (1–8). Native document/generation checks
remain outside this Node request. Unknown keys, including paths, executable names,
arguments, PIDs and proofs, are rejected. The reply to discovery is
`{status:'catalog',catalog}`; the existing preparation result retains
`{status:'cancelled'|'prepared'|'open',files}` for the native process only.

The public catalogue has `contractVersion:1`, scope IDs, a SHA-256 catalogue ID,
and three provider entries. Each entry exposes `status`, a bounded reason and
model options with opaque IDs, labels, provenance and `availability:'unverified'`.
`available` describes a unique reviewed local executable with inspectable sources;
it never describes account login, model entitlement or successful inference.
No executable, project/config path, raw configuration, cache identity or credential
is projected into this catalogue.

The database package resolves the requested workspace using a parameterized,
read-only SQLite query. It does not construct `Store`, migrate, chmod or repair the
observer database. Core verifies canonical ownership, permissions, size, stable
workspace identity and directory/database inode identities. It validates the saved
Feature view and membership through the existing private preferences facade.
Those metadata preferences can be initialized; no execution journal/Core/PTY is
created by discovery. A selected Feature must exist in the workspace, be current
and not be archived. Publication and launch revalidate the binding. View switching
never signals an already running process; it fences a pending new launch.

The existing provisioning transaction can use a nonempty selected project only
with this trusted Core binding. It never makes a substitute disposable project.
The legacy advanced file-selection flow keeps its existing empty-project rule.
One native selection review displays the exact manifests, model evidence, shared
native identity and OpenCode startup acknowledgements before the first possible
write. A selection too large for one 4096-character review is refused; the user can
reduce its count. Process launch/output/keyboard permission is a separate native
signed operation. There is no automatic installation, login, inference, resume,
process adoption or retry after an uncertain write.

Profiles persist model selection evidence. Codex/Claude pass explicit choices as
`--model` and the validated identifier. OpenCode 2.2.5 full TUI Root does not consume
that flag: it retains `--standalone` and composes a native V2
`{model: {providerID, model, variant?}}` into per-process `OPENCODE_CONFIG_CONTENT`,
preserving the existing generated MCP document. Native defaults omit the model
override entirely; no global/project config file is written. This is an initial
native default: managed settings, configured agents and saved variant preferences
can take precedence, and unavailable models/variants follow native fallback.
Requested selection remains unverified until reported by the native CLI; exact
forced selection is not implemented. See the pinned source review below.
The existing PTY backend re-reads the manifest and profiles immediately before
dispatch, so model source evidence, binary pins, workspace/Feature binding and expiry
are checked again. No shell command string is constructed.

## Catalogue sources and limits

- Codex 0.162.1: bounded native `models_cache.json` with exact client version,
  valid fetch time, the CLI's 300-second freshness window and `visibility:list`;
  native TOML `model` basic strings provide additional configured choices.
  Cached entries expire before launch. Auth identity/cache metadata is not exposed.
- Claude Code 2.1.178: official `sonnet`, `opus`, `haiku` aliases, plus explicit
  native JSON `model` values. Aliases describe supported CLI syntax, not the
  concrete resolved version or an account entitlement.
- OpenCode 2.2.5: default and explicit native JSON `model` / `providers.models` (and migrated legacy `provider.models`)
  identifiers, including native V2 model references with optional variants. The dynamic catalogue is still unavailable here. Its `models`
  command resolves a native server, and the native cache lives in provider SQLite;
  neither is accessed silently by passive discovery.

Each source file is limited to 2 MiB, each provider to 128 options, and model
identifiers to 160 safe characters. Unsupported TOML forms, JSONC and configuration
interpolation are delegated to the real CLI default, rather than evaluated or
invented. Unsafe/unreadable source files make the provider unavailable. Context and selected-choice
evidence are checked after review, after the commit latch and before publication/launch.
Missing or stale catalogues keep honest default/configured choices. No Analytics,
observed session model or history data is used as catalogue evidence.

The executable contracts remain the existing exact binary pins. A provider upgrade
requires a reviewed pin/adapter update; finding an executable on PATH does not grant
launch authority. OpenCode aliases/copies passing the same exact reviewed native
SHA-256 are one implementation option, retaining existing canonical PATH precedence.
Raw installation discovery retains distinct canonical copies. The selected path and
hash are disclosed in native review and bound to the manifest; changing/removing
that executable requires a fresh review, with no substitution during Start.
Different bytes, matching names/package versions or shims do not establish equivalence.
Codex/Claude multiple-candidate selection retains its advanced native workflow;
that legacy wizard does not support OpenCode. See [pinned source comparison and
decisions](../research/opencode-executable-equivalence.md).

## Security review and verification

The observer API, cookie handling, static serving, loopback binding and CSP are
unchanged. Authority stays in native document/focus fences and the existing broker,
Core admission and PTY backend. Metadata-only discovery adds no remote execution
endpoint. Private provider state is shared only under the existing explicit native
acknowledgements; provider-owned session writes, credential refresh and OpenCode
startup/migration effects remain disclosed. The reader selects model metadata from
bounded configuration files; their complete bytes may contain private values and
are transient inputs to hashing/parsing. Configuration bodies and authentication
files are not returned as catalogue data or written to logs.

Synthetic tests verify all three providers' selected identifiers reach the actual
launch profile argv and the exact selected nonempty project reaches `cwd`, without
calling a file picker or executing a provider. They also cover unknown IDs, drift,
read-only database lookup, Feature fencing and source budgets. Native UI, provider
acceptance, resolved models/entitlements, dynamic OpenCode catalogue and platform
packaging remain separate acceptance work. The active Preview bundle is unchanged.

Live enrollment of another terminal into an already running host is not implemented
by this Core increment. `ManagedTerminalPair`, its IPC client, native selection and
admission manifest set are fixed at construction. The first selected creation can
prepare/open a bounded selection, but a second +Terminal must not be described as
supported until the same Core can admit a new reviewed slot while retaining its
existing processes. Starting a second Core or unlocking the UI alone is insufficient.

The launch validation chain is `TerminalSupervisor.launch` →
`managedTerminalBackend.validate` → `readInteractiveTerminalConfig` / profile
validators → `validateTerminalModelSelection` / `validateTerminalPreparationBinding`.
`backend.start` repeats validation synchronously before lifecycle receipt/fork;
`pty-host` reads/validates the manifest and reconstructs the profile before
`node-pty.spawn`. Synthetic tests sign the prepared challenge, change source bytes,
and call the actual supervisor launch method: `start_failed` occurs with zero
backend starts. This is admission evidence, not successful provider startup.

## Bounded preparation failure reply

Native Studio `denied`/`unavailable` replies may carry `failure`, with exactly:

- `stage`: `bootstrap`, `request`, `catalog`, `selection`, `plan`, `review`,
  `revalidation`, `commit`, `provision`, `inspection`, `feature_assignment`, `opening`.
- `code`: `failed`, `catalog_changed`, `selection_unavailable`, `capacity_exceeded`,
  `review_too_large`, `selection_blocked`.
- `effects`: `not_started` or `possible`.

Bootstrap/provision/inspection/Feature assignment/opening cannot claim
`not_started`. Native commit/open evidence promotes any earlier helper claim to
`possible`. Unknown transport/exit outcomes are always `possible`. Codes are
stable identifiers, not exception text or retry permission. Extra fields are
rejected. The helper sends the same object as `{kind:'failure',failure}` over its
private pipe. See [boundaries and checks](../development/terminal-preparation-diagnostics.md).

## Selected catalogue evidence — 2026-11-04

`catalogId` binds Workspace/Feature context and revision; each opaque `modelId`
binds the selected executable, native context, model and configuration. Unselected
provider changes no longer invalidate a choice. Codex native-config/default options
exclude the picker cache; cache choices validate only their selected visible entry,
client version and freshness, retaining the original deadline through refresh and
at launch. Private manifests add optional `model.files[].codexModel` semantic proof;
legacy source hashes retain their meaning. Public IPC shape is unchanged. See
[format, invariants, source research and limits](../research/terminal-catalog-selection-binding.md).
