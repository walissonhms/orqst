# Studio arrangement focus and trailing frames — 2026-11-06

## Diagnosis and scope

The `feature_request` mutation guard checked only whether AppKit's first responder
was a descendant of the feature-workspace webview. Opening legitimately focuses a
PTY sibling; a generation barrier can then hide that PTY until arrange succeeds.
The arrange request was refused even with the owned main window focused. A second
issue returned `busy` for a frame arriving within 16 ms, losing a trailing update.
This explains a source-level refusal path; owner-reported package symptoms were
not independently reproduced by opening the application during this increment.

## Required reference review and decision

Anywh [51bca540a205401c5a89c60dae86e99d7392b9ed](https://github.com/anywh-sh/anywh/blob/51bca540a205401c5a89c60dae86e99d7392b9ed/client/src/components/terminal/TerminalView.tsx)
uses one React/xterm.js DOM container and WebSocket per terminal, with its own
resize debounce. Dependencies include React, xterm and fit/WebGL/link addons.
It does not implement ORQST's independent AppKit child-webview first-responder
fence, signed execution broker or hidden-until-arrange barrier. LICENSE at that
exact revision is Apache-2.0; no root NOTICE. Decision: keep ORQST's current
AppKit ownership checks and narrowly adapt layout admission/debounce. No source,
assets or dependencies copied. The pinned architecture/Agent Host/runtime review
is also recorded in [Studio opening research](studio-open-gesture.md).
Tucano's inspected Electron destructive-operation dialogs and Overclock's UI
reference provide no compatible child-webview focus implementation for this fix;
no additional source is incorporated and no unlicensed assets are reused.

## Implemented contract

Only `arrange`, still from the exact feature-workspace document, may accept the
native first responder inside an owned terminal child of the same main window.
The main window must be visible and focused. The terminal must have an exact
registered label/URL, be loaded and not revoked; its document generation, Core
epoch and native presentation must match after the asynchronous AppKit inspection.
A barrier-hidden owned PTY can qualify, since layout must restore its geometry;
this never authorizes keyboard input. Other metadata, permission and execution
routes retain their exact source-webview focus requirement. Source, feature
membership, renderer generation, viewport, rect/z/chrome and native fences remain.

Within the 16 ms frame window the native task waits asynchronously and rechecks
focus/document/epoch/presentation. Waiting frames coalesce to the most recent
request; superseded requests return `busy`. The trailing request is retained
instead of being refused just because the timer is inside the frame window.
Existing bilateral metadata exclusion may still return `busy` while another
operation is in flight; the renderer's bounded retry remains required. No child
webview is recreated and no process operation is added.

Rust source tests cover exact epoch/document/presentation mismatches, unloaded or
revoked views, layout-only focus allowance, the trailing-frame boundary and the
existing invalidation-during-focus-wait fence. Full Rust: 186 passed, two existing
ignored. Actual AppKit/PTy presentation still requires native owner acceptance.
