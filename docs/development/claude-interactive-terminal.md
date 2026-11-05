# Explicit native Claude interactive terminal

## Tauri normal TUI contract — 2026-11-05

Normal selected preparation now uses the passively reviewed Claude 2.1.318 TUI
pin, with a fresh session UUID and optional default/sonnet/opus/haiku choice. The
existing Tauri catalogue/preparation/Core/PTY and single CLI authorization path
are reused. Keyboard authority still follows native focus. This increment adds
no modal, grant, login, process adoption or provider acceptance.

The older 2.1.178 strict MCP pin remains independent; existing manifests stay
readable. Claude 2.1.318 with ORQST MCP is refused pending its own review. Normal
Open preserves `mcp:false` (native user MCP definitions may still start). The
native same-user identity/configuration/session writes and lack of descendant
containment remain disclosed. Stop/Quit wiring belongs to the separate owned
shutdown integration and is not validated here.

Native installs can self-update outside ORQST. Each new version/hash needs a new
review/pin; unsupported bytes are refused without fallback. The executable hash
budget is finite at 512 MiB and streaming. See the [passive evidence, source reuse
decision and limits](../research/claude-code-tauri.md). Historical instructions
below describe their original version and authorization flow.

Current increment: [OpenCode Desktop opt-in](opencode-desktop-terminal.md) supersedes earlier no-factory/absolute launch-refusal statements below. A blocked-by-default review manifest, exact-binary factory and signed Desktop lifecycle are implemented with synthetic evidence only. Native startup/database effects, descendant exit and provider acceptance remain unvalidated.

The Desktop opt-in now accepts a version-2 Claude manifest alongside the existing
version-1 Codex manifests. Either slot can select Codex or Claude; total capacity
remains two, shared with structured Managed agents. This implements a launch path,
not real-provider acceptance, external Claude observation or automatic delegation.
OpenCode remains unavailable.

## Evidence and provider boundary — 2026-11-03

Codex discovery resolved the native release path labeled
`0.162.1-aarch64-apple-darwin`; passive hashing produced
`[historical CLI binary SHA-256 removed]`.
The [official 0.162.1 TUI source](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/tui/src/cli.rs)
was reopened to check the separate foreground and resume/fork controls. Existing
Codex flags/environment and acceptance limits remain unchanged; no version or
provider command was executed to perform this inspection.

