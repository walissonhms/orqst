# Embedded managed Codex Terminal

This opt-in checkout feature adds a real xterm.js terminal in a dedicated ORQST
Desktop window, opened from the **Managed Terminal** menu. It is not an external
terminal window or an inert transcript. Normal observer startup still launches no
provider. Codex is the first fixed managed profile; Claude Code and OpenCode are
not enabled. Real Codex/provider acceptance remains pending specific authorization.

## Trust and provisioning

The owner selected **native trusted/same-user execution** for this increment. The
chosen executable runs with the macOS user's privileges. It is not a container,
VM, resource sandbox or defense against malicious same-user processes. A project
cwd is not filesystem containment. Hash/path/permission checks catch drift before
admission and dispatch; they do not provide immutable kernel binding against
same-user replacement races. Hard containment would be a separate backend decision,
not a prerequisite silently imposed on this native mode.

Use Node 24/pnpm 10 on non-root macOS arm64. Select the actual native Codex binary,
not an npm shell/JavaScript shim that depends on an inherited user PATH. Version is
owner-supplied metadata, not an ORQST claim that the executable was queried or
provider behavior was validated. Setup hashes the executable and current Node
without running either provider commands or authentication queries:

```bash
pnpm terminal:setup --executable /absolute/path/to/native/codex \
  --executable-version YOUR_REVIEWED_VERSION \
  --project /absolute/path/to/project --state /absolute/path/to/NEW-private-state
pnpm build
pnpm desktop -- --terminal-config=/absolute/path/to/NEW-private-state/terminal.json
```

The state parent must exist; the state directory must be new and outside the
project. Existing directories are never imported or overwritten. Setup creates
owner-only state (`0700`), a separate `HOME`, `CODEX_HOME`, temporary directory,
fixed Codex settings and a private manifest (`0600`). Canonical paths, owner/mode
and executable SHA-256 are checked again on use. A changed settings file fails
closed; do not substitute a user's existing Codex home, config or sessions.

Opening the configured Desktop creates a private Node Core component and metadata
journal, not a provider. Native confirmation is still required for each start.
An already running Desktop does not hot-adopt a new config from a second launch.
No service restart, push or production activation is part of development acceptance.

## Login and interaction

1. Open the ORQST native **Managed Terminal** menu, then **Separate Codex login**.
   Confirm the fixed executable/project/operation in the native dialog. The profile
   runs only `codex -c cli_auth_credentials_store="file" login --device-auth`.
   Complete device authentication yourself outside the terminal's network-restricted
   renderer. ORQST does not follow login URLs, import tokens or access the OS keyring.
2. **Attach output** displays login output in xterm. Login and agent start are
   separate owned instances and confirmations. Auth-file existence/private metadata
   is a prerequisite, not proof of valid provider authentication or model access.
3. After login exits, choose **Start Codex**, then **Attach output** and **Enable
   keyboard input**. Startup defaults are `--no-daemon --sandbox read-only --ask-for-approval
on-request`; provider UI can change permissions. These are provider defaults,
   not an ORQST-enforced sandbox. System/provider configuration may still apply.
4. Keyboard input uses a two-minute sequence-bound lease. Native blur, detach,
   navigation or transport loss revokes it. User paste is separately confirmed with
   exact text (the native review currently limits it to 1,024 characters). Emulator
   replies are never forwarded automatically. IME and mouse-reporting support remain
   unvalidated; this initial client forwards trusted keyboard events.
5. **Stop (TERM)** and **Force stop (KILL)** are distinct native-confirmed signals
   against the live owned handle. Ctrl+C is a terminal byte, not an asserted
   cancellation. `running` means owned OS process evidence, not provider readiness,
   task success or authentication. Only owner exit callbacks report exit.

The UI displays the exact project/version and current random instance identity.
Process instance, attachment, client/epoch and observed session identities remain
separate. No observed session can be adopted, resumed or controlled. Structured
delegation and automatic results are not inferred from terminal prose; the future
two-agent milestone needs its own explicit task/result channel and provider evidence.

## Ownership, output and recovery

Electron is a native client, not a database writer. Its ephemeral signing key stays
in main; the isolated preload receives only the existing strict Terminal contract.
A separately pinned Node process owns the supervisor, journal and private inherited
IPC; a Node PTY host owns each provider handle. The renderer accepts no command,
cwd, environment, credential, arbitrary IPC, provider approval or resume request.
The observer HTTP/WebSocket/cookie surface receives no execution authority.

Closing the Terminal view hides it, preserving the live document/process. Reopening
from the menu returns to it with input revoked. Desktop quit or transport loss marks
nonterminal attempts uncertain and never sends an implicit signal. Each PTY host
retains the start-authorized 30-minute deadline, then TERM and, after five seconds,
KILL against its owned process. This does not prove hostile descendant cleanup or
hard CPU/memory limits. No stored-PID signaling, survivor adoption, automatic retry,
restart, resume or lost-slot reconciliation exists. A failed provider start can
consume uncertain capacity; diagnostics do not invent success.

The private SQLite journal uses the existing Store in its own terminal state,
never the observer database. It stores metadata only; input, terminal output,
prompts and credentials are excluded. Codex may retain its own history/authentication
inside its dedicated home. Existing journal caps and epoch fencing apply, including
permanent reservation of unresolved ownership slots. This initial native UI selects
one configured project and instance at a time; concurrent multi-agent UI is pending.

Output drains into the bounded 1 MiB memory ring and a 2,000-line emulator scrollback.
Reads are bounded and acknowledged after emulator parsing. A ring gap visibly stops
screen reconstruction/input; it is never replayed as a complete terminal screen.
OSC clipboard/title/link operations, automatic terminal replies, navigation, downloads,
remote requests and permission grants are disabled. xterm needs dynamic local styles,
so only this separate document permits inline CSS; scripts retain the strict local
allowlist. No captured content is interpreted as HTML or persisted by the view.

## Reproducible disposable acceptance

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm accept:managed-terminal --authorize-synthetic-pty
```

The explicit acceptance builds a small labeled C fixture into a temporary native
executable and uses the real Desktop, restricted preload, Node Core, journal, PTY
and xterm path. It uses a disposable empty observer, synthetic authentication and
temporary Electron profile. Native dialogs are intercepted. It never executes an
installed provider, reads real sessions/config/credentials or incurs provider cost.
Genuine human-modal/accessibility and real Codex login/start/sandbox/approval/exit
acceptance require separate owner authorization; synthetic success is not that evidence.

References checked for configuration/flags: [official CLI reference](https://developers.openai.com/codex/cli/reference/),
[configuration reference](https://developers.openai.com/codex/config-reference/) and
[xterm security](https://xtermjs.org/docs/guides/security/). Moving documentation does
not establish compatibility with the exact owner-admitted Codex binary.

Revoking/destroying the native Terminal document also disconnects the dedicated
Core channel. Core then revokes its enrolled public key and closes its journal;
revocation is not confined to Electron's local signer. A normal view hide only
revokes input, preserving that live document/Core. Proposed xterm APIs are disabled.
