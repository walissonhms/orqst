# Diag27 terminal embedding

## Root cause

The Tauri launcher installed a full-window `feature-workspace` child at `orqst-features://local/index.html`. The old `apply_layout_current` path raised it above the React dashboard after the host opened its first Feature. The two documents owned separate renderer state. The full-window child had no optimistic card or live evidence for the just-enrolled slot. Its arrangement therefore left the terminal child hidden. The main dashboard, which did have the card, had neither a geometry bridge nor permission to arrange its bodies.

The actual process-open gate checks visibility and native AppKit first-responder ownership of the exact `terminal-N` document. A hidden body could not satisfy it. `terminal_open_prepared` re-armed the intent on certain pre-dispatch refusals, returned an idle response, and the terminal renderer queried again every second. Native's `cli_opening` attempts repeated while the overlay still lacked a body to focus.

## Embedding

The main AppShell owns the Studio and sends v2 card-body rectangles. The full-window Feature child and its packaged entry point are gone. Each retained `terminal-N` WebView renders an xterm body, starts at 1 × 1, and is placed after the native host accepts the current Feature membership and geometry. The AppShell keeps visual headers, menus and dock controls. Modal overlays hide native bodies and excluded cards send null rectangles. Existing platform-specific Electron documents remain available for the separate Electron runtime.

The native start still requires the current terminal URL, document and presentation, visible owned WebView, AppKit first responder, and a one-use native intent and signed broker authorization. Only one dispatch can consume an intent. The body waits at most 12 times for dispatchability after it becomes visible, then abandons its unused intent. A refusal with native evidence that the launch did not start keeps the card failed and enables a fresh picker. An uncertain outcome retains its evidence and stays fenced.

The packaged incremental test also exposed a presentation race. Hiding an old body for the picker changes the rectangle revision. Passive catalog reads now correlate the current owned pool independently of those geometry changes. A pending open holds geometry until native accepts or refuses the request. The launch itself still checks the full admission, including its revision. The renderer reads the new slot as soon as enrollment returns its UUID.

## Reference review

Anywh retains the xterm body inside a React-owned panel. `TerminalPanel` renders one body per tab and hides inactive ones. `TerminalView` mounts xterm and FitAddon into the supplied container and connects to the Relay's PTY session. ORQST adapts the placement principle and keeps its existing isolated child WebViews, orqst-terminal document checks, native geometry validation, and signed broker. Anywh's Relay WebSocket and tmux transport has a different authorization contract. This change incorporates no upstream source or dependencies. The pinned tree has an Apache-2.0 LICENSE and no root NOTICE. [TerminalPanel](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/client/src/components/terminal/TerminalPanel.tsx#L100-L119) · [TerminalView](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/client/src/components/terminal/TerminalView.tsx#L63-L170) · [Relay terminal session](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/relay/src/host/terminalSession.ts#L104-L137) · [LICENSE](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/LICENSE)

## Packaged macOS acceptance

Built a debug Tauri Preview bundle from the isolated worktree with the shared Cargo target. The acceptance bundle used its own app identifier, loopback port, app-data directory and a registered empty work folder. The provider processes and their frames came from the installed CLIs. AX sampled the React starting card after `AXPress`. The first frame timestamp came from the matching `first_pty_output` diagnostic, which requires bytes from the owned PTY. The screenshots are 1280 × 860 window captures from `screencapture -x -o -l`.

| CLI                       | Click → starting card | Click → first PTY frame |
| ------------------------- | --------------------: | ----------------------: |
| Codex, cold terminal host |                 24 ms |                3,093 ms |
| Codex, second terminal    |                 20 ms |                2,506 ms |
| OpenCode                  |                 40 ms |                7,084 ms |
| Claude                    |                 94 ms |                8,525 ms |

Each opening recorded one `cli_opening requested` followed by `ready` and
`first_pty_output ready`. The same four bodies returned after visiting Visão geral,
with no additional CLI launches. Claude rendered its workspace-trust prompt and
OpenCode rendered its native prompt. The 3-second target was met by the second
Codex open. Cold Codex varied between 2,745 ms in the earlier run and 3,093 ms in
the later run. OpenCode and Claude exceeded the target. The measurements end at a
first PTY frame. Provider authentication and task turns were outside this run.

- [First Codex body in the Studio, earlier run](diag27-terminal-embedding/codex-first-frame.png)
- [Two independent Codex panes](diag27-terminal-embedding/two-codex-terminals.png)
- [OpenCode in its own pane](diag27-terminal-embedding/opencode-first-frame.png)
- [All four PTYs, including Claude's workspace-trust prompt](diag27-terminal-embedding/four-terminals.png)

The final ad-hoc signed rebuild also recorded a focus loss between enrollment and
dispatch. Native cleared the unused intent, the card stayed in the Studio with
an unconfirmed result, and there were no CLI dispatch attempts for that card.
After bringing the window forward, a fresh Codex open showed its card in 18 ms
and produced its first PTY frame in 1,889 ms. The separate native close check
did not confirm an exit through the Studio's Encerrar processo action.

The isolated Preview was quit with AppleScript. Its shutdown left previously started acceptance supervisors alive. Their executable paths, working directories and process ancestry matched the isolated run, and those process trees were stopped separately. Shutdown behavior remains outside this fix.

## Checks

| Check                                                    | Result                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm lint` and `pnpm typecheck`                         | Passed                                                        |
| Focused Node tests                                       | 74 passed, including passive catalog and open refusal         |
| Chromium with `--workers=1`                              | 7 passed, 1 optional reference capture skipped, 9 failed      |
| Chromium on untouched `a549ff9`                          | Same nine failures in the older L3 and Studio workspace specs |
| Cargo Tauri suite with `--test-threads=1`                | 202 passed, 2 ignored                                         |
| Cargo terminal-core suite with `--test-threads=1`        | 71 passed, 1 ignored                                          |
| Dashboard build, resource staging and Tauri debug bundle | Passed                                                        |

The Chromium acceptance added here passed. It covered AppShell geometry, hiding
native bodies under the picker, and the failed card's retry action. The historical
`accept-v6-features.ts` harness expects components from the retired native shell.
The packaged tests above used the installed CLIs through the AppShell.
