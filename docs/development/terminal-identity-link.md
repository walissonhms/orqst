# Stable terminal identity link — 2026-11-04

The structured Codex adapter now records the same stable `terminalId` used by the
PTY grid and UUID-based layouts. It comes from the reviewed manifest's immutable
identity, or the existing deterministic legacy-state identity helper. The field is
optional in communication schema v1 so old SQLite metadata remains readable without
inference or a destructive migration. Existing native agent details display it as
plain text through the shared snapshot document in Electron and Tauri.

This is a metadata link, not a communication destination or recovered process.
`paneId`, `instanceId`, owner epoch, exact grants and runtime evidence retain their
existing responsibilities. A fresh attempt after confirmed exit keeps its terminal
UUID but receives new live pane/instance bindings and an empty route matrix. Old
bindings cannot enroll an adapter for the new attempt. An unavailable/unclosed pane
keeps the terminal identity reserved; metadata does not bypass an unknown outcome.
External observed panes cannot claim a managed terminal identity. Names/roles do
not grant authority, and the queue never resolves a terminal UUID as a target.

## Research and reuse

- **Keep ORQST** `terminalIdentity`, `CodexStructuredRuntime.launch`,
  `PaneCommunication.registerPane`, `communicationPaneSchema` and the existing
  SQLite communication journal. The existing identity helper already maps reviewed
  manifests; another identity generator or process/session manager would diverge.
  Identity baseline [57f711e](https://github.com/walissonhms/orqst/tree/57f711e),
  with the independent SQLite layout increment already committed locally.
- **Keep ORQST after inspecting Anywh**
  [CodexSessionDriver](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/codexDriver.ts),
  `setSessionId`, `getSessionId`, thread/turn handling. Its native thread identity
  and optional resume semantics depend on daemon/history/session contracts; they
  cannot replace ORQST's terminal metadata UUID or confer ownership. The required
  architecture/Agent Host/runtime documents and terminal persistence code were
  re-inspected for the [layout increment](../research/terminal-layout-sqlite.md).
- **Keep the existing attributed Tucano mention adaptation**, not its agent catalog
  as runtime authority. At
  [0501956](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/db.ts),
  `MIGRATIONS` separates agent ID, handle, role and conversation membership. Those
  node:sqlite/application engine records differ from per-attempt signed ownership
  and queue grants. No upstream schema or runner is copied.
- **Overclock remains visual only**: the inspected official
  [Panes reference](https://overclock.sh/features/panes) has no established exact
  source SHA or compatible reuse grant. No source/assets or status inference copied.

The inspected Anywh/Tucano root licenses are Apache-2.0 at those exact pins. No new
upstream fragment or dependency is incorporated; existing NOTICE attribution stays
intact. All new code reuses existing ORQST helpers and contracts.

## Checklist and limits

- [x] Shared stable terminal UUID reaches structured pane metadata and snapshots.
- [x] Optional-field compatibility and SQLite roundtrip without process activation.
- [x] Duplicate live/unavailable enrollment denied; external claims denied.
- [x] Fresh live pane IDs/bindings and grants stay independent of stable identity.
- [ ] One shared editor/catalog for PTY names, handles, roles and permission policy.
- [ ] SQLite team/configuration restoration with live route revalidation.
- [ ] Remove the structured two-Codex composition limit with executable N-member checks.
- [ ] Native/provider acceptance, authenticated reconnection and platform distribution.

Those unchecked items remain open; the metadata link does not complete criterion 7
or turn PTY text into task evidence. Runtime admission, journal recovery, historic
quarantine and Git authentication are unchanged. No provider is run by the tests.

## Verification

`pnpm lint`, `pnpm typecheck`, `pnpm build` and `pnpm build:tauri-resources`
passed. The full bounded-concurrency command
`pnpm exec tsx --test --test-concurrency=2 tests/*.test.ts` passed **678 tests**
without failures, cancellation or skips. The focused communication/runtime run
passed 87 tests before the final manifest-identity/SQLite-roundtrip assertions;
the full run includes those final assertions.

`pnpm accept:tauri-agents --authorize-synthetic` passed against newly staged
resources: exact manifest UUIDs in both pane snapshots, independent live pane IDs,
signed starts/routes, denied cycles, autocomplete, correlated result, confirmed
owned exits, retirement and pipe shutdown. Native IPC/focus/dialogs were simulated
and Chromium exercised the shipped client; neither native WebKit/provider acceptance
nor durable reconnect is claimed. The Vite large-chunk advisory remains unchanged.

No Rust/native compilation, real-data ingestion validation, real providers,
platform installers or manual native acceptance was run for this metadata change.
No runtime capability was broadened and no historical reservation was read or changed.
Rollback preserves journals. Older strict readers may reject newly extended pane
records; there is no automatic downgrade/backfill or removal of retained metadata.
