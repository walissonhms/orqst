# Interactive Terminal panels in the main Desktop window

## Cause and implemented correction

The earlier interactive composition created a `BrowserWindow` for each fixed A/B
slot. The dedicated document was a deliberate security boundary, but the native
window placement contradicted the approved integrated Studio experience.

`TerminalPanels` now reparents the existing dashboard view under a native `View`
container and adds each terminal as a sibling `WebContentsView`. There remains
one main `BrowserWindow`. This keeps execution authority out of the observer
renderer while placing both interactive terminals on the same application screen.
The existing structured **Managed agents** surface is a separate workflow and
retains its existing window; it is not an interactive terminal.

Use the native **Managed Terminal → Open … A / B** actions after reviewing the
existing manifests, or launch with the existing `--terminal-config` flags. Opening
a pane starts no provider. Opening both shows A on the left and B on the right;
one visible pane fills the content area. Native window resize resizes the panes,
and xterm fits/updates its existing bounded PTY dimensions. IDs A/B, T-001/T-002,
provider and immutable terminal/instance identities remain trusted native chrome,
separate from untrusted process output. **Session details** expands project/version
and the existing trust/authentication disclosures.

**Hide pane** hides that pane and gives the remaining pane the full area, or
returns to the dashboard. **Show dashboard**, also in the native menu with
Cmd/Ctrl+Shift+O, hides both panes. Reopen them from the native menu. The original
dashboard stays loaded: routes, preferences and memory-only drafts are preserved.
With a configured terminal pair, closing the main window hides it; reopening from
the tray/activation restores the same document. Quit retains the existing native
confirmation and Core disconnection policy. A hidden pane, detached output,
stopped process, retired pair and quit are different actions.

## Original specification coverage

Requirement source: the owner's original `ORQST_UI_UX_MASTER_SPEC.md`, section
3.2, **Studio — Multi-terminal workspace (highest priority)**, read together with
`ORQST_AGENTIC_MODE_SPEC.md`. The approved source requires integrated terminals;
separate top-level terminal windows do not satisfy it. This correction implements
a functional subset, not complete Studio acceptance.

| Section 3.2 requirement                                              | This delivery                                                                                                                                                                                         |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real integrated terminal rendering / Core / PTY                      | Implemented: A/B sibling native panels in the one main window, real xterm/PTY input/output, synthetic Electron acceptance                                                                             |
| Simultaneous terminals with clear identity                           | Implemented: fixed A/B pair, T-001/T-002 labels, provider, immutable Core/instance IDs and observed owned-process lifecycle                                                                           |
| Split layout / resize                                                | Partial: fixed side-by-side two-pane layout follows native window resize; hiding one gives the other full space. Drag handles, vertical stacking and arbitrary splits remain pending                  |
| Keyboard, paste, selection, scrollback                               | Existing trusted keyboard and separately native-confirmed paste preserved; xterm selection/scrollback retained. IME, mouse reporting, manual accessibility and OS clipboard acceptance remain pending |
| Terminal tabs, unread/attention indicators, rename, reordering       | Pending; native menu open/focus and hide actions are implemented, without pretending they are tabs or terminal closure                                                                                |
| Search, clear, explicit maximize/focus-mode controls                 | Pending; a single visible pane fills the area                                                                                                                                                         |
| Compact toolbar with model/reasoning/Fast/tokens/cost/approval badge | Partial: provider/project/identity/owned state and real existing controls only. No new model/usage/cost/approval capability is fabricated                                                             |
| Activity/Tasks/Metrics/Artifacts/Approvals inspector                 | Existing observer dashboard remains available and unchanged; an integrated terminal inspector is pending                                                                                              |
| Notification-to-terminal/task/event navigation                       | Existing observed-session navigation preserved; owned-terminal/task notification targeting remains pending                                                                                            |
| Persist terminal layout/session references                           | Pending; view switching and managed window hide retain this live document only. Crash/reboot/session restoration is not implemented                                                                   |
| External-session control boundary                                    | Preserved: observed sessions are never adopted or controlled                                                                                                                                          |

## Security and unchanged runtime

Each pane has an independent in-memory session/partition, sandboxed isolated
preload, exact reserved main frame and broker. Its network policy still permits
only the fixed local document/script/style, with no Bridge cookie or network,
iframe/webview, Node, permission grant, download, external navigation or popup.
The observer retains its own preload and cannot request terminal operations.

The native router binds to the actual pane WebContents, not the containing
window's observer WebContents and never a page-supplied slot. Mutations require
both parent-window and visible-pane native focus. View/window blur and window
hide revoke pending grants/input; view reload, navigation, crash and destruction
close only that slot's authority. Refocus/reopen never renews an input lease.
Layout-only IPC validates sender/frame/session and activation, accepts only hide
or dashboard, and cannot dispatch process operations. Native dialogs stay parented
to the main window and remain Cancel by default. A modal focus refusal fails closed.

No Core, PTY, provider environment/argv, login, MCP task transport, journal,
reservation, retirement or native session policy changes. Existing-login manifests
retain their explicit opt-ins and shared-state disclosures. No credentials are
copied, inspected or exposed by this change. Unknown ownership is never adopted,
cleared or retried merely to reopen a view. Partial construction destroys new
views and restores the original dashboard without clearing disk evidence.

## Verification and limits

Explicit disposable commands (never providers):

```bash
pnpm build
pnpm accept:terminal-pair --authorize-synthetic-pty
pnpm accept:managed-terminal --authorize-synthetic-pty
pnpm accept:terminal-selection --authorize-synthetic-review
```

The pair acceptance uses real Electron, isolated IPC/preloads, Node/PTY hosts and
two compiled labeled synthetic processes. It checks one BrowserWindow containing
both native panels, keyboard/output, independent IDs, cross-instance refusal,
hide/dashboard/window-close survival, owned exits, sticky admission, signed
retirement, receipts, blocked native-reuse controls and byte-preserved old markers.
The selection acceptance intercepts focus/dialog answers and checks cancel/drift,
blocked presentation and cleanup of partial view construction. Native modal
answers in all these checks are intercepted; they are not human-consent evidence.
Current correction checks passed on Node 24.22.2/pnpm 10.34.9: lint, typecheck,
495 Node cases, build, all three explicit acceptances above and the disposable
observer Electron smoke (`test:desktop`). The pair check also keeps the exact
edited Artifact textbox across dashboard/pane switching and native window hide,
then restores the original synthetic text before cleanup. The general Electron
smoke covers observation routes, Artifacts and Analytics saves plus the unchanged
structured client. Independent critical QA approved the sender/focus/lifecycle
boundaries. The existing dashboard chunk-size advisory remains. Full Chromium,
real-source `validate:local`, human-modal and real-provider acceptance were not run.

This slice is a fixed two-pane layout, not the entire Studio/Agentic Mode spec.
Drag resizing/reordering, durable layout/session restoration, arbitrary terminal
counts, terminal model switching and full keyboard/accessibility acceptance remain
pending. The independent structured Managed agents window is unchanged. Real
provider TUI/login, native human dialogs and the real two-agent MCP milestone are
not validated by synthetic processes. No provider, inference or credential access
is authorized for these checks. Rebuilding cannot hot-upgrade a running Electron
main/preload; a live client is preserved when restart would endanger its drafts or
owned processes. Observer ingestion is unchanged; local-data validation is not
required for this layout correction.
