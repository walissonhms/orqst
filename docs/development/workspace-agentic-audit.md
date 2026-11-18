# Workspace, Feature and Agentic Mode audit — 2026-11-17

Baseline `48290878939bf43f768dc0c73da9a650716e0b0e` on `feat/frontend-768`. This
increment corrects Feature layout persistence and the Studio orchestrator label.
The [V6 source specifications](../design/v6/README.md) describe the intended
product. The table describes the source on this branch.

## Workspace and Feature lifecycle

| Operation                                    | Current behavior and source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add an observed Workspace                    | **Add workspace** saves a name and path label through `POST /api/workspaces`. SQLite keys it by a stable digest of the supplied path. Submitting the same path is idempotent and retains the existing name. The path is metadata only. [Dashboard](../../apps/dashboard/src/App.tsx#L915), [Bridge](../../apps/bridge/src/server.ts#L250), [Store](../../packages/database/src/index.ts#L263).                                                                                                                                                                                                                                                                        |
| Switch an observed Workspace                 | Updates dashboard filtering/navigation and saves the preference in the current WebView's browser storage. A stale ID is cleared when a snapshot no longer contains it. The managed Core's reviewed project remains independent. [Dashboard state](../../apps/dashboard/src/App.tsx#L538), [storage](../../apps/dashboard/src/App.tsx#L583), [navigation](../../apps/dashboard/src/App.tsx#L843).                                                                                                                                                                                                                                                                      |
| Rename, delete or switch a managed Workspace | Studio exposes the one canonical project of the current owned Core. Its display name comes from the project basename. The observer has no rename/delete endpoint, and its add/filter controls do not bind or change a managed project. Neither catalog exposes Workspace removal. [Core](../../packages/core/src/terminal/host.ts#L68), [Studio snapshot](../../apps/desktop/src/tauri-feature-service.ts#L205), [REST routes](../../apps/bridge/src/server.ts#L250).                                                                                                                                                                                                 |
| Create or rename a Feature                   | The native facade persists metadata under a generated stable UUID. Edits are revision-checked. Titles and status are presentation metadata. A reviewed terminal UUID is exclusive to one Feature. The scope is fixed by the Core, and the normal assignment path derives the UUID from a reviewed slot. [Facade](../../apps/desktop/src/tauri-feature-service.ts#L320), [Core RPC](../../packages/core/src/terminal/host.ts#L464), [Store](../../packages/database/src/features.ts#L158).                                                                                                                                                                             |
| Archive or delete a Feature                  | Archive is an audited status update for an empty Feature. Assigned terminal UUIDs cause refusal even when their processes are absent. The record remains in the catalog. Hard delete, reassignment and lifecycle-aware archive of a populated Feature are pending. [Store](../../packages/database/src/features.ts#L178), [facade](../../apps/desktop/src/tauri-feature-service.ts#L324).                                                                                                                                                                                                                                                                             |
| Switch or reopen a Feature                   | A view CAS writes the preferred Feature UUID to the reviewed Workspace's private SQLite store. Selection replaces the presented membership, restores available panes and revokes the former input presentation. It leaves the Core processes running. On initialization, the same private store restores the preference and metadata. Restored metadata gives no process adoption or restart guarantee. Unavailable UUIDs remain in metadata. [SQLite view](../../packages/database/src/features.ts#L130), [initialization and presentation](../../apps/desktop/src/tauri-feature-service.ts#L86), [selection](../../apps/desktop/src/tauri-feature-service.ts#L363). |
| Save a layout                                | The private SQLite layout keeps names, member order, visibility, focus and split preferences. Studio arrangement modes, sizes and positions use WebView-local storage keyed by Workspace and Feature IDs. The latter survives a restart when the same WebView profile retains its storage. These are distinct preference layers. [SQLite layout](../../packages/database/src/terminal-layouts.ts#L37), [Studio scope key](../../apps/dashboard/src/FeatureWorkspace.tsx#L968), [Studio save](../../apps/dashboard/src/TerminalStudio.tsx#L423).                                                                                                                       |

Before the fix, a new member produced a different exact-membership key and a
direct assignment lost the visible effect of the saved SQLite layout. Assignment
now moves an existing Feature row to the new key in its membership, revision and
audit transaction. Existing names, order, visibility, selection, maximization and
split preferences are preserved. The new terminal is appended and shown. The
native facade drains pending layout writes and rechecks the presentation before
assignment. Private enrollment uses the already migrated layout, with the reviewed
prior layout as a fallback when the row is absent. Historical layouts stranded by
pre-fix assignments are left as stored. [Migration](../../packages/database/src/terminal-layouts.ts#L81),
[transaction](../../packages/database/src/features.ts#L214),
[facade](../../apps/desktop/src/tauri-feature-service.ts#L335),
[enrollment](../../apps/desktop/src/tauri-terminal-host.ts#L320).

## Agentic Mode and execution evidence

- **Studio orchestrator.** The crown and leading position represent one saved
  terminal UUID in the active Feature. A prior label could survive a Core clear
  in renderer state, and a rejected save could briefly show an unsaved label.
  Managed Studio now uses the authoritative snapshot, including explicit
  `null`, and offers the control only for a Feature. The crown itself grants
  no authority. The general **Delegate** button is disabled. The approved
  V6 HTML uses illustrative data and is outside the production dispatch path.
  [Studio](../../apps/dashboard/src/TerminalStudio.tsx#L389),
  [Feature wiring](../../apps/dashboard/src/FeatureWorkspace.tsx#L953).
- **Planning and task dispatch.** There is no production natural-language
  planner, plan review, dependency scheduler, automatic terminal allocation or
  cleanup. A human can prepare owned CLIs and work inside them. The opted-in
  Feature MCP hub can put an explicitly addressed task in a peer's inbox and
  query or return a correlated, explicitly submitted result. Its `delivered`
  state means inbox placement. The recipient has to read it, act and report
  through MCP. The hub task map is in-memory. The audit projection is a separate
  evidence source. [MCP peers](../../packages/core/src/terminal/mcp-hub.ts#L166),
  [delegation, result and status](../../packages/core/src/terminal/mcp-hub.ts#L292).
- **Approvals and stopping.** Native ownership, preparation and stop/retire
  reviews are separate from any CLI's tool approvals. The opt-in structured
  Studio has explicit controls to start a session, submit a turn, answer a pending
  provider approval, interrupt a turn, stop a session, and review a one-use grant
  with exact source/target sessions. The Core owns the structured execution and
  its evidence. Terminal hide and Feature switching are presentation actions.
  No general Agentic plan approval, workflow stop or cancellation UI is connected
  to the crown. [Structured Studio](../../apps/dashboard/src/StructuredAgents.tsx#L175),
  [grant form](../../apps/dashboard/src/StructuredAgents.tsx#L251),
  [native shutdown contract](../api/owned-terminal-shutdown.md#2026-11-06--explicit-stopretirequit-review).
- **Scope and status.** The ordinary MCP path resolves within the sender's exact
  Feature. The experimental cross-Feature Core contract requires exact targets
  in the same Workspace, bilateral policies, a signed one-use grant through the
  trusted port and an audit record. Tests inject those ports. The production
  Studio does not offer that route or cross-Workspace dispatch. A PTY's liveness,
  an agent's turn status, an inbox delivery and a task result describe different
  observations. A missing turn receipt remains unknown. [MCP target resolution](../../packages/core/src/terminal/mcp-hub.ts#L171),
  [cross-Feature contract](v6-cross-feature-communication.md),
  [Studio projection](../../apps/dashboard/src/studio-native.ts#L41).

## Owner native acceptance checklist

Use a separate owner-approved native candidate and a disposable project and
profile. Record the app's source SHA, locale and provider version. These scenarios
are pending native execution.

1. Add two observation Workspace labels, switch between them, and restart the
   dashboard with the same profile. Confirm the selected filter survives and
   the managed Studio still displays the reviewed project. Add the same label
   path with another title and confirm the existing Workspace name is retained.
2. Create two Features. Rename one and check that its member panes and layout
   follow the same Feature. Archive an empty Feature and confirm it remains as
   archived metadata. Attempt to archive one with assigned members and check the
   refusal and retained membership.
3. In the first Feature, save a distinctive arrangement. Give a pane a custom
   name, hide another and set a split preference. Add a reviewed unassigned
   terminal using Feature membership controls. Confirm the existing preferences
   are retained and the appended terminal is shown. Switch to the second Feature
   and back while an owned CLI is awaiting input. Verify the retained CLI session
   and transcript, exact membership, arrangement and hidden state. Reopen via the
   normal reviewed flow using the same private profile and check both Feature
   preferences again. Record process/session evidence separately from settings.
4. Set and clear the crown from the first Feature. Verify its display and ordering
   after switching, and confirm Unassigned has no crown action. Confirm the general
   **Delegate** control is disabled. Repeat the Feature and crown checks with
   `en-US` and `pt-BR`.
5. In an explicitly enabled structured pilot, use two disposable same-Feature
   sessions for a text-only exchange. Abort an approval when offered, interrupt
   an active turn and stop one session using their distinct controls. Verify the
   reviewed worker grant and a correlated result independently of the Studio
   crown. Record actual provider evidence, and mark any unsupported provider
   or unavailable control as such.

See [source research](../research/workspace-agentic-references.md). The checked-in
SQLite and Chromium-facade tests use synthetic metadata and are independent of
these owner scenarios.
