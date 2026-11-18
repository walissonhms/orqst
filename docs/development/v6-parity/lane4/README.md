# V6 Studio creation and mentions

## Integration

- **Feature shell.** Put the existing `onPrepare` action on the single breadcrumb
  `+ Terminal` button. Keep the signed native document's
  `showPreparationDrawer` path and remove the duplicate new-terminal controls
  when integrating the breadcrumb. The main renderer's `StudioCreationScope`
  accepts the existing workspace and Feature IDs plus optional `workspaceName`
  and `featureName` from the same snapshot. A null Feature ID retains the
  native default General binding.
- **Delegation.** Place `FeatureDelegate` from `MentionComposer.tsx` in the
  breadcrumb action row. Bind its `FeatureDelegateProps` to the active
  `{ workspaceId, featureId }`, that Feature's live member projection, and the
  existing native mention request. Set `disabled` for archived/unavailable
  scope. Compare the callback scope to the latest snapshot and reconcile the
  native reply against every requested recipient ID before returning `queued`.
  The action uses the existing `data-native-overlay` projection. Remove the
  duplicate footer entry after connecting the breadcrumb.
- **Alias.** The native batch accepts a display name, provider, and model
  selection. The alias field describes the host-assigned handle. An editable
  alias and duplicate-alias validation need authorized Feature metadata and
  conflict checking in the same native admission transaction.
- **Locale.** New strings live under `studio.create.*` and `mention.*` in the
  existing EN-US and PT-BR catalogs.

Compact creation pairs the catalog and snapshot from one native reply. Models
show only reviewed choices. Account entitlement and effective runtime models
remain unverified at this stage. Successful enrollment leaves the existing
workspace mounted. Partial or uncertain effects retain individual outcomes
and avoid a renderer-driven presentation restore.

## Reference comparison

The [baseline audit](https://github.com/walissonhms/orqst/blob/9c4719b96d71a5469c910c140f47e8fd8c4f40c2/docs/development/v6-parity-audit.md)
contains captures at 1440×900 and 1280×800. Compare these paths under each size.

| Baseline                                  | Lane 4 capture                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `approved/18–19,29`, `tauri-studio/17–18` | `creation-open.png`, `creation-filled.png`, `creation-empty.png`                         |
| `approved/20–21,30`, `tauri-studio/23`    | `creation-retained-panes.png`, `creation-refused.png`, `creation-first-pane.png`         |
| `tauri-studio/19`                         | `creation-advanced.png`, `creation-batch.png`                                            |
| `approved/16–17`, `tauri-chrome/07–10`    | `delegate-open.png`, `delegate-targets.png`, `delegate-draft.png`, `delegate-queued.png` |

The compact creation overlay follows the reference's centered 390 px dialog,
four fields and dark purple surface. Opening uses the signed native review and
model catalog. Layout and pane chrome in the captures
are those of the base branch. The delegation fixture puts the component in
the existing breadcrumb navigation slot to exercise the integration contract.
It does not simulate CLI text or task execution. These screenshots use
Chromium and synthetic native facades. Native WebKit, provider and PTY
acceptance remain pending.

[1440×900](1440x900/) · [1280×800](1280x800/)

## Source decisions

- Keep ORQST's native catalog and batch admission. Anywh's
  [launcher submit and model inputs](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/sala/NewAgentLauncher.tsx)
  depend on React, relay profiles and room/parent routing. They do not carry
  ORQST's native generation, focus proof or signed admission. The
  [existing component review](../../../research/terminal-cli-model-picker.md)
  records the pinned Apache-2.0 license and absence of a tracked NOTICE.
- Keep the structured ORQST mention request and its inbox receipts. Tucano's
  [`mentioned` resolver](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/context.ts#L303)
  resolves application agents from context, while ORQST resolves UUIDs in an
  exact Feature and sends through its native guard. The
  [existing communication review](../../../research/mention-communication.md)
  records the pinned Apache-2.0 license, absent upstream NOTICE and earlier
  attributed parser adaptation in Core. Lane 4 imports no upstream code.
- Overclock's [published shell](https://overclock.sh/en) is a density reference.
  The owner-approved ORQST HTML governs geometry and visuals. No Overclock
  implementation or assets were incorporated.

## Validation

- `pnpm install --frozen-lockfile`, `pnpm lint` and `pnpm typecheck` passed.
- `pnpm test` exited 1 with 1,310 passing, 29 failing and 3 cancelled tests.
  Failures included analytics HTTP timeouts and a Chromium click timeout in
  the Feature enrollment regression. The offline reservation test and the
  Tauri files test processes were stopped after approximately 30 minutes.
- A serial focused rerun passed all 11 tests in `always-in-feature.test.ts`,
  `feature-preparation-ui.test.ts`, `native-terminal-creator.test.ts` and
  `mention-composer.test.ts`. It includes Codex enrollment in General and
  an existing Feature using the attached catalog generation.

- `playwright test tests/browser/studio.spec.ts --workers=1` passed all 10
  tests and produced the 24 PNGs in this gallery. The adjacent
  `studio-workspace.spec.ts` passed narrow navigation and timed out in its
  older drawer test while looking for `＋ Terminal` in the immersive layout.
- The dashboard-only build completed with Vite's chunk-size advisory.
