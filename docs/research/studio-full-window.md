# Full-window Studio reference decision — 2026-11-04

Keep the existing React 19 FeatureWorkspace and native retained documents. This
increment corrects dashboard composition; it introduces no session manager,
terminal emulator, CLI adapter, process recovery or communication transport.

Re-inspected pinned Anywh
[`App.tsx`, `App`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/App.tsx#L718)
and [`TabGroupLayout.tsx`, `TabGroupLayout`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/shell/TabGroupLayout.tsx#L313).
Its root uses `h-screen w-screen`, one sidebar and `min-h-0 flex-1`; the retained
panel layer fills its parent rather than a second dashboard page. App-specific
profile/tab/Relay hooks and dnd-kit are not ORQST's authenticated sibling Webview
contract. Decision: retain ORQST's workspace and apply its existing flex/grid
layout to a single viewport shell. No upstream code or dependencies are copied.

The exact tree's root LICENSE was re-read: Apache-2.0; the tracked tree has no
NOTICE. Existing Anywh attributions remain unchanged. The approved owner HTML
`docs/design/v6/source/ORQST_workspace_v6_features.html` likewise has one `.app`,
`.sidebar` and main plane. It is a visual reference; simulated CLI data is not
used. Overclock remains a visual-density reference only, without a source reuse
grant. Communication is unchanged, so the preserved Tucano audit is unaffected.

ORQST evidence: `App`/`Studio` previously nested `FeatureWorkspace` inside the
dashboard shell; `.feature-workspace` imposed a viewport-derived height inside
`main` with page padding. `StudioWorkspace` now keeps that component mounted,
opens preparation in a modal drawer and exposes explicit Overview navigation.
The native terminal chrome, insets, authority, focus fences and Core processes
are preserved. Renderer tests cover exact viewport geometry and navigation in
both locales; these do not prove native terminal execution or provider behavior.
