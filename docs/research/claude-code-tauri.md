# Claude Code Tauri TUI pin review — 2026-11-05

This review admits one additional native TUI contract. It is passive source and
executable inspection, not provider execution, login, native focus, inference,
effective-model, MCP, Stop/Quit or descendant-exit acceptance. No provider command
(including help/version) was executed. No credential, native session or private
configuration was read.

## Independent contracts

2026-11-05 correction: the following paragraphs record the earlier pin-based
implementation. The current policy uses vendor signature, measured local bytes,
reviewed version contracts and authorization. Legacy Claude 2.1.178 TUI
manifests without a v2 CLI binding can be read for inspection while their saved
file and filesystem checks remain valid; they cannot launch without a current TUI
contract. The independent 2.1.178 MCP contract remains separate. This does not
change the conservative handling of unverifiable historical recovery bindings.

| Contract                  | Version label | SHA-256                                   |
| ------------------------- | ------------- | ----------------------------------------- |
| Normal TUI                | 2.1.318       | `[historical CLI binary SHA-256 removed]` |
| Existing strict ORQST MCP | 2.1.178       | `[historical CLI binary SHA-256 removed]` |

The new label comes from the canonical installation's version directory, not a
version command. Passive SHA-256 was recomputed with 64 KiB reads. The file was
319,598,464 bytes, owned by the current user, mode 0755, with one link. These facts
identify local bytes; public release metadata does not independently attest that
local hash. No binary is incorporated in this repository.

`interactive-profile.ts` pairs each admitted version with its exact hash. Historical
2.1.178 manifests remain readable. Normal catalogue discovery/provisioning uses
the new TUI pin. `provider-mcp-config.ts` remains unchanged: selecting MCP for the
new binary is refused as an unreviewed MCP version/hash before composition. There
is no fallback to another executable or an unreviewed launch contract.

## Passive flag/environment review

Public Anthropic sources were opened on **2026-11-05**:

