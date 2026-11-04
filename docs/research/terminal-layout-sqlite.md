# SQLite terminal layout review — 2026-11-04

Baseline: ORQST `57f711e`, clean main; implementation isolated in
`feat/tauri-workspace-sqlite-694`. Node 24.22.2, pnpm 10.34.9, TypeScript
6.0.3, Electron 45.2.1, Tauri 2.12.5, React 19 and built-in `node:sqlite`
remain unchanged. This review covers visual preferences, not process recovery.

## Pinned sources and decisions

- **Keep ORQST Store and layout adapters.**
  [Store at baseline](https://github.com/walissonhms/orqst/blob/57f711e/packages/database/src/index.ts),
  `Store.transaction`, `terminalJournal`, `communicationJournal`, and
  [terminal layout store](https://github.com/walissonhms/orqst/blob/57f711e/apps/desktop/src/terminal-layout-store.ts),
  `terminalLayoutStore`, already provide SQLite transactions, isolated journals,
  validated UUID preferences and guarded private JSON access. Add an opt-in metadata
  table using the existing Store connection and transaction, and preserve the legacy
  reader. No duplicate execution manager, queue or provider adapter is needed.
- **Do not copy Anywh's tab persistence.** Inspected
  [useTerminalTabs.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/hooks/tabs/useTerminalTabs.ts),
  `loadPersisted`, `useTerminalTabs`, at
  `546f189c04415c3c5af5f40e3931a0a90b9aba31`. It imports React and persists
  session-scoped browser localStorage, without ORQST's private-file/SQLite contract.
  Its separation of tab metadata and process lifetime is preserved conceptually.
  The required `docs/architecture.md`, `docs/agent-host.md` and
  `relay/src/runtimes/README.md` were re-read in the separate research checkout.
- **Do not copy Anywh's reconnect mechanism.** At the same pin,
  [terminalSession.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/host/terminalSession.ts),
  `spawnTerminal`, `tmuxSocketName`, `tmuxSessionName`, `killTerminal`, depends on
  node-pty, tmux and a relay-port socket namespace. It uses tmux `new-session -A`;
  ORQST's current owned child/epoch/journal contract cannot treat that as proof of
  ownership. No tmux process, PID adoption or restart is introduced.
- **Keep ORQST database schema after inspecting Tucano.**
  [db.ts](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/db.ts),
  `MIGRATIONS`, agent/member/settings tables, uses node:sqlite and application-specific
  agent/engine/receipt types. Its handle uniqueness and membership records describe
  owned conversations, not authorization for ORQST's live PTY or structured transport.
  The existing attributed `mentioned` adaptation remains in use; no new routing
  policy or grant is inferred from layout names or restored metadata.
- **Overclock remains a visual reference only.** The official
  [Panes page](https://overclock.sh/features/panes), inspected 2026-11-04, describes
  independent panes and reorder. No exact public source repository, commit or reuse
  license was established. No source, assets, branding or runtime behavior is copied.

Anywh and Tucano root LICENSE files at these exact pins were inspected: Apache-2.0.
The Anywh tree has no additional tracked NOTICE. The selected source headers carry
no separate grant. No new upstream code or dependencies are incorporated, so the
existing root NOTICE and earlier modifications/attribution remain unchanged.
No package or lockfile change is required. Store retains Node standard modules and existing
protocol/shared dependencies. The protocol remains a pure zod schema leaf.

## Contract and security differences

One metadata database lives in the existing private layout directory. Its sole
writer is the existing owned terminal Core host, which opens/closes the existing Store around each
synchronous operation. It is separate from observer and execution journal databases;
there is no second writer to those stores and no terminal journal is opened by this
adapter. SQLite owns atomic commits; originals remain on disk after JSON import.

The native host chooses the directory and reviewed UUID selection. Renderer data
cannot select paths, SQL keys, process IDs or grants. Directory containment,
owner/private modes, symlink/hardlink checks, descriptor identity and `O_NOFOLLOW`
creation/inspection include SQLite sidecars. Same-user malicious pathname races are
outside the existing filesystem contract; this is not an OS sandbox guarantee.

See [workflow, migration and remaining work](../development/terminal-layout-sqlite.md).