Passive inspection rehashed the installed native Claude 2.1.178 binary to
`[historical CLI binary SHA-256 removed]`.
Embedded CLI code and the [official CLI reference](https://code.claude.com/docs/en/cli-reference)
confirm interactive startup, inline `--mcp-config`, `--strict-mcp-config` and
`--session-id`. The installed code validates the UUID and rejects an existing
session transcript with an already-in-use error, without selecting resume.
Its bundled MCP schema includes revision `2025-11-25`. These are offline interface
facts, not a measured handshake, successful native login or runtime acceptance.

Provisioning generates a random UUID. Each manifest admits only one dispatch,
including a failed dispatch. A backend-local fence blocks a second start; a durable
journal blocks the whole state on a subsequent Desktop launch. Duplicate Claude
UUIDs in a pair are rejected. Existing-session collisions remain provider-rejected;
ORQST never scans native transcripts to find a free ID. Retirement preserves old
evidence and requires a new manifest/state for another process.

Native HOME and an optional explicitly selected `CLAUDE_CONFIG_DIR` stay unchanged.
ORQST checks only directory metadata; it does not open credentials, Keychain, native
configuration or session content. No token/key environment is inherited. The native
CLI owns authentication and may refresh its credentials, run native hooks/plugins,
apply enterprise policy and write new sessions or native state. Existing login is
unknown until the user validates it; ORQST does not perform automatic login.

The child gets fixed locale/terminal/PATH, private TMPDIR and the installed-code
evidenced `DISABLE_AUTOUPDATER=1` and
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. It inherits neither arbitrary provider
variables nor an external server/session selector. Native configuration may still
affect the child. This is a trusted same-user process, without a read-only sandbox,
network containment or descendant cleanup guarantee. The provider UI can expose
session selection and permissions; those are native CLI behavior, not ORQST adoption.

## Provision and open

Use Node 24/pnpm 10 and select the canonical installed native executable. The command
only creates new ORQST state; it does not execute that provider. A changed hash/version
fails closed. Do not copy or link authentication files into the state.

```bash
pnpm terminal:setup:claude \
  --executable /absolute/path/to/native/claude \
  --executable-version 2.1.178 \
  --project /canonical/project \
  --state /canonical/new-slot-state \
  --acknowledge-shared-native-config \
  --acknowledge-shared-native-sessions
```

If native login uses a custom `CLAUDE_CONFIG_DIR`, provisioning retains that current
environment selector. It can also be supplied explicitly with
`--claude-config-directory`; `--user-home` selects the native HOME. These are identity
selectors, never new isolated authentication roots or copied credentials.

Supply one or two newly provisioned manifests to Desktop:

```bash
pnpm desktop -- --terminal-config=/absolute/slot-a/terminal.json \
  --terminal-config=/absolute/slot-b/terminal.json
```

Opening the view starts no provider. Select Start CLI and review the native dialog's
complete executable/version/hash, UUID argv, project, environment profile and shared
state disclosure. Start, attach, keyboard input, paste and signals retain their
separate document/focus/one-use native gates. Separate login is unavailable for Claude.
Each window shows the provider and independent Core/owned-instance identities.

## Optional per-instance MCP

Add both `--interactive-mcp --acknowledge-strict-mcp` when provisioning a Claude
manifest. Both slots must opt into MCP and select the same canonical project; the
other slot can be Codex or Claude. Codex uses its existing setup command/opt-in.
No native/global configuration is written.

Claude strict selection deliberately excludes other MCP definitions. The installed
2.1.178 can still refuse project approval or enterprise policy, as qualified by the
[official MCP guide](https://code.claude.com/docs/en/mcp); no approval is synthesized
or bypassed. There is no retry/fallback to another provider or a terminal without
the opted-in relay. A running PTY does not prove that this optional native MCP
initialized successfully. Timeout overrides are supplied but native behavior is
unmeasured. The builder alone remains blocked pending a native execution grant;
the reviewed Desktop composition supplies that separately authorized launch path.
This supersedes the earlier no-factory/session-collision launch gates for Claude;
functional compatibility claims still require real acceptance.

After both starts, the existing native menu separately authorizes one A → B → A
task grant for the actual running owned instances. The user/model must call source
`delegate_task` and worker `wait_task`/`submit_result`; there is no initial prompt,
worker wakeup, automatic tool approval or task injection through PTY bytes. Native
MCP/tool discovery, permissions, wait duration, login and inference remain unvalidated.

## OpenCode stays blocked

The subsequent [standalone review](opencode-standalone-review.md) resolves the
server-selection uncertainty below: exact installed `--standalone` avoids the
shared service. It does not separate existing credentials from the native session
database or suppress startup migrations. The passive candidate is implemented;
native startup remains unauthorized; pending migrations have not been established.

The installed 2.2.5 binary was rehashed to
`[historical CLI binary SHA-256 removed]`.
Its embedded `Mcp.LocalConfig` uses `disabled`, `codemode`, `protocol` and an object
`timeout` with `startup`, `catalog`, `execution`. The earlier builder used a current
documentation shape (`enabled` and numeric timeout), which is unsuitable as exact
installed-schema evidence. The offline builder now selects `disabled:false`,
`codemode:false`, `protocol:"legacy"` and separate 10s/10s/125s timeouts. It still
cannot execute a process. Current [MCP docs](https://opencode.ai/docs/mcp-servers/)
and [configuration docs](https://opencode.ai/docs/config/) do not override this
installed-schema evidence; actual tool/timeout behavior remains unmeasured.

Embedded standalone code also starts a `serve --stdio --port 0` subprocess with a
generated endpoint/authentication value. This does not prove the default TUI selects
that path rather than existing service attachment, nor prove fresh session routing,
loopback exposure or lifecycle ownership of descendants. Native authentication/data
roots are coupled. No OpenCode executable factory, login probing, service attachment,
server-password extraction or global configuration change is enabled. Those missing
contracts require further passive review and separately authorized native acceptance.

## Validation scope and security review

The new native PTY fixture substitutes only the reviewed Claude hash in disposable
test bundles, never in shipped Desktop code. It compiles a clearly synthetic native
process, validates profiles and last-boundary binary/manifest checks, starts/echoes/
exits through the common real Node/PTY host, and rejects a second dispatch and drift.
Pure negative tests cover identity/credential injection, unsupported providers,
missing MCP acknowledgment/composition and relay drift. Existing signed transport,
role, ownership-loss, focus and read-only observer regressions remain applicable.
This is synthetic evidence; no installed provider or inference is executed.

The observer HTTP/WebSocket/cookie/static routes, database schema and ingestion are
unchanged. The private native pair RPC now admits the fixed Claude profile ID and
provider label. It adds no renderer identity/slot/proof selection, MCP execution tool,
native credential API or remote endpoint. Executable/relay hashing, native signatures,
sticky reservations, ownership loss and input revocation remain in force. Temporary
synthetic bundles do not weaken production exact-hash gating.

Positive macOS modal/focus acceptance requires an unlocked console. This work does
not treat a focus double or PTY process success as that acceptance. Specifically
authorized no-task native startup/MCP checks must precede separately authorized
inference/delegation. External sessions and all older reservations remain untouched.

The implementation checks passed on Node 24.22.2/pnpm 10.34.9: `pnpm lint`,
`pnpm typecheck`, `pnpm test` (475 cases) and `pnpm build`. An additional focused
run passed five cases, including both Codex/Claude source/worker orders. The full
run preceded that added mixed-profile case. The first fixture attempt failed
because its disposable PTY spawn-helper lacked executable permission; staging now
sets that permission in the test copy and the fixture passed. An initial formatting
check identified the RPC file; formatting was corrected and final lint passed.

`pnpm accept:terminal-pair --authorize-synthetic-pty` stopped at the locked macOS
console precondition before any fixture/provider start. Full Chromium and
`validate:local` were not run; observer ingestion is unchanged. The dashboard's
existing chunk-size warning remains. The localhost 4317 index and JS/CSS assets
matched the rebuilt files byte-for-byte without restarting its managed service.

Independent critical QA (pane-528) approved the native authorization/ownership and
credential boundaries and passed 65 focused cases. Its UUID-uniqueness observation
is enforced before Core creation by `inspectManagedTerminalFiles`; an explicit
disposable two-manifest regression now checks rejection before journal creation.

> 2026-11-05: The project owner directed removal of real CLI binary SHA-256
> values from the repository. The historical findings above are otherwise unchanged.

> 2026-11-05 update: The interactive setup scripts require an existing native
> CLI authorization and `--cli-policy-directory /absolute/path/to/managed-agents`.
> Authorize the exact executable through Desktop first. The scripts verify that
> local grant without running the provider and write a v2 manifest. Historical
> command examples above predate this requirement.
