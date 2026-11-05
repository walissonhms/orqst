# Feature terminal preparation — integration fragments

These additive fragments are for the coordinating root to merge into the live
documentation after source review. The concurrent main documentation files and
historical research were not edited by this worker.

## README / CHANGELOG / roadmap fragment

Source connects the native Feature chrome **+ Terminal** entry to the existing
Studio CLI → model → Open drawer. The request is navigation-only and carries
stable workspace/Feature IDs plus accepted metadata generation/view revision.
It reuses the owned main window, picker and native review; it does not expose the
Studio facade to the Feature document or create/start a terminal automatically.
The open package remains unchanged. Rust compilation and native UI acceptance
remain pending; synthetic headless Chromium is renderer evidence only.

## API / security-model / SECURITY fragment

`feature_prepare` is a distinct native command, enabled only for the exact owned
`feature-workspace` Webview. It accepts exactly `contractVersion: 1`, safe
nonnegative `generation`, bounded `workspaceId`, UUID-or-null `featureId`, and safe
nonnegative `expectedRevision`. It returns only `status` (`ok`, `denied`, `stale`,
`busy`, `unavailable`). `ok` means view-event dispatch only.

The existing `feature_request`/Core metadata allowlist and `studio_request`
capability remain unchanged. Native derives source, document, epoch and target;
renderer-supplied paths, executables, PID, proofs, source/document or window names
are rejected. Native compares the accepted scope/generation/revision, native
presentation epoch, preparation/enrollment availability and fresh actual AppKit
focus before navigation; it revalidates the owned main document and exclusions
before delivering the event. The existing native blur observer revokes input
when switching windows. Reload invalidates the cached navigation scope. Studio
retains catalog/scope validation, native confirmations and signed execution grants.
No local HTTP/WebSocket API, cookie, static serving, database schema or Core
admission contract changes. Existing no-adoption/no-retry behavior is preserved.

## V6 checklist fragment

- [x] Connect Feature chrome + Terminal to the shared Studio drawer with stable IDs.
- [x] Keep navigation separate from metadata mutation and execution authority.
- [x] Preserve native source/document, generation/revision, epoch/focus and
      preparation/MCP/retirement exclusions in source.
- [x] Exercise strict request/reply and facade injection with synthetic contracts;
      exercise EN/PT drawer handoff headlessly without a CLI creation action.
- [ ] Run native Rust command tests/compilation when the root authorizes Cargo.
- [ ] Independently review native permission registration and final navigation fences.
- [ ] Package only after root coordination; never overwrite the currently open tree.
- [ ] Human/native WebKit acceptance of Feature → main Studio → CLI/model picker;
      explicit Open/enrollment remains an independently authorized action.
- [ ] Diagnose operation-correlated sidebar refusal separately; this change does
      not clear refusals merely because a later snapshot arrived.

## Checks for this isolated increment

Node 24.22.2 and the existing pnpm 10.34.9 dependency graph are reused; no install,
new dependency or lockfile update is needed. External dependency links point to
the existing checkout; all workspace package links resolve the isolated source.

Run focused Node checks with:

```sh
node --import tsx --test tests/feature-preparation-navigation.test.ts tests/feature-preparation-ui.test.ts tests/feature-view.test.ts tests/tauri-studio.test.ts tests/tauri-studio-preparation-ui.test.ts
```

The focused set has 25 synthetic cases (including one headless EN/PT case).
Full lint and typecheck are appropriate source checks. Full `pnpm test`,
`pnpm build`, Cargo, resource staging and installed-data validation are outside
this increment's authorization. No real provider, Core/PTY task, native grant,
private session/configuration read or open-package mutation is required.

See [cause, reference inspection and limits](../research/feature-terminal-preparation-navigation.md).
