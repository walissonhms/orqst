# ORQST interface: implemented experience and delivery boundaries

ORQST's shared React dashboard follows **Minimal Dark + Developer Studio**.
Start with the [design system](design-system.md) for colors, spacing, typography,
accessibility and evidence-backed motion. The approved nine-screen collage and
original brand artwork are design references supplied separately; they are not
bundled here. This public specification records the implemented experience and
its remaining dependencies without distributing private design briefs.

## Navigate real observations

The sidebar exposes five working destinations: **Overview**, **Workspace directory**,
**Agents & integrations**, **Most used models** and **Settings**. Direct links are `/#overview`,
`/#workspaces`, `/#agents`, `/#models` and `/#settings`; browser Back/Forward remains supported.
Collapse the desktop sidebar to retain icon navigation and accessible names.
Narrow windows use the existing workspace menu.

**Cmd/Ctrl+K** opens Search & commands. Search the loaded local snapshot by workspace
name/path, agent, task, observed model or session ID. Arrow keys move through results,
Enter opens a result and Escape closes the dialog. Up to 60 matching results are
shown; the total is disclosed. This palette navigates views and local forms only.
It never sends prompts or commands into an agent. A native modal owns keyboard
focus; active modal workflows retain their keyboard ownership.

The workspace directory offers search, recent/name sorting and grid/list layouts.
Cards show recorded project paths, session counts, attention counts and latest
observed activity. **Open sessions** selects that scope; **Most used models** opens
the same workspace in Analytics. Sidebar workspace selection preserves the current
view. Paths are labels/observed working directories, not filesystem access grants.
Workspace creation retains the existing label-only form and API semantics.

Agents & integrations projects the Bridge's adapter descriptors and capability
booleans, with original evidence descriptions. It is not an executable discovery
scan or authentication check. Codex is implemented; Claude Code and OpenCode remain
planned. Unsupported input requests and session control stay unavailable. No
installation, model catalog, model-switch or execution action is presented.

## Session context, metrics and attention

An open Overview session has a persistent context strip under the sticky top bar:
agent name, CLI adapter, historical model identifier, latest observed turn status
and a compact token disclosure. It shares the inspector's single confirmed metrics
query. Missing confirmation displays a dash; earlier confirmed readings remain
explicitly out of date while refreshing, offline or failed. Expand for input,
output, cache, the metric occurrence time and accounting limitations. Cache remains
part of input; no quota, price, task completion or process liveness is inferred.
The strip is shown while its session inspector is open, including when scrolled;
it is not a global cross-view session manager.

Notifications retain live-source gating, history and preference APIs. The drawer
adds all/unread/category filters, workspace context, semantic severity and direct
navigation from any view to an available source session. Expired session references
cannot be opened. Mark all read still affects the full history, not only filtered
rows. Notifications and workspace creation use native dialogs with Escape,
contained focus and return to their trigger. Permission and save errors remain
explicit. No quiet hours, per-workspace delivery preferences or new event categories
are implemented by this increment.

## Grouped Settings and reading comfort

Settings is reachable from the sidebar, header, command palette and `/#settings`.
Four groups expose only supported behavior:

- **General:** interface language (en-US / pt-BR), using existing i18next storage;
  captured text retains its original language.
- **Appearance & accessibility:** standard/higher dark contrast, compact/comfortable
  spacing and system/reduced motion, applied immediately across views. Higher
  contrast raises muted text and border contrast through the shared tokens.
  Comfortable spacing enlarges controls, table rows, workspace cards and activity
  entries; text size is a separate choice. **Interface text size** offers 100%, 112.5%
  and 125% through relative font units. **Captured text size** adds 0%, 15% or 30%
  to expanded message bodies, session task text, historical tool payloads and the
  manual Artifact source/preview/draft. It also follows interface scaling.
  **Captured text font** keeps existing typography or selects local monospace/system
  sans-serif. Markdown code blocks retain monospace; source references, identifiers
  and metric values keep their own typography. A labeled, localized example previews
  these choices without loading captured content. No fonts are downloaded.
