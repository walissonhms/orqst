# Tauri terminal retirement and safe reselection

The retained managed-terminal workspace has a native **Retire exited terminal
selection** menu action. It reuses the existing Core retirement transaction.
Electron remains available; this increment does not establish migration parity.
See the [pinned source/reuse review](../research/tauri-terminal-retirement.md).

1. Stop each owned CLI through its separate signed action and wait for its actual
   owned exit. Hiding a pane, a Stop request or a lost transport is insufficient.
2. Focus a visible terminal document and choose the native retirement menu action.
   All panes are temporarily blocked and input grants revoked while Core examines
   the selection. An in-flight terminal operation or MCP consent prevents the review from starting.
3. Review the complete Core evidence in the Cancel-default native dialog. Only
   explicit approval in the same current document permits signing. Cancellation,
   blur, document closure and invalid or oversized evidence cannot release capacity.
4. Core rechecks exits, journal ownership and exact reservation identity, consumes
   its one-use proof, fences every old dispatch and archives the selection before
   releasing capacity. The native client reports success only after the correlated
   retirement reply and confirmed Core process exit. Journals and outcomes remain.
5. Quit Tauri, reopen it and prepare/select fresh profiles. If using
   `ORQST_TAURI_TERMINALS`, replace that explicit startup selection with the fresh
   manifests before relaunch. Reopening an old journal is not session recovery.

The existing native preparation latch now also covers selections supplied through
the startup environment. It stays locked after retirement, failed startup, host
loss and uncertain cleanup. In-window reselection requires separate future proof
that every old webview, handler and callback was removed; this change never resets
that latch. Another already-open structured-agent selection can still independently
reserve the shared capacity under the existing rules.

A running or ownership-lost attempt, late exit after loss, fenced journal or
changed reservation refuses retirement. OpenCode retains the existing Core refusal
because TUI exit does not establish descendant-server exit. Evidence exceeding the
4096-character native review bound is refused in full, never truncated. Nothing
deletes, repairs, overwrites or reclaims an uncertain reservation. No PID sweep,
process adoption, automatic restart or task replay is added.

A refusal before proof dispatch can be reviewed again with a fresh challenge.
Once a proof might have been consumed, archive I/O failure, lost replies and an
unconfirmed Core exit keep the old native client fenced. Quit and inspect preserved
evidence; do not assume that a denied/unknown reply proves the reservation is still
present or that the archive did not complete. Native waiting is bounded at 60 seconds.

For integration with interactive MCP, current checks and remaining gates, see the
[combined integration record](tauri-retirement-mcp-integration.md).

## Original increment verification and remaining limits

The Node tests use disposable SQLite journals and synthetic owned handles. They
exercise the production service and real Core retirement/admission implementation,
including unchanged journal facts, safe archive release, cancellation, revocation,
running/lost/fenced ownership, changed marker, malformed/digest/target/size rejection,
concurrent requests, uncertain RPC, delayed/unconfirmed Core close and proof fencing.

The packaged synthetic acceptance also retires the selection after real synthetic
PTY exits, checks the archive and retains the journals. Its native IPC, focus,
dialogs and WebKit are simulated; it does not validate a native human workflow.

```sh
pnpm lint
pnpm typecheck
pnpm exec tsx --test --test-concurrency=4 tests/*.test.ts
pnpm build
pnpm build:tauri-resources
pnpm accept:tauri-terminals --authorize-synthetic
pnpm accept:tauri-terminals --authorize-synthetic --panes=8
```

For this increment, lint and typecheck passed; the complete Node suite passed
654 tests with concurrency four. The final focused retirement run passed 17 tests.
`pnpm build` (including Electron), Tauri resource staging and the two- and
eight-pane packaged synthetic acceptances passed. The existing Vite chunk-size
advisory remains. Native Rust source syntax/formatting was checked with rustfmt;
this is not a Rust typecheck or native acceptance.

The first eight-pane retirement run was denied after broker teardown filled the
Core's bounded pending RPC queue before the retirement request could enter it.
The reservation stayed protected. The client now fences new work immediately,
then defers broker teardown until the signed RPC and Core exit wait have settled.
A regression checks this ordering; the subsequent eight-pane acceptance passed.
No RPC capacity or timeout was increased to make the check pass.

Full Rust compile/test, native menu/dialog/focus acceptance, real Codex/Claude
retirement, cross-platform packaging and live reselection remain pending. Rust
builds were deliberately avoided because the machine had about 2.7 GiB free.
No ingestion behavior changed; local source ingestion validation is outside scope.

## Security review

Retirement is a strict private native-to-Node pipe message, absent from renderer
execution requests, Tauri command permissions, observer HTTP and WebSocket APIs.
Native code selects the reviewing slot from its owned WKWebView first responder
and validates the exact document, visibility and native focus. Every pane is serialized against the transaction.
Proofs stay in the Node parent; only bounded evidence and translated dialog labels
reach native UI. Core remains the authority for expiration, exits, owner fencing
and archival. After a possibly dispatched proof the client never retries it.
The pending native reply must match its request ID and explicitly acknowledge
retirement plus fencing; transport silence is never success. Existing file/path,
permission, consent and shared-capacity boundaries are unchanged.
