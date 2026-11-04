# Terminal workspace layout research — 2026-11-04

Baseline: ORQST `368bbc1`, inspected in an isolated worktree. Node 24.22.2,
pnpm 10.34.9, TypeScript 6.0.3, React 19.3.1, Electron 45.2.1, xterm 6.0.0,
FitAddon 0.11.0, node-pty 1.1.0 and SQLite remain unchanged. The master specification
sections 5–6 require session-preserving visual management, independent from the
already attributed Tauri/Core and byte-framing adaptations.

## Source inspection and decisions

- **Keep ORQST:** `apps/desktop/src/terminal-panels.ts` `TerminalPanels`,
  `terminal-layout.ts` `terminalPaneBounds`, `terminal-document.ts`,
  `managed-terminal-client.ts` and its FitAddon/resize/input revocation,
  `terminal-runtime.ts` native document authorization. The existing composition
  separates observer and managed documents, independent session partitions and
  immutable Core identities. It already owns 1–8 documents but shows at most two.
  Extending those bounds/state avoids process replacement and scrollback loss.
- **Keep ORQST after Anywh inspection:** pinned
  [Anywh `546f189c04415c3c5af5f40e3931a0a90b9aba31`, TabGroupLayout.tsx](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/shell/TabGroupLayout.tsx),
  `TabGroupLayout`, `resolveTabDrop`, `groupCssVars`,
  [usePanelDrag.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/hooks/tabs/usePanelDrag.ts) `usePanelDrag`,
  [useTerminalTabs.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/hooks/tabs/useTerminalTabs.ts)
  `loadPersisted`/`useTerminalTabs`, and
  [TerminalPanelSlot.tsx](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/terminal/TerminalPanelSlot.tsx).
  Actual code preserves underlying groups while compact mode shows one panel;
  terminal tabs persist client metadata in localStorage, separately from process
  attachment. `TabGroupLayout` imports React, dnd-kit, app-specific i18n, profiles,
  tab groups and layout hooks; terminal tabs reference the Relay's tmux-backed
  attachment contract. This is not ORQST's sandboxed sibling WebContents/broker
  contract. Copying it would replace the isolation boundary and add a broad UI
  dependency closure. Retain the existing native documents and narrow validated
  layout channel; the React/tab/process integration is not copied.
- **Adapt the narrow Anywh container resize lifecycle:**
  [TerminalView.tsx at the same pinned SHA, lines 272–281](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/terminal/TerminalView.tsx#L272-L281)
  uses `ResizeObserver`, fits the terminal and debounces upstream resize sends,
  disconnecting the observer during cleanup. ORQST previously fitted on window
  resize only, missing viewport changes caused by expanding chrome or renamed
  headings without a window resize. Adapt that lifecycle to observe the existing
  container, debounce FitAddon fitting by 150ms and disconnect/clear on pagehide.
  Keep the existing bounded, permission-checked native/Core/PTY resize poll;
  no upstream socket, tmux, WebGL or React code is introduced. The selected block
  depends only on the standard browser observer/timer APIs and existing FitAddon.
  Apache-2.0 root LICENSE, no upstream NOTICE or separate source header; attribution
  and modification notes appear in the source and root NOTICE.
- **Defer Tucano communication, keep existing ORQST routing:** pinned
  [Tucano `0501956d127699300209902e889f3e69a0948766`, router.ts](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts)
  `route`, `parseRoute`, `describeAgent`, `routerPrompt` were rechecked. It imports
  shared language/types and provider `Engine`/`Usage`, selects at most two speakers
  through a real model turn and does not grant tool authority. It is unrelated to
  native pane order/focus and cannot supply process or message evidence from a
  display label. No Tucano code or routing behavior is copied here.
- **Overclock: UX reference only, no source reuse.** The official
  [Panes page](https://overclock.sh/features/panes), inspected 2026-11-04, describes
  independent CLIs, a dynamic two-column grid, drag reorder/detach, per-pane state
  and search. This is a published product claim, not local acceptance or source
  evidence. No exact source repository, commit or reuse license was established;
  consequently no source/assets, branding, costs or status heuristics are copied.
  The functional choices adopted are persistent independent documents, explicit
  focus, ordering and maximize/restore. The available Overclock MCP exposed no
  read-only layout/diagnostic snapshot tool; no screen or binary inspection was used.

The required Anywh `docs/architecture.md`, `docs/agent-host.md` and
`relay/src/runtimes/README.md` were also re-inspected in the separate object store.
They separate Relay/session/driver/host lifecycle; no alternative session manager
or automatic session recovery is needed for these layout operations.

Both exact upstream root LICENSE files were re-read: Apache-2.0. The Anywh pinned
tree has only root LICENSE among tracked LICENSE/NOTICE/COPYING entries; selected
files contain implementation comments but no separate grant. No new dependency is added. Only the narrow observer lifecycle described above is
adapted; root NOTICE records the source, destination and modifications alongside
the preserved earlier adaptations. Existing audits are preserved. Overclock's missing source grant
is an explicit rejection of copying, independent of the Apache grants above.

See [implemented behavior and limits](../development/terminal-workspace-layout.md).
Automated synthetic checks cannot establish real-provider, native accessibility,
Tauri managed-terminal or installer parity.

## Compact output investigation

An eight-PTY synthetic run exposed blank visible/accessibility text after attachment
in a 640 × 414 pane. Disposable diagnostics confirmed all 123 source bytes were
retained without a gap in Core, and the emulator buffer retained both synthetic
lines with read cursor 123, viewport/base 0 and no pending read. The terminal was
below the outer pane's visible area after clicking Attach. The installed xterm
6.0.0 `src/browser/services/RenderService.ts` `_handleIntersectionChange` pauses
rendering for a non-intersecting screen; `AccessibilityManager` refreshes rows
from rendered viewport changes. This is not session/output loss.

The correction uses the public DOM `scrollIntoView({block:'nearest'})` only after
an explicit successful Attach. It reveals the container without changing the
emulator's buffer or scrollback. No xterm internals, redraw loop or automatic
reconnect is added. The temporary buffer diagnostic hook is not part of the app
or committed acceptance script. Native tests assert the visible output itself.

## Verification of this increment

On macOS arm64 with Node 24.22.2 and pnpm 10.34.9, the build and typecheck passed.
The full Node suite passed **583 tests** with `--test-concurrency=2`, with no skips
or failures. The first default `pnpm test` attempt encountered ENOSPC creating
private temporary fixtures; the bounded-concurrency run preserved every assertion.

The corrected, uninstrumented Electron bundle passed the extended disposable
acceptance with both **two and eight real PTYs**: independent instances/documents,
visible output, keyboard/pointer reorder, plain-text rename, focus replacement,
hide/show, compact paging, a six-cell grid at 1440 × 1000, real PTY resize, private
preferences and independent stop/retirement. Dialogs and native focus were doubled;
these are synthetic integration checks, not real-provider or human accessibility
acceptance. Earlier output assertions exposed the off-screen rendering issue
above; the regression passed after revealing output on explicit attachment.

The existing Vite chunk-size advisory and an eight-document native listener-count
warning were observed; no memory-leak conclusion follows from that warning alone.
No real provider, full dashboard Playwright suite, native manual screen-reader/IME/
clipboard, Tauri managed execution or cross-platform package acceptance was run.
Ingestion is unchanged; validate:local/validate:live were not run for this layout
increment. No user sessions, service, installed application or global toolchain
was modified.
