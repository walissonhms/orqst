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

### Select an existing manifest in a running Desktop

An updated Desktop now offers **Managed Terminal → Select and review existing
terminal manifests…** in its native application menu. No restart or argv is needed
to select manifests in that running build. The observer window must be focused;
its local offline page also supports this native-only action. No renderer method,
path field, drag/drop, second-instance argv import or HTTP endpoint is added.

1. Choose one or two existing private manifests with the native file chooser. The
   chooser's returned order is A, then B; the review shows each exact assignment.
   Live selection accepts only one provider for the whole pair. MCP still requires
   two opted-in manifests in the same workspace. This deliberately excludes new
   cross-provider composition; existing startup-argv behavior is unchanged.
2. Review the complete manifest contents, source hash/inode, state identity and
   blockers in a Cancel-default native dialog. Details over 4096 characters are
   refused, never truncated. The dialog transaction expires after 60 seconds.
   Blur, navigation/reload, destruction, expiry and drift refuse registration.
3. **Keep reviewed selection** stores only memory. There is no Core, journal,
   admission claim, provider, native DB inspection or manifest modification. Before
   opening, another explicit review can replace that memory selection; cancellation
   preserves the prior selection. Paths never enter the dashboard renderer.
4. Separately choose **Open interactive terminal A/B**. Files, executable hashes,
   canonical directories, inode identities and blockers are inspected again. Drift
   refuses opening and permits explicit re-review before initialization. An OpenCode
   review manifest opens the existing blocked view, with no Core/journal/provider.
   An executable selection initializes the existing Node Core and new journals;
   it still starts no CLI. The existing user-data admission domain and sticky
   capacity are used. A reservation refusal is not bypassed or reconciled.
5. Once pair initialization is attempted, selection is fixed until a fully proved
   native signed retirement and old-surface/Core cleanup. OpenCode still cannot
   retire because descendant exits are unvalidated. Deterministic blockers and
   uncertain failures keep selection fixed; no live slots are replaced. Opening
   an already loaded terminal only shows its existing window. Actual CLI startup
   still requires the separate focused native broker confirmation and one-use
   signature. A review does not change any manifest authorization flags.

No broker can dispatch while the pair is still being initialized. If a later
window fails to load, its private router/Core connections and partial windows are
closed; any disk/admission evidence is retained. No provider is signaled and the
initialization latch still refuses another attempt in this Desktop run.
If Core created journals before the failure, those journals remain reserved and
the same manifests will hit `existing_state` in a later run, even when no provider
was dispatched. This change offers no journal cleanup or recovery shortcut.

The native chooser/review cannot be used while an Artifact/Analytics file dialog
is pending. During pair initialization, quit is deferred until that bounded Core
connection attempt returns; it does not signal any process. Native human-modal
focus/visibility acceptance remains pending. Same-user malicious replacement races
remain outside the trusted-user model; the existing final dispatch revalidation
and native grant still apply.

This is live manifest selection in a **newly loaded shell**, not hot replacement of
an older running Electron main process. Rebuilding does not add the menu to an
already loaded old shell; second-instance activation does not upgrade it. Preserve
the owner's running windows/hosts/drafts. See [safe build freshness](desktop.md#checking-which-build-is-active-without-losing-work).

## What starting can change and what requires authorization

The native creation wizard now offers a separate Cancel-default review of the
complete blocked plan: keep blocked, or explicitly acknowledge startup/database/activity
effects before the final full-manifest review. This prepares files only; it does not
start OpenCode. Generic login consent does not authorize this choice. The choice has
synthetic intercepted-dialog evidence only; real effects have not been authorized or run.
See [client consent and safe retirement](cli-team-recovery.md).

Alternatively, only after the owner explicitly accepts native startup, provision a
**new** manifest using the command above plus all three flags:

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
The [pinned startup safety investigation](opencode-startup-safety.md) evaluates native
policies, simulation and external containment; no all-code no-inference boundary
was established. A timeout is not evidence of zero billing.

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

`pnpm accept:terminal-selection --authorize-synthetic-review` runs a disposable
Electron/Bridge integration with a blocked synthetic OpenCode manifest. Its temporary
bundle substitutes only the synthetic executable pin; production pins stay unchanged.
Native focus and chooser/review answers are intercepted, so this is wiring and
preservation evidence, not human/native/provider acceptance. It checks cancel,
blur/navigation invalidation, drift/re-review, existing reservation preservation,
registration without writes and opening the blocked view without a Core/journal.
An injected second-window failure checks that partial views are destroyed while
the observer, original manifests and synthetic reservation remain intact.

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

The live-selector increment passed Node 24.22.2/pnpm 10.34.9 lint, typecheck, all
494 Node tests and full build. The existing disposable Desktop smoke and the new
explicit selector integration also passed; dialogs/focus in the latter are doubles,
including the injected partial-window failure. The existing Vite bundle-size
advisory remains. The full browser suite and `validate:local` were not rerun;
ingestion and observer APIs are unchanged. Native OpenCode, login, database/ledger,
inference, descendant exit and human-modal acceptance remain unrun/unvalidated.

## Security review

No dependencies, global configuration, source sessions, observer API, WebSocket,
cookie/static serving or database schema changed. The opt-in expands only private
Desktop/Core RPC profile/provider enums. Strict manifests, canonical directory
checks, executable/relay hashes, signed gestures, owned lifecycle receipts and
sticky admission are retained. Unknown database/descendant/native MCP outcomes
remain explicit instead of being represented as successful acceptance.
