# OpenCode Desktop opt-in — 2026-11-03

This supersedes the no-factory gate in `fd5c26d`. The exact reviewed OpenCode 2.2.5
binary now has a Desktop factory, fixed `--standalone` profile, private Node PTY
host and version-3 manifest. The observer adapter is still a contract. No native
OpenCode, inference, native database, migration ledger or quarantine was accessed
for this increment. Existing processes/services were not adopted or restarted.

## Review first, without starting the CLI

Using Node 24/pnpm 10, select the already installed native binary and a new private
ORQST state directory outside the project and native OpenCode storage:

```bash
pnpm terminal:setup:opencode --executable /absolute/native/opencode \
  --executable-version 2.2.5 --project /absolute/project \
  --state /absolute/new-orqst-state \
  --acknowledge-shared-native-config --acknowledge-shared-native-sessions
```

This writes only the new ORQST `terminal.json` and `tmp` directory. It hashes the
selected executable and Node, validates directory metadata and never executes a
version/login command. HOME and any selected XDG roots, `OPENCODE_CONFIG_DIR` and
`OPENCODE_DB` are captured as absolute selectors. They are preserved literally;
credentials/configuration/database contents are never opened, copied or displayed.
Only the explicit DB selector's **parent directory** is checked; the database and
its existence, symlink status, contents and migration state remain uninspected.
Unsupported `OPENCODE_TEST_HOME`, `OPENCODE_CONFIG` and inherited
`OPENCODE_CONFIG_CONTENT` fail before provisioning. Arbitrary environment variables,
API keys, loaders and service passwords are not inherited. Existing native login
may still be unavailable, expired or depend on excluded environment/configuration;
there is no automatic alternate login or database clone.

Opening Desktop with `--terminal-config=/absolute/new-orqst-state/terminal.json`
renders a localized blocked view. It creates no terminal Core, journal, admission
marker or provider process for the blocked selection. The passive
`terminal:plan:opencode` command continues to be a non-executable review report.

## What starting can change and what requires authorization

Only after the owner explicitly accepts native startup, provision a **new**
manifest using the command above plus all three flags:

```text
--authorize-native-startup
--acknowledge-database-migrations
--acknowledge-native-startup-activity
```

This is an opt-in path implemented for future authorized use; these flags were
not used with a real provider in this change. Provisioning still executes nothing.
Desktop additionally requires its focused native confirmation and one-use signed
start grant. The presented manifest includes selected native identity paths and
ORQST state, but no secrets. Long native paths can make the complete confirmation
exceed 4096 characters; these requests are refused without truncation or launch. There is no background/observer/HTTP launch path, login command,
prompt/session/resume argument, permission bypass or automatic ORQST task.

The native CLI opens writable SQLite using the existing identity. Startup may
change database/sidecar permissions, write WAL/SHM and tuning pragmas, apply pending
migrations, refresh credentials, write sessions/configuration/cache/logs and run
native plugins/hooks/MCPs or network/provider activity. No pending migration or
actual login failure was demonstrated. The ledger is unknown; transactional
migration code is not an undo/downgrade guarantee. `--standalone` does not isolate
these writes from an existing service. Concurrent database compatibility is
unvalidated. Do not promise inference-free native startup: ORQST submits no task,
but native configuration/startup behavior is outside this fixture evidence.

The official [pinned standalone implementation](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/cli/src/services/standalone.ts)
selects an owned `serve --stdio --port 0` child with its generated authentication
and stdin lease. ORQST never extracts that password, adopts the existing service
or signals discovered PIDs. See the [database and source review](opencode-standalone-review.md)
for evidence and limitations.

Each manifest dispatches once, including failed startup. Native stdin input,
paste, attach and stop retain the existing signed focus/ownership boundaries.
The PTY has the existing 30-minute TERM/KILL deadline; this is not descendant
containment. Receipts establish only owned TUI process start/exit, not provider
readiness, valid login, successful migrations, new-session routing or descendant
server exit. Disconnect does not adopt/kill external processes. Capacity remains
reserved; native retirement is refused for selections containing OpenCode until
descendant lifecycle has separate evidence. There is no automatic marker cleanup,
DB repair, migration rollback, quarantine manipulation or retry into shared state.

## Optional MCP and verification

Add `--interactive-mcp --acknowledge-merged-mcp` only for two opted-in manifests
in the same project. Desktop composes distinct private relays and capabilities;
the generated `OPENCODE_CONFIG_CONTENT` is passed into the PTY process environment.
It uses v2 `mcp.servers.<name>`, legacy protocol, explicit startup/catalog/execution
timeouts and merges with native definitions. It never writes global config or
excludes native MCPs. Relay hashes and configuration are revalidated at dispatch.
Task authorization remains a separate native signed grant after both starts.

Fixtures cover the blocked default before journal/admission, paired acknowledgments,
identity preservation, unsupported selectors, single dispatch, binary/manifest
drift, owned PTY input/exit and v2 inline MCP composition/relay drift. Existing relay
A → B → A tests exercise generated provider documents. They do not run OpenCode's
config loader, SDK negotiation, actual timeouts or native plugin startup. Fixture
hash substitution exists only in disposable test bundles; production pins remain.

Real native startup requires explicit owner acceptance of the effects above.
Inspecting the real DB/ledger, native focus/login/new-session/descendant acceptance
and any inference/delegation need separately scoped authorization. An unlocked
console, synthetic success or an installed login is not that authorization.

## Security review

No dependencies, global configuration, source sessions, observer API, WebSocket,
cookie/static serving or database schema changed. The opt-in expands only private
Desktop/Core RPC profile/provider enums. Strict manifests, canonical directory
checks, executable/relay hashes, signed gestures, owned lifecycle receipts and
sticky admission are retained. Unknown database/descendant/native MCP outcomes
remain explicit instead of being represented as successful acceptance.
