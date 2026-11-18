# Managed CLI updates in Tauri Studio

Studio keeps the exact SHA-256 in every launch manifest. After a verified
update, the native helper records the new version, full SHA-256, verified
publisher and previous SHA-256 in the private CLI review ledger. A move between
version directories records source `signature_continuity_version_dir`, the
previous and new canonical targets, the reviewed launcher and install root. The ledger
keeps the latest review separately for each provider. The next catalog read and
a successful Studio batch show the verified update. Settings › Agents and the
Studio picker can review an exact candidate when automatic continuity fails.
The native review shows the canonical path and hash before any version command.
Approving that review leaves terminal creation as a separate action.

## Security review

- Discovery retains the launcher path selected by the catalog and resolves it to
  a canonical file. A signed exact review can record the canonical parent of
  the matching version directory as the install root. The directory name must
  match the reviewed version or append a suffix, such as
  `0.162.1-aarch64-apple-darwin` under standalone Codex's `releases` root. A move
  requires the same launcher and a different version directory under that
  recorded root. The launcher must resolve to the proposed canonical target.
  Every directory from the root to the target's parent must be owned by the
  current user or root, with group and other write bits clear. Reviews without a
  recorded launcher and root retain same-path continuity. A subsequent move
  requires a new native review to establish those fields. An unsigned binary
  continues to require native approval for a digest change.
- Node uses absolute `/usr/bin/codesign` with argv, exact TeamIdentifier and
  Identifier fields, strict all-architecture verification, and an explicit
  Apple Developer ID Application certificate requirement. Rust independently
  evaluates that requirement with Security.framework. For a version-directory
  update, the Tauri shell reads the prior private record and independently
  verifies the launcher, install path, SHA-256 and publisher during the focused
  Open. The Node and Rust terminal profiles also revalidate a recorded move
  when it supplies executable approval. A positive notarization
  requirement uses Apple's `notarized` code requirement. Apple issues tickets
  for standalone executables and supports stapling tickets to distributable
  containers such as packages and disk images. The standalone file carries no
  stapled ticket. Ticket checks can use the macOS notary service.
  [Apple notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
- The existing SHA-256 pin can initialize a publisher baseline when the exact
  binary is present and verified. The earlier Antigravity audit also supplies
  the original canonical path, SHA-256 and Google Developer ID for the audited
  installation. It records no ticket verdict, so that migration requires a
  positive notarization result for the replacement.
  [Antigravity installation audit](../research/antigravity-integration.md#11-inspected-local-binary)
- The focused native Open or Review action authorizes the bounded
  `--version` probe only after publisher continuity or explicit user consent.
  A matching packaged digest already supplies the version. A recorded
  version-directory update must match the verified version to the directory.
  The probe uses a temporary HOME, minimal environment, capped output and a
  three-second deadline. Its child runs as the local user. This is version
  evidence, and the vendor program can independently perform I/O.
- Review IDs bind the exact candidate and prior policy to the scoped catalog.
  The helper checks scope, current native authority, canonical path and bytes
  around version inspection and publication. Private, single-link records use
  fenced replacement and a per-provider writer lock. A process killed during
  publication can leave a lock that blocks further writes until it is inspected
  and removed. The existing manifest hash, typed model source, workspace and
  Feature fences, native start challenges, scope expansion prompts and
  authorization epochs still govern execution. A CLI review does not grant
  control of any existing process.
- The same-user filesystem remains the trust boundary for private review
  records. The path and file checks detect normal concurrent installer changes.
  They do not provide a kernel execution lock across validation and spawn.
  Vendor signing proves publisher identity and integrity. Provider behavior,
  protocol compatibility and authorization remain separate checks.

## Provider evidence

All four local executables passed `codesign --verify --strict
--all-architectures` and the Apple notarized requirement on arm64 macOS 26.3.
The inspection used `codesign -dv --verbose=4`, canonical paths and hashes. It
did not start the providers.

| Provider    | Executable on the inspected machine                                            | TeamIdentifier | Identifier                  | SHA-256 prefix |
| ----------- | ------------------------------------------------------------------------------ | -------------- | --------------------------- | -------------- |
| Antigravity | `~/.local/bin/agy`                                                             | `EQHXZ8M8AV`   | `cli`                       | `62f2102784bb` |
| Codex       | `~/.codex/packages/standalone/releases/0.169.0-aarch64-apple-darwin/bin/codex` | `2DC432GLL2`   | `codex`                     | `739cda86e15d` |
| OpenCode    | `~/.opencode/bin/opencode`                                                     | `5NZ4Q7NXJ4`   | `opencode`                  | `abe4d88594bf` |
| Claude      | `~/.local/share/claude/versions/2.1.318`                                       | `Q6L2SF6YDW`   | `com.anthropic.claude-code` | `677a2ea7bf57` |

All four inspected candidates are native Mach-O. OpenCode and agy have stable
canonical paths in this installation. Codex standalone resolves through a
version directory. Claude's inspected launcher resolves to a version-named
file, so it cannot use the directory-move path. A Node signature gives no
evidence about a Codex or OpenCode npm launcher script or its package payload. On macOS the
existing native-only launch contract refuses those shims. Select the native
binary directly where available. The one-review path applies to supported
executable formats with exact hashes. No interpreter-wide exception is made.

A read-only catalog check used the installed Codex launcher
`~/.local/bin/codex` and a temporary baseline seeded from the installed,
signature-verified 0.162.1 pin. The classifier accepted the move to 0.169.0
as `signature_continuity_version_dir`. Both binaries passed the Developer ID
and notarization checks. The classification left the baseline unchanged and
did not run the CLI.

The live provider launch, login and post-update behavior of each CLI and the
native sheet and localized notice still need acceptance in a packaged Desktop.

## Reference review

- Anywh's Apache-2.0 repo at `16d572d247ef16b79431c1ffe5695a8a1b57c913`
  documents the relay/runtime split and persistent Agent Host. Its
  `resolveAgentBin` checks `node:fs` execute access, explicit config, PATH and
  known directories and can return a bare command name. The Codex daemon
  transport, Claude session and persistent Claude host call Node `spawn` using
  that selection. ORQST keeps bounded canonical discovery, exact bytes,
  publisher continuity and owned PTY admission. The reviewed tree has an Apache
  license and no tracked NOTICE. This change incorporates no Anywh source or
  dependencies.
  [Architecture](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/docs/architecture.md),
  [Agent Host](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/docs/agent-host.md),
  [Runtime contract](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/relay/src/runtimes/README.md),
  [resolver](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/relay/src/runtimes/executables.ts),
  [Codex daemon](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/relay/src/runtimes/transports/codexDaemon.ts),
  [Claude session](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/relay/src/runtimes/defs/claude/session.ts),
  [Claude host](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/relay/src/agentHost/claudeProcess.ts),
  [LICENSE](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/LICENSE).
- The ORQST WIP at `4ad5e3699cd0f183263c9c8bd36fd6eb3e33e8e4` supplies the
  bounded subprocess and isolated temporary HOME pattern from
  `cli-version-probe.ts`, and the Security.framework FFI from
  `cli_signature.rs`. The adaptation uses the current Studio commit gate and
  stores path-bound, per-digest evidence. It retains packaged pins and native
  exact hash approval. The WIP's alternative contract registry and mandatory
  signature for all candidates were unsuitable for the owner decision.
  [WIP commit](https://github.com/walissonhms/orqst/commit/4ad5e3699cd0f183263c9c8bd36fd6eb3e33e8e4).