- **Notifications:** the same component/state/API as the drawer, including categories,
  sound test and browser permission action. Changes use the local Bridge store,
  shared by connected dashboards. Controls disable during saving and without a
  current Bridge connection; save failures retain the existing explicit error and
  restore the last snapshot. Browser audio activation/permission and Desktop's
  native notification policy retain their separate lifetimes.
- **Privacy & storage:** factual descriptions of local UI storage, Bridge SQLite
  history, source immutability and best-effort redaction. No deletion, retention,
  credential or arbitrary path controls are presented.

Language and appearance remain usable without the Bridge. OS reduced motion
always disables animations/transitions, including when **Follow system** is chosen;
**Reduce motion** also disables them when the OS allows motion. Exact metric values,
static confirmed-change outlines and semantic status labels remain available.
Reset appearance focuses Cancel in a native modal. Escape/Cancel preserve choices;
confirmation restores standard dark contrast, compact spacing, system motion,
standard text sizes and original reading typography. It neither clears history/drafts nor changes language, workspace or delivery
preferences. Focus returns to the reset trigger.

Light theme, terminal fonts, mascot controls, quiet hours,
per-workspace delivery, startup settings, provider configuration and storage
management remain pending. No new transport, Core capability or dependency is added.

## Local preference contract

The browser origin stores `orqst.shell.v1`: last implemented view, workspace ID,
sidebar collapse, session-status filter, workspace layout and workspace sort.
Values are allowlisted; malformed/unsupported storage uses safe defaults. An absent
workspace returns to all workspaces. An explicit known hash overrides the stored
view. Storage denial does not stop observation. Session links and notification
navigation select the source workspace and clear filters that could hide it.

`orqst.appearance.v1` stores only allowlisted `contrast`, `density`, `motion`,
`textSize`, `contentSize` and `contentFont`. Existing three-field preferences retain
their choices and use standard sizes/original fonts for the new fields.
Malformed values fall back independently to defaults. Same-origin tabs synchronize
appearance through storage events. Storage denial keeps choices in memory for the
visit and shows an explicit notice; it does not block observation. Browser zoom
remains available. Reading presentation never alters captured text, draft bytes,
clipboard content, exports or saved Markdown. Appearance reset
changes only this key; clearing site data removes local UI preferences.

Search terms, session selection, captured content and artifact drafts are not stored.
There is no process restoration, tab/split persistence, account, upload or database
migration. Clear site data to remove these UI preferences. Existing i18next language
storage and Bridge notification preferences keep their separate lifetimes.

## Screen and capability matrix

The status describes this checkout, not full product acceptance.

