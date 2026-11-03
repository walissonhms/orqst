# Embedded managed Codex Terminal

**Current direction:** reuse installed CLIs/native authentication by default. This
guide covers the earlier optional separate-login profile and the
[explicit native-login PTY opt-in](#explicit-native-login-pty-opt-in--2026-11-03). `terminal:setup` defaults to reuse-existing with an explicit
shared-config acknowledgment for the structured path; those manifests stay blocked
in this PTY surface unless the additional interactive/session-write opt-in is selected. The legacy PTY path requires an explicit separate-login choice. Start with the
[passive existing-CLI preflight](local-cli-integration.md). Do not create two new
homes/logins as the default next acceptance step.

This opt-in checkout feature adds a real xterm.js terminal in each of up to two identified ORQST
Desktop windows, opened from the **Managed Terminal** menu. It is not an external
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
pnpm terminal:setup --authentication separate-login \
  --executable /absolute/path/to/native/codex \
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
permanent reservation of unresolved ownership slots. The native client accepts one or two manifests as one pair, with one independently
owned slot/journal per window. Both slots may use the same workspace; their provider
permissions and any approved project writes can still conflict. Structured Managed
agents is a different surface and is not a TUI terminal.

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

## Two interactive windows and shared admission

Repeat the explicit option with two **fresh** separate-login manifests to configure
Terminal A / T-001 and Terminal B / T-002:

```bash
pnpm desktop -- --terminal-config=/absolute/new-slot-a/terminal.json \
  --terminal-config=/absolute/new-slot-b/terminal.json
pnpm accept:terminal-pair --authorize-synthetic-pty
```

Each window has its own native session, document, broker, input lease, buffer and
instance identity. One IPC handler routes by the exact native main frame, never a
renderer slot; a document cannot address the other slot's instances. A single Node
Core owns the pair, with a supervisor/journal per slot and one active process per
slot. Navigation/reload fences that slot; it does not revoke the other slot.
There is no third window, independent second pair or shared input stream.
Duplicate manifests/states (including hard links), nested state roots and more than
two manifests are rejected before opening Core/journals. Existing journals are not
opened for recovery by this surface. Existing-login manifests without the additional
interactive/session-write opt-in display a blocked xterm view without creating
Core, journals, admission or a provider.
If either selected manifest is blocked, the entire pair opens blocked without Core.
No duplicate installation/login is performed automatically.

The PTY pair and structured Managed agents share the same sticky `active-pair.json`
in the Desktop profile's `managed-agents` directory. Claim occurs only at the signed
provider-dispatch boundary. A pre-existing or changed reservation blocks dispatch;
no timeout, PID probe, old receipt, manual evidence disposition or new manifest
bypasses it. Reservations from earlier runs remain untouched. Window close hides
the view and revokes input; it does not release capacity or signal a process.

After every dispatched attempt has an owned exit, focus either terminal and select
**Retire exited Terminal pair**. A native confirmation signs the complete current
metadata evidence. Core archives it and fences both supervisors before removing
only its own unchanged marker. An attempt prepared but never dispatched remains
prepared; no exit is invented. Failed archive/finalization preserves the reservation.
Host/channel loss, late exit after lost ownership and pending processes cannot
retire. Reload/navigation closes that slot supervisor and releases its journal
ownership; the pair then cannot retire, even if that slot had already exited.
Keep both live documents open until retirement. Restart with fresh manifests after retirement. Desktop quit discloses that
processes can continue and that unresolved reservations remain blocked.

Future PTY starts also create exclusive metadata-only lifecycle receipts before
spawn. The PTY host inherits only the receipt descriptor, synchronizes armed/start
and exit records independently of IPC, and reports exit only after its receipt
write completes. Receipts contain identity/config hashes and lifecycle timestamps,
not output, input, credentials or tasks. They support explicit evidence inspection;
they never adopt a survivor, rewrite an old journal or release lost capacity.

The two-window acceptance uses the real Electron/Node/PTY/xterm path with two C
fixtures and synthetic authentication in temporary state. Native dialogs are
intercepted. It checks simultaneous terminals in one workspace, independent keyboard
input, cross-instance denial, sticky reservation, signed retirement and durable
receipts. Provider startup/login, manual modal/focus behavior, accessibility, two
real-agent delegation and Claude/OpenCode compatibility remain unvalidated. The
normal observer/browser/Bridge continues to provide no execution authority.

A repeated acceptance on the final increment can stop at the native focus
precondition before any CLI start. In the observed refusal, Electron reported the
app visible but every native window and web contents unfocused after bounded
show/focus attempts. The gate was preserved. An earlier two-window transport run
passed; that does not accept the final additional reload/blocked-view checks or
human focus/modals. Final native acceptance remains pending in an available focused
macOS session, separately from the passing synthetic Node/MCP tests.

## Explicit native-login PTY opt-in — 2026-11-03

Codex now has a separate **experimental** interactive profile for native login reuse.
This is code plus synthetic Core/PTY evidence, not real Codex compatibility, native
login or two-agent acceptance. Existing structured manifests remain PTY-blocked.
Create fresh state only; never edit an old manifest, reset a journal, remove a
reservation or change a quarantined directory to enable it.

```bash
pnpm terminal:setup --authentication reuse-existing --acknowledge-shared-native-config \
  --interactive --acknowledge-shared-native-sessions \
  --executable ABSOLUTE_NATIVE_BINARY --executable-version OWNER_REVIEWED_VERSION \
  --project EMPTY_DISPOSABLE_PROJECT --state NEW_PRIVATE_SLOT
```

Repeat with another new private slot for B, then explicitly start Desktop with
both `--terminal-config=PATH` arguments as described above. Setup hashes files and
creates a manifest only; it executes no CLI and reads no credentials. The added
`interactive: {sharedNativeSessions:true}` manifest field is independent of
structured reuse. The native start confirmation must still be reviewed separately.
Do not start a real CLI until its exact binary/version, shared side effects and
operation have specific owner authorization. The version string is owner-supplied,
not a live protocol or authentication check.

Only the TUI profile is available in reuse mode; separate login is disabled in the
renderer and absent from Core profiles. Native `HOME`/`CODEX_HOME` remain shared and
no credential backend is forced. Fixed argv uses a new foreground TUI with
`--no-daemon`, read-only/on-request defaults and the existing structured path's
telemetry/hook/history/update overrides. No resume/session ID or initial task is
supplied. The upstream source review covers Codex `rust-v0.162.1`, commit
`092d3acd6bec3e3a14bdc7e7a2810ab628ab759d`; it does not prove the selected installed
binary. Newer public documentation may differ.

**This TUI is not ephemeral.** Native session files, configuration, MCPs, skills,
requirements and caches may remain shared; the CLI may create new sessions and
refresh its credentials. `history.persistence=none` concerns prompt history and
must not be described as disabling session persistence. A real TUI can write new
rollout JSONL files under the shared `CODEX_HOME/sessions` root even with prompt
history disabled. The synthetic fixture does not validate those native rollout
effects or promise that the shared home stays byte-for-byte unchanged. SQLite/log/temp paths are
private to each new slot; that is not filesystem/network containment. Native MCP
configuration can start other processes. ORQST neither copies credentials nor
writes/adopts/resumes external sessions, and no such source is modified by these
synthetic checks. Real native side effects remain unvalidated.

Per-instance ORQST MCP remains an independent synthetic transport library. This
profile does not install a relay or promise automatic delivery to an idle TUI.
Claude Code and OpenCode still have no launch adapter. See
[the provider-specific gates](interactive-cli-mcp.md).

### Native focus prerequisite

The pair opener now restores minimized windows and requests window/content focus.
The unchanged native sender predicate still requires both focus signals; the
router returns localized `focus_required` before preparing start, attach, input,
paste, keyboard write or stop when either is absent. There is no queued consent or
automatic retry. Blur still revokes leases and a closed native modal must pass the
existing final focus/document checks.

A repeated local acceptance attempt found the console **locked**, confirmed by
macOS IORegistry and CoreGraphics session metadata. All windows reported false
native focus. Showing the Dock, requesting regular activation and using a temporary
unique app bundle did not resolve that OS state; those experiments were removed.
`accept:terminal-pair` now detects a reported locked console before creating any
temporary state or fixture process and exits nonzero with an unlock instruction.
This diagnostic is not an authorization source. Unlock macOS, bring the Terminal
window forward, then rerun the same synthetic acceptance. No lock-screen bypass or
focus mock is provided. Positive native focus/modal/retirement acceptance remains
pending on an unlocked owner session.

The independent command below runs two actual compiled synthetic C processes
through the same Node Core, PTY hosts and reuse profiles using temporary homes,
unreadable synthetic native sentinels, synthetic signatures and owned exit receipts.
It requires the Desktop build and never starts Electron or a real provider:

```bash
pnpm build:desktop
pnpm accept:terminal-reuse --authorize-synthetic-pty
```

Its result covers native reuse profile transport only. It cannot accept human
focus/modal consent, actual credentials, model use or provider MCP integration.

### Verification of this increment

On macOS/arm64 with Node24.22.2 and pnpm10.34.9, this increment passed lint,
typecheck, 464 Node tests, full build, the disposable Electron45.2.1 smoke and the
new synthetic native-reuse PTY command. The build retains the existing dashboard
chunk-size warning. The pair GUI command exited nonzero at its locked-console
preflight; this is a reported blocker, not a passed focus acceptance. No real CLI,
native authentication query, inference, external session, quarantine or old
reservation was used or changed. Full Chromium and `validate:local` were not rerun;
observer ingestion and Bridge/API behavior are unchanged. Localhost served the
current dashboard index byte-for-byte after the build, without restarting Bridge,
Desktop or owned processes. The running Desktop has not hot-adopted the new native
code; use a later safe normal launch for that client update.

### Optional per-instance MCP composition — 2026-11-03

The separate `--interactive-mcp` setup flag now composes two acknowledged
native-login PTYs with one pair-scoped hub and separate per-slot relays/capabilities.
It accepts the reviewed Codex 0.162.1 configuration label only; native compatibility
remains unvalidated. Both opted-in manifests must share a project and keep separate
state. Start authorization and the native **Authorize one MCP task A → B → A** menu
confirmation are independent. No automatic prompt or task injection is added.

The additional randomly named MCP server merges with native MCPs. Native settings
are never rewritten. Endpoint paths enter the TUI argv; capability contents do not.
The required relay intentionally couples startup: **MCP failure can block the
interactive terminal**. Socket loss never proves provider exit or permits automatic
retry. See [the exact flow and evidence limits](interactive-cli-mcp.md#desktop-composition-opt-in--2026-11-03).
This adds synthetic composition evidence, not human focus/modal or provider acceptance.
