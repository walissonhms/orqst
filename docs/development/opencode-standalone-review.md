# OpenCode standalone review and remaining acceptance

Current increment: [OpenCode Desktop opt-in](opencode-desktop-terminal.md) supersedes
the historical no-factory/native RPC refusal below. A blocked-by-default review
manifest and explicit signed Desktop startup path now exist with fixture evidence;
no native startup or database inspection was performed.

## Passive review boundary at fd5c26d — 2026-11-03

`pnpm terminal:plan:opencode` produces a passive, version/hash-scoped launch candidate.
It is not a Desktop manifest, `TerminalProfile`, process launcher or execution grant.
At that commit, OpenCode was rejected by the interactive factory and native RPC. Codex and Claude
keep their existing explicit native Desktop paths; the two-slot capacity is unchanged.

```bash
pnpm terminal:plan:opencode \
  --executable /absolute/path/to/native/opencode \
  --executable-version 2.2.5 \
  --project /canonical/project
```

The command hashes the selected native executable, validates directory metadata and
prints a JSON candidate. It writes no state, does not execute a provider, and never
opens native configuration, credentials or databases. Authentication remains unknown.
Changed version/hash fails closed. The reviewed binary is 2.2.5 with SHA-256
`[historical CLI binary SHA-256 removed]`.
The version argument identifies the reviewed hash; it does not run `--version`.
Keep the printed report private: native HOME/XDG/database paths are operator
metadata and must not be committed or attached to public issues. The JSON
`server` and `session` blocks are review-derived expectations, not runtime
measurements; native acceptance remains unrun.

