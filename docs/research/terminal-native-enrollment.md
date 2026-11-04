# Native incremental terminal enrollment review — 2026-11-04

Baseline: published `e44c6240181833dd885f688ce04b2e0c054c9143`, tag
`delivery/2026-11-04-cli-model-open-source`. Work is isolated on
`feat/live-enrollment-native-705`; main and the running Preview are not modified.
The frozen Core source `c1b89f86f71c0ecfc96d33efb8aca84bd8a1c1ba` was applied locally
as `28b8dba` to validate integration; additive documentation conflicts preserve both
histories. No mutable worker source is incorporated.

Node >=24 <25, pnpm 10.34.9, strict TypeScript ~6.0.3, React/i18next, xterm,
Tauri 2, existing Node Core and SQLite are retained. No dependencies, lockfiles,
process manager, PTY implementation or public API are added.

## Reference inspection and decisions

Anywh checkout `/private/tmp/orqst-anywh-682` was read-only at
`546f189c04415c3c5af5f40e3931a0a90b9aba31`. The required
[architecture](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md),
[Agent Host](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md)
and [runtime contract](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md)
were inspected before implementing the native extension.

| Candidate / exact source                                                                                                                                                                        | Dependencies and behavior                                                                                             | Decision / security difference                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [useTerminalTabs.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/hooks/tabs/useTerminalTabs.ts), `addTerminal`, `closeTerminal`, `removeSession` | React, UUID, localStorage; append retains earlier tabs, removing visual metadata is separate from process termination | Keep ORQST `TauriTerminalService`, retained native documents and SQLite layouts. Extend their arrays in place; do not copy browser persistence or add another tab/session owner. |
| [terminalSession.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/host/terminalSession.ts), `spawnTerminal`, `killTerminal`                        | node-pty, child_process and external tmux; `new-session -A` creates or reattaches, close kills the named session      | Do not use. Automatic tmux attachment/termination conflicts with signed ownership and uncertain-state preservation. Keep existing Core/Pair/admission/signed broker.             |
| [tailnet_sidecar.rs](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs), `TailnetSidecars`, `Running`                     | Tauri shell plugin, retained process per profile and serialized start-or-join                                         | Keep the existing attributed ORQST sidecar adaptation. Enrollment uses the current private pipe; it never launches another Core or joins an unknown runtime.                     |

The exact [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
is Apache-2.0; `git ls-files '*NOTICE*'` returned no entry. Inspected source headers
contain explanatory comments, with no additional license terms. No upstream source,
assets or dependency implementation are newly incorporated, so NOTICE is unchanged.
Tucano communication/routing is outside this change; the previous
[V6 review](v6-feature-foundation.md) is retained. Overclock is a UX reference only;
no exact licensed source/assets are established or copied.

The repository's instructed `docs/architecture/implementation-plan.md` and
`docs/architecture/tucano-audit.md` are absent from this tracked baseline. They were
not fabricated or rewritten. Current README, checklist, five original V6 Markdown
documents, HTML and existing research records remain the available references.

## Concrete reuse and limits

The existing `tauri-terminal-host.ts`, `TauriTerminalService`, `TauriTerminalLayout`,
`TauriFeatureService`, preparation helper, signed broker, native `Running` vectors,
Webview builder and real xterm document are extended. Feature assignment remains
an explicit CAS in the existing preparation path. Its previous layout is captured
before assignment and copied under expanded membership only after confirmed Core
admission. Rejection or uncertainty can leave assigned metadata without a usable
slot; preserve it, with no rollback or automatic adoption.

Admission is not Start, attach or input. Native creation and presentation failures
retain admission, old documents/processes and the original Core. Existing signed
operational Open remains the only launch/input path. Pure/facade checks do not
establish actual native WebKit, provider/model execution, cleanup or packaging.
See [workflow and actual checks](../development/terminal-native-enrollment.md).
