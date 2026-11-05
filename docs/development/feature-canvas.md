# Feature canvas development and acceptance

`FeatureCanvas`, `CanvasAgentCard`, `CanvasSessionList` and `CanvasStatusBar` render
summary DOM. `canvasMembers` projects current Feature membership from the existing
Core snapshot and saved native pane names. It never associates observed sessions
by title, slot number, provider, timing or working directory. The current facade
supplies an owned Claude session only when its exact fresh launch UUID, transcript
and lifecycle receipt agree; Codex/OpenCode session activity and agent status remain
unavailable. No delegation edges are inferred. The separate native
snapshot carries the selected model, and a display-only `canvas` reply carries owned
PTY lifecycle timestamps when the bound receipt can be verified. Running/exited
describes the PTY, not a model turn. Unknown, transport loss, or missing receipt
remain unknown; consumers must expire stale liveness.

The evidence-aware renderer accepts existing `SessionView`/validated source events.
It shows at most three activities, source-relative timestamps and the observed
session interval; it does not claim live execution duration or provider acceptance.
`canvasEdges` requires an admitted Core journal message, matching audit and managed
terminal bindings in the same Workspace/Feature. No prose parsing occurs.
Groups come from saved Feature metadata; no role is guessed from a prompt.

## View transitions

- Feature selection presents its canvas. Card click/Enter uses the existing strict
  UUID-bound `pane/focus` request. A suspended dashboard can resume this view only
  through that authenticated current-scope request.
- `canvas` is a closed metadata/view action with generation, document, current native
  focus, review exclusion and Quit fences. It publishes no native focus/input grant.
- Private layout state includes ephemeral `canvas`; it requires empty native visible
  bounds and null focus while preserving `order`, `shown`, names and saved layout.
  Rust validates the complete envelope before visibility/geometry changes.
- Real terminal documents remain retained. Canvas zoom/pan transforms no PTY.
  Grid/restore changes the presentation; hidden siblings stay hidden unless explicitly
  restored. The terminal Canvas button and physical Escape return to the canvas.
  Escape is reserved by this view while the managed terminal is focused.
- Preparation from chrome hides sibling terminal/chrome views before focusing the
  retained main dashboard dialog. Input and old presentation generations are revoked.
  Opening the drawer does not launch a CLI or grant execution.

Chrome is stacked above the opaque retained main view, followed by visible native
terminals. Initial chrome installation stays hidden until a valid layout. Bounds use
the current parent-window viewport, including after resizing. No titlebar offset
is guessed. These changes require native AppKit/WebKit validation in the new package.

## Reproducible checks and captures

Use Node 24/pnpm 10 and the coordinated Cargo target. Run lint, typecheck, Node tests,
build, Rust tests, rustfmt and Clippy with warnings denied for this increment.

```bash
pnpm exec tsx scripts/accept-feature-canvas-ui.ts --authorize-synthetic-canvas-ui
```

This opt-in script starts Chromium only; no native app, terminal Core, PTY, CLI or
provider is started. It checks seven synthetic evidence cards/three saved groups,
six explicitly admitted synthetic journal edges, Reply, zoom/fit/keyboard pan/search and card navigation.
It separately mounts the actual `FeatureWorkspace` with metadata-only slots and
verifies unavailable fields, zero edges and UUID-bound card navigation.

Captures are under `dist/accept-feature-canvas-ui/` in EN/PT at 1440×900 and 390×900.
`*-synthetic-evidence.png` is a clearly labelled component preview with synthetic
sessions/events. `*-metadata-unavailable.png` is the real FeatureWorkspace renderer
with synthetic facade metadata and the exact unavailable state production uses.
Neither set proves native stacking, real provider telemetry or owner acceptance.

The isolated package is `dist/native-preview-canvas-<sha>/ORQST Preview.app` in the
main checkout; generated package-verification records contain the exact checks and
hashes. Existing packages are preserved. No main merge or delivery tag is implied.

## Remaining gates

Native acceptance must verify visible canvas and tabs, card → real terminal → Canvas,
minimize/dock/grid/resize, preparation drawer, focus/keyboard revocation and normal Quit.
Effective model/activity/parentage integration requires a canonical Core/CLI binding,
not output scraping. N-member MCP, mentions, actual delegation/result delivery,
group/role editing, persistent canvas camera and floating native geometry remain open.
The pre-existing `studio-workspace.spec.ts` extra snapshot-count failure was reproduced
on the unchanged parent and is not treated as a passing browser check here.
