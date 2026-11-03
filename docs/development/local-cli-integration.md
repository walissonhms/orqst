# Existing local CLI integration — 2026-11-03

ORQST should use the owner's installed Codex, Claude Code and OpenCode CLIs and
their existing native authentication when available. It must not require duplicate
installation or login by default. This is product direction, not a claim that all
three managed adapters or credential reuse are implemented.

## Implemented passive preflight

With the repository's Node 24/pnpm 10 toolchain, run:

```bash
pnpm terminal:discover
```

This developer command inspects only executable filesystem metadata in the current
process's PATH. It resolves symlink launchers to canonical files, preserves PATH
priority and deduplicates targets. It ignores empty/relative PATH entries and never
searches project files, session roots, credentials, shell profiles or the Keychain.
It does not execute even `--version`, authentication-status or help commands, install
anything, create homes, start a server, or connect to an existing process.

The JSON report contains up to 16 candidate launchers/targets per provider, null
version, unknown authentication and no execution authority. Scanning is capped at
128 unique absolute directories and 32 KiB of PATH. Truncation/errors produce limited
inspection; oversized input fails before inspection. `not_found` means not found in
this bounded PATH inspection, not absent from the machine. Finder-launched Desktop
may have a different PATH; this command does not source a login shell to repair it.
Windows launcher discovery is not implemented.

A candidate can be a shim, incompatible binary or untrusted file. Metadata is not
native-binary admission, authentication, model access, provider readiness or a new
adapter capability. Multiple canonical candidates require explicit selection. The
existing setup still hashes and validates the selected native binary before writing
private state. Nothing in the report may be passed as a grant to execute it.

Each provider also receives a fail-closed integration plan: `reuse_existing`, no
automatic install/login, provider-owned credentials and explicit blockers. The plan
is informational and contains no executable command, environment or token. It has
no Bridge, dashboard, IPC or provider-dispatch endpoint.

## Official mechanisms and remaining boundary

The following primary sources were opened on 2026-11-03. They describe upstream
mechanisms, not support established against the installed versions.

| Provider    | Native authentication evidence                                                                                                                                                                                                                                                           | Isolation consequence / ORQST status                                                                                                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | [Authentication](https://learn.chatgpt.com/docs/auth?surface=cli) describes cached file/OS-store credentials and automatic refresh. [Environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables) places auth, config, logs and sessions under `CODEX_HOME`. | Changing homes cannot be assumed to reuse login. Sharing the existing home cannot be called physically isolated or immutable. `CODEX_SQLITE_HOME` moves SQLite state only. Safe existing-auth dispatch remains blocked; managed PTY/structured libraries retain their explicit separate-login contract. |
| Claude Code | [Authentication](https://code.claude.com/docs/en/authentication) describes reuse of earlier sign-in and macOS Keychain/file fallback; `CLAUDE_CONFIG_DIR` also selects credential identity.                                                                                              | Do not silently replace HOME/config directory or query the Keychain. Managed integration and per-instance isolation remain unimplemented.                                                                                                                                                               |
| OpenCode    | [CLI authentication](https://opencode.ai/docs/cli/#auth) describes native credential loading and additional environment/project `.env` sources.                                                                                                                                          | Discovery must not enumerate authenticated providers, read credential files or inherit secret environment variables. Version-specific separation of native auth and session/data state remains unverified; managed integration is absent.                                                               |

ORQST never copies/symlinks authentication files, exports secrets, injects inherited
tokens, calls logout, refreshes credentials itself or adopts/resumes external sessions.
An eventual approved native CLI may itself refresh its own credentials; do not promise
that its existing auth store remains byte-for-byte unchanged. Existing native login is
not evidence of entitlement to a model or permission to redistribute a provider SDK
login experience. Provider product/SDK terms need a separate review before that path.

## Legacy separate-login escape hatch

`terminal:setup` defaults to the new reuse policy and fails before creating state
because a safe isolated reuse backend is not yet implemented. An explicit
`--authentication separate-login` selects the earlier experimental profile. This is
an optional exception, not a prerequisite of the intended product flow. With that
flag, `--executable` can be omitted only when this PATH scan is complete and has one
Codex candidate; version metadata must still be explicitly supplied. No provider runs
during setup. Existing manifests remain unchanged and require their existing native
per-operation confirmations. The real two-agent acceptance command also requires the
explicit separate-login flag; it does not implement existing-auth reuse.

The previously proposed two homes/device logins are suspended as the default
acceptance route. Do not repeat, complete, replace or delete pending login state to
advance this preflight. A different authentication architecture needs a concrete
review before either provider start or further login.

## Next acceptance with the installed CLI

1. Review the passive candidate paths locally, then approve the exact canonical
   binary/hash/version and offline compatibility operations. Paths/version strings
   alone cannot prove the installed protocol. Keep evidence outside Git.
2. Establish a provider-specific official contract that retains native authentication
   and creates two distinct owned identities without resuming external sessions.
   Review all shared config/hooks/plugins/MCP, refresh writes, history and database
   effects; if complete physical separation is unavailable, state the precise
   shared-state boundary for an owner decision. Do not replace it with token copying.
3. Fixture-test that contract, then approve the exact native start, model, cost scope
   and owned cleanup. No status/login/provider call is authorized by discovery.
4. Verify two process/thread identities, scoped A-to-B dispatch, B completion and
   correlated automatic return to A; verify exit/uncertainty and preservation of
   external processes/sessions. Desktop concurrent panes require separate UI work.

The tests cover synthetic filesystem lookup, aliases, duplicates, incomplete scans,
ambiguous candidates, inaccessible synthetic credentials, no CLI execution and the
default setup's absence of writes. They do not validate any real authentication or
two-agent provider workflow. The observer, its ingestion and provider descriptors
are unchanged.
