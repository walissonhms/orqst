# Native authorization detail viewport — 2026-11-04

Baseline: `12dab3b8ba03e86c6ea97c51fef4fa960ac2f2f4`. The owner confirmed that
native authorization buttons were outside the screen. `terminal.rs::confirm`
placed the full JSON review in NSAlert's non-scrolling informative text. This is a
native presentation defect, independent of provider, model, authentication or Core
startup. The existing open Preview and all runtime state are preserved.

## Sources and reuse decisions

- **Adapt existing ORQST controls** from
  [`offline_recovery_details.rs::show`, `string`, `object`](https://github.com/walissonhms/orqst/blob/12dab3b8ba03e86c6ea97c51fef4fa960ac2f2f4/apps/tauri/src-tauri/src/offline_recovery_details.rs).
  The existing `objc2` 0.6.5 dependency supplies the ABI; no dependency is added.
  Reuse `NSScrollView`/`NSTextView`, plain `setString`, selectable/read-only text,
  wrapping and vertical scroll. The new terminal helper measures native chrome
  and bounds the accessory by the parent's dimensions and screen's visible frame.
  Keep offline recovery unchanged, including its deadlines and callback contract.
  ORQST is Apache-2.0; existing LICENSE/NOTICE and attribution remain intact.
- **Keep ORQST authority** in
  [`terminal.rs::confirm`, `terminal_focus.rs::sample`](https://github.com/walissonhms/orqst/tree/12dab3b8ba03e86c6ea97c51fef4fa960ac2f2f4/apps/tauri/src-tauri/src).
  Preserve owned parent/sheet identity, document, generation, revocation, request
  correlation, native-dialog exclusion and post-await checks. No private pipe,
  renderer command, grant, permission, profile, model argument or expiry changes.
- **Do not use Anywh's provider approval bridge**:
  [`McpPermissionBridge::registerTurn`, `handleRequest`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/bridges/permissionBridge.ts).
  Re-read the pinned architecture, agent-host and runtime READMEs and actual bridge
  source. Node HTTP/crypto and token-addressed provider-tool approval have a
  different authority contract; no native bounded detail implementation is supplied.
- **Keep ORQST communication** rather than Tucano
  [`Gateway.open`, `handle`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/gateway.ts)
  and [`router.ts::route`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts).
  These use Node HTTP/crypto, MCP SDK and model routing, not AppKit presentation or
  signed native consent. Both pinned root LICENSE files are Apache-2.0; existing
  exact-pin audits record no tracked NOTICE, and inspected files have no extra
  source header. No upstream source/dependency is incorporated, so their dependency
  closures need no new inclusion grant. Historical Tucano audit is untouched.
- **Do not copy Overclock**: terminal/layout reference supplies no verified source
  repository/license for this AppKit component. No assets or code are incorporated.

## Presentation and security

The complete original title, message and JSON detail are inserted as plain text,
without truncation or interpretation. The compact title is repeated outside the
scroll area only when at most 80 characters; the complete title remains inside.
No new displayed strings or translations are introduced; existing EN/PT labels
remain authoritative. The accessory starts at 640×360 points and shrinks using
actual AppKit window/accessory frames, with a 32-point viewport margin. Native
chrome is never shrunk. If controls cannot fit, consent fails closed.

Cancel is the first/default button and its Escape equivalent. Authorize has no key
equivalent and only its distinct native response can approve. The callback owns a
boxed context retaining alert and delegate until AppKit's one-shot sheet completion;
receiver cancellation never frees that context. No nested modal loop or global
`stopModal` is added, so a late completion cannot stop a different dialog. If AppKit
never completes, retained context and the existing exclusion remain conservative.
The host reader remains free while consent is pending. Final native focus,
document, generation, revocation, MCP correlation and presentation checks still
precede the private `confirm` response. No approval is saved or reused.

## Verification and remaining gates

Standalone Rust fixtures cover widths/heights 390/720/1440, native chrome reflow,
impossible/invalid geometry and complete long single-line/multiline Unicode/plain
text. These are synthetic geometry/content cases, not AppKit visual acceptance.
The helper can be typechecked with `rustc --emit=metadata` against the existing
coordinated target dependencies without Cargo, generated resources or a package.

The current delivery intentionally excludes Cargo/build/resources, package, launch,
provider/Core/PTY changes, real consent and all AppData operations. Full native
crate checking remains coordinated by Root 676 after source freeze. A new reviewed
package and real visual acceptance on a small screen/window are still required to
confirm visible, operable buttons; source and pure tests cannot establish that.

Actual source checks in the isolated worktree: 4 standalone Rust tests, 5 existing native
lock/ownership cases and 53 focused Node tests passed; lint and TypeScript passed. The AppKit helper passed
`rustc --emit=metadata -D warnings` against existing Tauri/objc2/Tokio target
metadata; the terminal module also passed native syntax parsing. Full `pnpm test`
completed with 1,167 passes and one failure in unchanged
`feature-private-core.test.ts` (synthetic Core startup schema rejects undefined
input). That failure is reported, not repaired by this UI change. Rustfmt was not
available in the coordinated toolchains. Cargo, builds and native UI acceptance
were not run.

Run the pure cases from the repository root with the coordinated rustc:

```sh
rustc --edition=2021 -D warnings --test tests/native/terminal-consent-layout.rs -o /tmp/orqst-consent-tests
/tmp/orqst-consent-tests
```
