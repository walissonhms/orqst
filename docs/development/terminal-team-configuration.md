# Inert terminal team configuration

The shared native-client editor saves team name, stable terminal UUIDs, display
names, handles, descriptive roles and proposed directed permissions in the existing
private `terminal-layouts/preferences.sqlite`. Electron/Tauri PTY and structured
clients use the same strict protocol, editor and owned Core/Store backend. This is
an additive legacy-selection increment; it does not claim the V6 Feature UI.

Use **Load saved proposal** explicitly, edit fields, then **Save proposal**. A stale
revision is refused without overwriting another view's changes. Loading/saving does
not rename live panes, change layouts, start/recover processes, grant capabilities,
activate routes, cancel work or clear reservations. PTY proposals expose no route
activation button. The structured client can review each saved member against the
current live UUID bindings, then use the existing Cancel-default native signature
and separate exact-task grant. Unsaved edits disable saved-policy review.

The opt-in version-1 `terminal_team_schema` and `terminal_teams` tables reuse Store
transactions, Node SQLite, the existing directory/file/sidecar guards and 0700/0600
permissions. Records are bounded to 1–8 members, 16 KiB and 1024 selections. Unique
handles, exact UUID membership, self/duplicate/foreign edges and transitive cycles
are validated. Existing layout JSON stays byte-for-byte unchanged; execution and
communication journals are never imported, reset or adopted. No HTTP/WS endpoint,
listener, observer capability or dependency is added.

The structured runtime remains exactly two Codex members. Configuration coverage
for eight members is not N-member structured execution/provider acceptance. Native
WebKit/restart acceptance and full V6 Feature management remain separate gates.
