# Reviewed Codex/OpenCode pair

A newly loaded Desktop accepts exactly one Codex and one OpenCode manifest, in
either order, in the same canonical project. The default two-slot limit suffices.
Other mixed pairs and mixed selections of three through eight members are refused.
The creation wizard still prepares a homogeneous team; this increment composes
independently prepared manifests through the existing native selector.

Each slot retains its own adapter profile, executable pin, environment, native
identity selectors, private state/journal, native broker and one-use signed grants.
Codex settings never become OpenCode environment variables or vice versa. No
credential is copied, inspected or migrated by ORQST. The observer is unchanged.

| Slot provider  | Native identity                                               | Per-invocation MCP                                                                         | Startup authorization                                                          |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Codex 0.162.1  | Its own HOME/CODEX_HOME; private ORQST SQLite/temp            | Codex `-c mcp_servers.<name>` argv table; endpoint/capability file paths only              | Shared config/session acknowledgment and its native signed Start               |
| OpenCode 2.2.5 | Its own HOME/XDG/OpenCode selectors; native DB remains shared | Merged `OPENCODE_CONFIG_CONTENT` environment document; endpoint/capability file paths only | Separate startup/database/activity acknowledgments and its native signed Start |

Capability secrets stay in private files, never raw argv/environment values. Both
members still need their separate MCP opt-ins and the common native task grant.

## Continue in the client

Use a newly loaded build containing this change. Rebuilding never upgrades an
already running shell. Preserve existing windows, drafts, agents and reservations;
do not quit or reset that shell to expose the new selector. If it has uncertain or
active ownership, complete its existing lifecycle or keep the mixed test pending.
A separate profile does not reconcile an old reservation or isolate shared native
provider data, and must not be used to bypass that ownership evidence.

1. Prepare one unused private Codex manifest using the existing
   [Codex setup](managed-codex-terminal.md), and one unused OpenCode manifest using
   [OpenCode setup and native effects review](opencode-desktop-terminal.md).
   Select the same empty disposable project and different state directories. Use
   the exact reviewed installed native binaries. Preparation executes no CLI.
   Generic permission to test does not fill in OpenCode's separate startup,
   database-migration and native-activity acknowledgments. Keep its manifest
   blocked until those effects are explicitly accepted in the existing workflow.
   Do not edit an already reviewed/used manifest to remove its blockers.
2. Focus the observer window, then choose **Managed Terminal → Select and review
   existing terminal manifests…**. Select the two `terminal.json` files. The native
   chooser order assigns A/B; verify both full manifests, providers, identity paths
   and blockers in every review page, then choose **Keep reviewed selection**.
   Review creates no Core, journal, reservation or provider.
3. Choose **Open interactive terminal A/B**. A blocked OpenCode manifest blocks
   the whole selected runtime before Core/journal allocation; the Codex sibling
   does not start as a fallback. Re-reviewing cannot grant OpenCode startup.
   Existing journals/reservations also remain blockers. Opening an eligible pair
   initializes its Core/journals but starts neither CLI.
4. In each focused terminal separately, press **Start CLI** and review its exact
   native confirmation. Confirm only the intended identity and effects. These
   human gestures and one-use signed grants cannot be replaced with intercepted
   dialogs or a command-line start. Then **Connect output**, and separately
   **Enable keyboard input** if wanted. Check actual provider UI for login/model
   availability; `running` proves an owned TUI, not authentication or readiness.
5. For delegation, prepare both manifests with their existing MCP opt-ins before
   review. After both starts, use the separate native **Authorize one MCP task A → B → A** menu
   action; startup permission is not a task grant. Verify actual A-to-B processing
   and result return in the native CLIs. Generated configuration and synthetic
   relays alone do not prove installed MCP compatibility or real delegation.
6. Use each slot's existing native Stop flow. An owned OpenCode TUI exit does not
   prove its standalone server/descendants exited. Therefore **retirement remains
   refused and capacity reserved**, even after both TUIs exit. Never remove the
   marker, adopt discovered PIDs, kill unrelated providers or repair native data
   to make the test pass.

## Reproduce synthetic verification

After building with Node 24/pnpm 10:

```bash
pnpm accept:terminal-team --authorize-synthetic-pty --mixed-codex-opencode
```

This explicit developer command runs compiled synthetic CLIs through the native
selector, production Core, brokers, PTY backend and renderer in disposable storage.
Only temporary test bundles substitute OpenCode's reviewed executable hash. The
fixture checks provider-specific argv and environment, distinct identities,
independent starts/exits, cross-slot denial and preserved retirement refusal.
Native focus and dialogs are test doubles. It never runs Codex/OpenCode, accesses
credentials/native DBs or establishes human-modal, login, model or delegation
acceptance. The original homogeneous two/eight-slot harness stays available.

Real acceptance is pending the existing human startup-effects review, native start
confirmations and, for delegation, the separate task grant. Passive discovery may
find several OpenCode candidates or reject unsafe PATH directories; it does not
select a fallback or check login. No real success should be inferred from this
synthetic command or an unlocked macOS console.

## Verification scope — 2026-11-03

Node 24.22.2 / pnpm 10.34.9 passed lint, typecheck, all 564 unit tests and full
build. The existing Vite chunk-size advisory remains. The explicit mixed Desktop
harness passed, including observed retirement denial before marker verification;
the homogeneous two/eight-slot harnesses and native-selector blocked/partial-view
integration also passed. Focus/dialogs in these integrations were test doubles.
Unit tests additionally cover both mixed orders, one-sided MCP refusal, signed
source/worker roles, unsupported pairs/larger mixed teams and generated per-adapter
argv/environment documents containing capability paths without raw secret values.
An early new test failed because its synthetic Codex settings had not been updated
alongside its changed project; the fixture was corrected without weakening the
workspace check. Independent critical review approved the selection boundary.

Passive metadata review matched the reviewed local Codex and OpenCode executable
hashes without running either. Discovery reported multiple OpenCode candidates and
rejected unsafe PATH directories; no alternate binary was auto-selected. Native
login remains unknown and no start grant was available. The existing human
startup-effects/start/task confirmations are still required. No real CLI,
inference, native database/migration, credential, existing reservation, running
owner Desktop or unsaved draft was touched. Full browser regression and
`validate:local` were not rerun; observer ingestion/API behavior is unchanged.
