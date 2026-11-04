# Private team configuration

Team proposals persist in the existing private `terminal-layouts/preferences.sqlite`.
They contain team name, stable terminal UUIDs, display names, unique handles,
descriptive roles and proposed directed permissions. This delivery is Core-only;
it does not add a desktop editor or claim the approved V6 UI is implemented.
See the [V6 private Feature contract](v6-feature-core.md) for composition and scope.

`terminalTeamSchema` excludes PIDs, instance bindings, capabilities, native sessions,
grants and process state. `TerminalTeamState` is `{ revision, configuration }`; an
absent selection has revision 0 and null configuration. Save supplies
`{ expectedRevision, configuration }`. Store checks the revision and entire reviewed
UUID set in one transaction; a stale write cannot overwrite another view's work.

Loading/saving does not rename live panes, change layouts, start/recover processes,
activate routes, cancel work or clear reservations. `teamRoutingProposal` maps saved
terminal UUIDs to exactly one ready managed live pane each, in the exact workspace
and Feature. It returns a proposal only. The host must still use the existing
native review/signature, live `configureRouting` validation and separate exact-task
grant. No PTY task injection or new communication manager exists.

Version-1 `terminal_team_schema` and `terminal_teams` tables reuse Store transactions,
Node SQLite, the existing directory/file/sidecar guards and 0700/0600 permissions.
Records are bounded to 1–8 members, 16 KiB and 1024 selection records. Unique handles,
exact membership, duplicate/self/foreign edges and transitive cycles are validated.
Legacy selection keys and Feature keys have separate namespaces. Existing layout
JSON stays byte-for-byte unchanged; no execution journal is imported or adopted.
Adding a Feature member changes its complete selection; earlier selection proposals
are retained but are not automatically applied to the larger set.

The structured native composition remains two Codex instances. Eight-member
configuration tests do not establish N-member structured/provider execution. No new
HTTP/WS route, listener, observer capability, dependency or shell permission exists.
