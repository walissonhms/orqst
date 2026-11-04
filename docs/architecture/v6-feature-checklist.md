# V6 feature delivery checklist — 2026-11-04

Authority: the [approved V6 package](../design/v6/README.md). This extends the
[migration tracker](master-spec-tracker.md), preserving earlier evidence.
Unchecked acceptance items remain incomplete even when a subset is implemented.
Update this file in every V6 delivery with implementation and verification.

## Capability inventory before V6 implementation

| Capability                              | Current status and implementation                                                             | Remaining work                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Tauri 2 / React / Node 24 Core / SQLite | Implemented preview; `apps/tauri`, `packages/core`, `packages/database`                       | Complete native/provider parity before removing Electron                                             |
| Interactive terminal panes              | Partial; retained 1–8 PTY documents, `tauri-terminal-layout.ts`, `terminal-document.ts`       | Feature ownership, live membership, arbitrary supported mixed selections, verified models            |
| Stable terminal identity                | Partial; manifest UUID and optional structured `terminalId`                                   | Feature membership and stable workspace display IDs across creation/restart                          |
| Durable layout                          | Partial; `terminal-layouts.ts`, private Core RPC, preserved JSON import                       | Per-Feature docked/floating layout and active context                                                |
| Features                                | Missing on integrated main                                                                    | Additive persisted entity, CRUD, configuration duplication, active-process archive/removal policy    |
| Handles, roles and permissions          | Partial; existing two-member communication metadata and native review                         | Feature scope, SQLite configuration, repeated aliases across Features, cross-scope grants            |
| Structured communication / PTY MCP      | Partial; durable queue, explicit grants and synthetic returns                                 | N-member composition, Feature binding, real CLI return and recovery acceptance                       |
| V6 visual Studio                        | Approved reference preserved/inspected; runtime still has earlier preparation/terminal chrome | Compact hierarchy/sidebar/breadcrumb, dense docked/floating surface, menus, individual configuration |
| Context switching                       | Hide preserves retained documents/processes within a selection                                | Workspace/Feature switching with independent layout and no process recreation                        |
| Metrics and communication motion        | Existing observed metrics; no V6 Feature filter                                               | Scope by Feature; animate actual Core events; unknown usage stays unavailable                        |
| Native acceptance                       | Blocked; diagnostics improved                                                                 | Explain `cgWindowNotFound`, verify focus after consent, actual WebKit/input/dialog/lifecycle flow    |
| Real provider communication             | Blocked by preserved quarantine and outstanding native reviews                                | Explicit capacity decision and verified Codex↔OpenCode task/result                                   |

## Integrated foundation and chrome — 2026-11-04

Sources `3a3d250` / `dd2cbfd` (Core) and `ba848ba` (chrome) are integrated as
`452d4b0` / `e352d26` / `c2f7bfc`. The inventory above records the pre-V6 baseline;
the following list records this increment, separately from end-to-end acceptance.

- [x] Persist Feature UUID/name/description/status/revision, exclusive terminal
      assignments and bounded validated metadata audit using the existing Store.
- [x] Persist team proposals and layouts under Feature scope; preserve unassigned
      legacy data and never restore grants or processes from configuration.
- [x] Enforce Feature-local aliases and guards at grant/admission/dispatch/result
      boundaries. Qualified and cross-Feature traffic is currently denied.
- [x] Exercise six reviewed terminal configurations through real private Core IPC
      with no agent launch or execution reservation.
- [x] Deliver compact 31px chrome, pane menu, retained xterm, lifecycle, localized
      controls, visible refusals and minimize/maximize/restore.

See [Core contracts and limits](../development/v6-feature-core.md) and
[chrome behavior and limits](../development/v6-terminal-chrome.md).
The native facade, Feature UI, runtime enrollment/switching, authorized cross-Feature
traffic and Floating layout remain incomplete. The native structured composition
still has two Codex members; metadata for eight members does not prove N-member
execution. The actual UI/sidebar remains a next integration step.

The integrated run passed 710 Node tests, lint, typecheck, build, Tauri resource
staging, EN/PT Chromium renderer acceptance and eight synthetic packaged PTYs.
The latter includes layout, resize, signed operations, revocation and retirement
with simulated native focus/dialogs. It establishes no real provider/native UI
acceptance. Electron pair/team runners were adapted to menu navigation but were
not run during concurrent native focus investigation.

## Required end-to-end acceptance

- [ ] Create a Workspace and Feature through the actual UI without external JSON.
- [ ] Persist Feature ID, name, description, status and validated optional worktree.
- [ ] Create, rename and duplicate configuration without duplicating sessions/history.
- [ ] Support Autenticação (3 terminals), Dashboard (2) and Banco de dados (1) as
      test data only, with independent saved layouts.
- [ ] Switch Workspace/Feature repeatedly; prove unchanged owned process identities
      and no duplicate CLI starts while work and messages continue in Core.
- [ ] Resolve `@backend` independently in two Features; deny accidental cross-scope
      access and audit explicitly authorized exact destinations.
- [ ] Create mixed supported CLIs with per-terminal verified model selection;
      reject unavailable models without substitution.
- [ ] Match the docked/floating UI; drag, resize, minimize, maximize, restore and
      distinguish visual close from process termination.
- [ ] Archive/remove with active work using explicit choices; preserve other
      Features and all native CLI history.
- [ ] Delegate through the existing queue/MCP; prove provider acceptance, task
      execution and correlated return separately with real CLIs.
- [ ] Validate crash/reconnect/unknown outcome without replaying uncertain effects.
- [ ] Confirm keyboard operation, reduced motion, both locales and laptop geometry.
- [ ] Update README, ROADMAP, CHANGELOG, API/data/security/design docs, tests and
      this checklist for each increment.
- [ ] Complete platform/native acceptance before retiring Electron.

## Evidence for this intake

All five Markdown files and the HTML were read. Hashes were recorded and the
prototype rendered at 1440×900 for visual inspection; its four panes are simulated.
No V6 runtime or real-provider acceptance is claimed by this intake. Existing
Node/Core/PTY/SQLite and pinned Anywh/Tucano code were inspected; decisions are in
the [reuse review](../research/v6-feature-foundation.md).

## Native consent increment — 2026-11-04

- [x] Demonstrate own-sheet generation revocation with an explicit native affirmative
      result; preserve the exact WKWebView/source/selection proof in the correction.
- [x] Test cancellation, real revocation with return, expiration and input suspension
      without renewal against the existing signed broker.
- [x] Observe native synthetic start, attach, input/PONG, real PTY resize, hide/restore,
      retained output and signed stop in the isolated coexistence fixture.
- [x] Observe both native Quit cancellations, first-gate re-presentation and denial
      of a late affirmative after another owned key window, in the isolated final fixture.
- [ ] Observe real NSApp deactivation and final both-affirmative shutdown on that
      final artifact; its runner deadline expired before the human deactivation step.
- [ ] Revalidate the integrated V6 artifact and real providers; native fixture evidence
      on the prior baseline does not accept Workspace/Feature workflows.

See [the exact native evidence boundaries](../development/tauri-native-coexistence.md).