`--user-home` explicitly selects native HOME. Existing absolute `XDG_CONFIG_HOME`,
`XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `OPENCODE_CONFIG_DIR` and
`OPENCODE_DB` selectors are retained in the candidate. The database selector receives
metadata inspection only. Relative/empty selectors, `:memory:`, `OPENCODE_TEST_HOME`
`OPENCODE_CONFIG` and `OPENCODE_CONFIG_CONTENT` are rejected rather than silently changing identity. Missing
selected directories also fail; the command creates none. No key/token/password,
loader or arbitrary inherited environment enters the report or prospective child.

Optional `--relay PATH --socket PATH --capability-file PATH` must be supplied together.
Only the relay code is read/hashed; the socket is not connected and the capability
file is not opened. These must refer to future disposable ORQST endpoints, never
native provider credentials. The report uses the installed local-MCP schema:
`mcp.servers.<name>` with `disabled:false`, `codemode:false`, `protocol:"legacy"`, and separate millisecond
timeouts of 10000 startup, 10000 catalog and 125000 execution. Inline configuration
merges with native definitions; it is not Claude's strict exclusion contract.

## Concrete native startup risk and historical launch block

Passive inspection of the exact installed executable resolved the earlier unknown
server-selection gate. The [official v2 CLI guide](https://dev.opencode.ai/v2/docs/cli)
also describes default shared-service discovery and the private `--standalone` option.
The installed `cli.server-connection.resolve` branches to its standalone endpoint
before service discovery when that option is selected. The endpoint starts its own
executable with `serve --stdio --port 0`, retains generated authentication internally,
and closes its stdin on scoped disposal. The stdio server defaults to `127.0.0.1`;
it does not load the service hostname/password/environment overrides. No server
registration, password extraction, external server selection or service restart is
needed. The candidate now includes `--standalone`, with no prompt, session, continue,
fork or permission-bypass argument. Native TUI session routing and descendant exit
still need runtime validation; source inspection alone does not accept them.

The remaining block is more concrete than a missing flag: the installed Credential
service uses the same storage Database service as native sessions. The database
initializer applies pending migrations and can bootstrap schema. Repointing
`OPENCODE_DB` or XDG data to a fresh location would discard the existing credential
identity; copying credentials is outside scope. Reusing the existing database can
run native migrations. `--standalone` changes server ownership, not database identity.

Evidence locations inside the hashed native binary:

| Area        | Embedded module / definition                                            | Passive finding                                                   |
| ----------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Connection  | `chunk-8yxcpb78.js`, `cli.server-connection.resolve`                    | Explicit standalone skips shared-service ensure/discover          |
| Child       | `chunk-amj8nfc0.js`, `cli.standalone.endpoint`                          | Owned `serve --stdio --port 0`, generated native authentication   |
| Serve       | `He` / `xe`, identifiable by `--service and --stdio cannot be combined` | Non-service stdio loopback default; lifetime tied to stdin        |
| Credentials | `Credential` service, identifiable by `Qn("credential")`                | Reads credential rows through storage Database service            |
| Database    | `chunk-nvjvnrg1.js`, storage `Database` / `sn` / `xo` / `Qo`            | Startup schema bootstrap, migration ledger and pending migrations |
| Path        | `chunk-7d1weqjx.js`, `nF`                                               | `OPENCODE_DB` overrides the default native data database          |

Only executable code/metadata was inspected. No live database, migration ledger,
credential row, native configuration or session was read. The installed database's
actual migration status is therefore unknown. No pending migration, login loss or
irreversible change has been demonstrated. Native OpenCode launch stays unavailable
because a new native process and its shared-state writes have not been authorized.
There is no supported no-migration startup contract established for this exact binary.

## Pinned-source review and a concrete existing-login decision

The official tag `v2.2.5` resolves to commit
`9bbb8ce18c80f099e0e448775f59d965ead40a21`. It was inspected in a separate,
read-only source checkout, without running OpenCode or opening any native user data.
This corroborates the binary review; the installed binary hash is still checked
independently. Current web documentation may describe a later version.

- [Standalone selection and child ownership](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/cli/src/services/standalone.ts):
  the private child uses native identity, its own generated server password and stdin
  lease. It does not require a second provider login.
- [Database initialization](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/core/src/database/database.ts)
  tightens database/sidecar permissions, opens a writable SQLite connection, applies
  WAL/tuning pragmas and invokes migration checking. The underlying SQLite driver's
  internal readonly option is not exposed by this CLI startup path.
- [Migration application](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/core/src/database/migration.ts)
  skips completed migration IDs and applies each pending migration plus its ledger
  entry in a transaction. A current database need not have any pending migration;
  checking the ledger would still require separately approved database access.
  Transactional application does not establish a downgrade/undo guarantee. Some
  historical migrations change/delete session data; this is not evidence that any
  such migration is pending on this machine.
- [Credential storage](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/core/src/credential.ts)
  uses that same Database service. Fresh data roots or a different database do not
  preserve the stored credential selection. Copying the database would copy secrets
  and is excluded from this workflow.
- [Native MCP schema](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/schema/src/config/mcp.ts)
  and [normalization](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/core/src/config/normalize.ts)
  require native server fields under `mcp.servers.<name>`. Direct `mcp.<name>` entries
  enter v1 decoding; an object timeout there is rejected. The candidate now uses the
  native wrapper, avoiding a silent omission of the ORQST relay.

The concrete compatible route is an **explicitly authorized standalone native
launch with the existing HOME/XDG/database identity**, followed by ownership,
new-session and native MCP validation. This avoids a duplicate login and service
adoption, but permits native SQLite/sidecar/configuration/session writes, possible
pending migrations and native credential refresh. Preserving identity is not proof
that the login is valid or that simultaneous access with the existing service has
been accepted. Native plugins, hooks and automatic activity also need review before
claiming a startup cannot invoke a provider. No such launch or inference is authorized
by this passive review, and was not authorized by that review. The subsequent [Desktop factory](opencode-desktop-terminal.md) now implements a blocked-by-default manifest and explicit startup opt-in with fixture-only evidence.

If shared-state startup writes remain prohibited, no functional embedded existing-login
route has been established for 2.2.5. Attaching to the existing server changes the
ownership contract, and isolating or cloning its database changes identity or copies
secrets. Neither is a safe fallback under the present constraints. The next decision
is permission for a bounded native acceptance with these specific shared-state risks;
provider inference requires its own explicit authorization. No migration or service
restart should be performed merely to make the passive plan appear complete.

## What fixtures prove

The pure plan tests reject hash/version drift, credential or identity injection,
relative/NUL paths, caller-selected argv/session IDs, and attempted native launch.
The real Node stdio relay tests extract command/args/environment from the generated
Claude/OpenCode documents in both source/worker orders and complete synthetic
A → B → A through private sockets and signed grants. They check role-specific tools
and absence of capability secrets in relay output/argv. Existing Codex configuration,
owned PTY, limits, input/focus, invalidation and MCP negative tests remain applicable.

This validates ORQST configuration-to-relay transport. It does not run a provider's
config loader, negotiate its SDK protocol, measure its timeouts, prove login/model
access, wake an idle worker or establish automatic delegation. The relay accepts
only MCP revision `2025-11-25`; native provider negotiation remains unmeasured.

## Required real acceptance for the three providers

| Provider            | Implemented                                                                                   | Still required                                                                                                                                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex 0.162.1       | Explicit native-login PTY/Desktop and scoped MCP opt-in                                       | Unlocked macOS focus/modal/input acceptance; exact installed startup/login/new session; native MCP handshake/tools/timeouts; approved bounded inference and A → B → A; owned stop/exit and external-session preservation                                            |
| Claude Code 2.1.178 | Explicit native-login PTY/Desktop, one-dispatch UUID and strict MCP opt-in                    | Same native focus/login/interaction and owned lifecycle acceptance; strict project/enterprise MCP approval; native handshake/tools/timeouts and separately approved inference/delegation                                                                            |
| OpenCode 2.2.5      | Passive candidate, explicit opt-in Desktop factory/lifecycle and synthetic relay/PTY fixtures | An explicit owner decision permitting native shared-state startup, or a reviewed no-write alternative; then descendant-lifecycle/new-session validation of the implemented opt-in factory, followed by focus/login/MCP and separately approved inference/delegation |

Do not run native OpenCode for this review. Login/config/MCP commands may select or
start a server and open shared state. The official CLI guide separately documents
`debug paths` as not opening the database or starting a server; that narrower claim
does not establish a safe native TUI startup, and it was not executed here. Do not adopt
the background service or external sessions as an acceptance shortcut. Synthetic
success and an unlocked console do not authorize provider inference.

## Security review

The new command and pure candidate do not participate in application startup.
Observer APIs, WebSocket/cookies/static serving, ingestion and schemas are unchanged.
No credentials are exported, no global configuration is written, no native database
is opened and no process/service is adopted. Existing native gestures, signatures,
ownership checks, sticky admission and OpenCode real launch refusal for unapproved manifests is retained. The subsequent Desktop opt-in expands private RPC/profile composition only.

> 2026-11-05: The project owner directed removal of real CLI binary SHA-256
> values from the repository. The historical findings above are otherwise unchanged.