| Source                                                                                                                                                                                                                 | Confirmed contract                                                                                                                                                                              | Not confirmed by this review                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [CLI reference](https://code.claude.com/docs/en/cli-reference)                                                                                                                                                         | Foreground interactive entry; UUID-valued `--session-id`; optional `--model` alias or full identifier                                                                                           | Real TUI startup, focus/input, inference or authentication                              |
| [Model configuration](https://code.claude.com/docs/en/model-config#model-aliases)                                                                                                                                      | `sonnet`, `opus`, `haiku` are valid aliases; resolution depends on provider/configuration                                                                                                       | Account entitlement, complete model inventory or effective backend model                |
| [Environment reference](https://code.claude.com/docs/en/env-vars)                                                                                                                                                      | `CLAUDE_CONFIG_DIR` selects native configuration; `DISABLE_AUTOUPDATER=1` disables background self-update; nonempty `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` opts out of nonessential traffic | Network containment; marketplace installation is outside that traffic opt-out           |
| [Setup/update documentation](https://code.claude.com/docs/en/setup#auto-updates)                                                                                                                                       | Native installations can update outside ORQST; manual updates remain possible                                                                                                                   | Version stability between launches                                                      |
| [Official v2.1.318 release](https://github.com/anthropics/claude-code/releases/tag/v2.1.318), [pinned changelog](https://github.com/anthropics/claude-code/blob/646b74189c735abbccf78ef5cb7ddd38a07a36eb/CHANGELOG.md) | Published release and dated changes concerning native configuration, updates and permissions                                                                                                    | MCP compatibility with ORQST's older contract; release notes are not execution evidence |

`/usr/bin/strings` read only the canonical executable. Embedded option registration
contains both `--session-id <uuid>` and `--model <model>` with their descriptions.
Adjacent code validates a UUID and refuses an already-used ID rather than implicitly
resuming. Embedded alias comparisons include all three reviewed aliases. Embedded
environment handling reads `CLAUDE_CONFIG_DIR`, tests `DISABLE_AUTOUPDATER`, and
selects essential-traffic mode for nonempty
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`. Documentation and embedded interface
evidence agree for every provider-specific flag/environment selector used by the
normal TUI profile. This does not prove their observed runtime behavior.

The unchanged host environment also supplies HOME, private TMPDIR, the reviewed
tool PATH, LANG/LC_ALL and TERM. These are host/PTY settings, not additional Claude
CLI options. Embedded code references HOME/PATH/TERM/LC_ALL; this inspection did
not establish provider-specific TMPDIR or locale handling. No new semantics are
claimed for those existing host settings. Arbitrary inherited variables, keys,
loaders, prompt/print/resume flags and permission bypass are not introduced.

## Finite executable budget and operational drift

`terminalExecutableMaximumBytes` is **512 MiB (536,870,912 bytes)**, shared by native
executable hashing. Hashing retains 64 KiB streaming reads, canonical paths,
`O_NOFOLLOW`, file/ancestor ownership and permissions checks, executable mode,
Mach-O admission on macOS and a read-loop bound if the file grows. Metadata above
the limit is refused before hashing. The budget does not relax exact content pins.

The existing `TerminalCliPolicyStore` volatile identity cache remains unchanged:
an initial hash is necessary, subsequent input checks reuse only an unchanged
device/inode/size/mtime/ctime/mode identity, and the cache is not persisted. This
avoids rehashing a large native executable on each keystroke. Initial discovery,
preparation and dispatch still perform their existing validation.

Claude Code can self-update in other native sessions, and the user can update it
manually. The ORQST child opt-outs do not freeze the installation globally. Every
new version/hash requires another passive review and explicit pin update. Without
a compatible pin, refusal means **unreviewed version/hash**, even when a launcher
exists. There is no automatic pin refresh or fallback to unreviewed bytes.

## Required reuse research

Anywh was re-inspected in a separate checkout at
[`546f189c04415c3c5af5f40e3931a0a90b9aba31`](https://github.com/anywh-sh/anywh/tree/546f189c04415c3c5af5f40e3931a0a90b9aba31).
Entry references were `docs/architecture.md`, `docs/agent-host.md` and
`relay/src/runtimes/README.md` at that same revision.

| Exact source at that commit                                                                                                                                                                                                                                                                                                               | Implementation and decision                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Claude driver](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/claude/driver.ts), `ClaudeSessionDriver`; [session](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/claude/session.ts), `buildTurnArgs` and process spawn | Prompted print/stream-json execution with optional model, resume and selectable bypass. Keep ORQST's existing no-prompt native TUI/Core/PTY; copying this would change its authority and interaction contract. |
| [Persistent driver](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/claude/persistent.ts), `buildPersistentArgs`; [Agent Host](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/claudeProcess.ts), `ClaudeProcess`             | Bidirectional structured print mode, detached host processes and MCP files. Keep ORQST's owned lifecycle, signed authority and uncertainty preservation; no parallel host or process adoption.                 |
| [Executables](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/executables.ts), `resolveAgentBin`, `stripBilledCredentials`                                                                                                                                                             | PATH/fallback resolution without exact binary pins; strips three billed credential variables. Keep ORQST's passive canonical/hash admission and allowlisted child environment.                                 |
| [Terminal session](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/host/terminalSession.ts)                                                                                                                                                                                                     | Generic node-pty/tmux terminal is not ORQST's owned terminal contract; keep existing implementation.                                                                                                           |

License evidence: the pinned [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
is Apache-2.0; the commit tree has no NOTICE. Inspected source headers have comments
and no contrary license. `relay/package.json` requires Node >=20.12 and declares
node-pty ^1.1.0, ws ^8.18.0, gpt-tokenizer ^4.0.0 and smol-toml ^1.8.0. No source,
assets or dependencies are incorporated, so there are no upstream modifications
or new attribution obligations. Existing ORQST modules are the concrete reuse.
Tucano communication and Overclock layout are unchanged and outside this increment;
the historical Tucano audit is preserved.

## Verification boundary

Synthetic checks cover a generated 320 MiB sparse native-header file hashed in
64 KiB buffers, refusal above 512 MiB, permission/executable/symlink rejection,
new/legacy version/hash pairing, new-pin MCP refusal, default/alias catalogue to
prepared argv, executable/configuration drift and the existing CLI authorization
cache. No real binary is stored in fixtures. Provider/native acceptance, full test
suite, packaging and build are separate gates; actual command counts are reported
in the implementation handoff.

> 2026-11-05: The project owner directed removal of real CLI binary SHA-256
> values from the repository. The historical findings above are otherwise unchanged.
