# Persisted Feature UI increment

The official source HTML remains unchanged. `FeatureWorkspace` implements its
compact Workspace/Feature hierarchy, breadcrumb, dense terminal frame and member
counts with real selected-Core metadata. The shared 31px chrome/xterm remains the
terminal implementation. The frame uses the approved dark/purple palette,
155px/46px sidebar and 45px header; a 34px footer includes its separator.

Only the selected/reviewed native Workspace is available. Feature name,
description/status, membership availability and save/stale/refusal states are real.
The editor stays in the sidebar (existing topbar at compact width) so native
terminal webviews do not occlude it. A save cannot close a newer editor instance.
No simulated project/provider/model/token/task data is imported. Unsupported
terminal creation/delegation shortcuts are disabled with explicit reasons, while
existing native preparation and signed terminal controls remain available.

The [workflow/limits and central integration fragments](../../development/v6-feature-ui.md)
and [pinned source decisions](../../research/v6-feature-ui.md) define this increment.
The final Chromium screenshot comparison remains pending after the failed EN
acceptance and owner pause; it will not establish native WebKit acceptance.
Floating, safe lifecycle archive/removal, full minimized dock,
verified models and cross-Feature communication remain separate increments.

## Incremental native source — 2026-11-04

The existing + Terminal drawer/CLI/model choice now reaches append-only native
enrollment in the same Core. Old terminal Webviews/xterm remain mounted; their
navigation grows in place. Feature CAS and UUID layout-key extension preserve
prior visual metadata; an uncertain addition remains explicitly unavailable. No
redesign or simulated terminal content is introduced. Pure/EN/PT facade checks
passed; actual native/provider acceptance is pending. See
[workflow and limitations](../../development/terminal-native-enrollment.md).