| Screen / capability            | Status      | Implemented files and verification                                                                                                                                 | Remaining dependency or limitation                                                                                                                                                    |
| ------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation shell and search    | Implemented | `App.tsx`, `Modal.tsx`, `CommandPalette.tsx`, `shell-preferences.ts`, `shell.css`; `tests/shell-preferences.test.ts`, `tests/browser/shell-navigation.spec.ts`     | No workspace tabs, resizable splits or process/session restoration                                                                                                                    |
| Overview / Observability       | Partial     | `App.tsx`, `LiveMetrics.tsx`, `SessionTokenBadge.tsx`, existing timeline/attention; dashboard, Live Metrics and shell browser tests                                | Rearrangeable widgets, broader performance metrics, verified costs and independent Observability screen remain planned; summary totals retain legacy limitations                      |
| Workspaces                     | Partial     | `Workspaces.tsx`; shell browser cases cover scopes, search, sort, layout and reload                                                                                | No rename/archive, filesystem picker, pinning, multiple open project tabs or terminal layout                                                                                          |
| Agents                         | Partial     | `Agents.tsx` projects actual adapter descriptors; shell cases cover matrix, unavailable state and locales                                                          | CLI path/version/auth/model discovery and managed profiles unavailable                                                                                                                |
| Models & Analytics             | Partial     | Existing `ModelAnalytics.tsx`, `ModelComparison.tsx`, `ModelEvolution.tsx` and export components; dedicated existing browser suites                                | Observational comparisons only; real-provider comparative acceptance, task efficiency and verified cost remain pending                                                                |
| Artifacts                      | Partial     | Existing `ArtifactPanel.tsx`, `artifact-preview.ts` and native save; artifact/draft/browser and native policy tests                                                | Manual extraction; inert limited Markdown, no standalone searchable artifact library or automatic extraction; draft persistence/navigation guards remain incomplete                   |
| Notifications                  | Partial     | `App.tsx`, `Modal.tsx`, `shell.css`; shell source-navigation/filter cases and existing dashboard/Desktop suites                                                    | Native signed visual acceptance, quiet hours and broader preference scope pending                                                                                                     |
| Settings                       | Partial     | `Settings.tsx`, `NotificationPreferences.tsx`, `appearance-preferences.ts`, shared shell; `tests/browser/settings.spec.ts`, `tests/appearance-preferences.test.ts` | Grouped settings, contrast/spacing/motion, reading sizes/fonts and scoped reset implemented; light theme, terminal fonts, quiet hours, provider and storage management remain planned |
| Studio / interactive terminals | Blocked     | Existing `ObservedTools.tsx` is historical evidence only; observed-tools browser tests                                                                             | Managed ownership, operation authorization and validated PTY/provider runtime; no fake terminal or Start/Stop/Resume controls                                                         |
| Orchestration / collaboration  | Blocked     | Explicit source-backed parent relationships remain visible in session details                                                                                      | No task/delegation execution contract; no agent-to-agent messages or inferred workflow                                                                                                |
| Kanban                         | Planned     | No production board or placeholder cards                                                                                                                           | Requires explicit task entities, provenance and authorized transitions                                                                                                                |
| Onboarding                     | Planned     | Existing empty/loading/offline states retained                                                                                                                     | Safe CLI discovery and a bounded first-run workflow                                                                                                                                   |

A separate [synthetic PTY acceptance experiment](../development/terminal-pty-acceptance.md)
validates fixed disposable Node processes only. It does not provide a runtime
terminal, provider ownership or authorization for UI controls.

Component paths above are relative to `apps/dashboard/src/`. Browser tests use
explicitly synthetic data and disposable storage. Existing ingestion, API shapes,
WebSocket handshake and security controls are unchanged.

## Visual acceptance checklist

`tests/browser/shell-navigation.spec.ts` captures synthetic Workspace/Agents views
at 1440px, 1280px and 390px with reduced motion, and checks viewport containment.
Screenshots are generated test artifacts, not repository assets or real sessions.
`tests/browser/settings.spec.ts` adds grouped Settings, offline/storage-denied and
malformed storage, cross-tab sync, language, shared notification rollback, scoped
reset/focus, actual metric-cue motion suppression and comfortable/higher-contrast
screenshots at the same widths (including pt-BR mobile).
`tests/browser/reading-preferences.spec.ts` checks old preference migration, actual
font scaling, offline/storage denial, cross-tab sync, reset focus, exact clipboard
text, inert preview and viewport containment at 1440/1280/390/320px with maximum
reading sizes and comfortable spacing. Generated screenshots include pt-BR reset.
The existing suites also cover Overview, Analytics, session details, Artifacts and
notifications. Inspect the generated images for these criteria:

- Official dark tokens, readable text, restrained borders and semantic status text.
- Workspace grid/list and adapter matrix retain context at laptop widths.
- Mobile tables scroll inside their container, with readable cards and usable search.
- Collapsed navigation remains named and operable; focus is visible.
- Palette and forms contain focus, dismiss safely and return to their trigger.
- Selected-session tokens stay exact, confirmed/stale/unavailable and visible on scroll.

Exact collage parity, manual screen-reader acceptance, other browsers and native
Desktop visual acceptance are pending. The reference artwork was not available as
a repository asset, so no new mascot derivative or collage-fidelity claim is made.
See [testing](../development/testing.md) for commands and actual validation scope.
