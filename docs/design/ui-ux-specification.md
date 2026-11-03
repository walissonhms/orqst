# ORQST interface: implemented experience and delivery boundaries

ORQST's shared React dashboard follows **Minimal Dark + Developer Studio**.
Start with the [design system](design-system.md) for colors, spacing, typography,
accessibility and evidence-backed motion. The approved nine-screen collage and
original brand artwork are design references supplied separately; they are not
bundled here. This public specification records the implemented experience and
its remaining dependencies without distributing private design briefs.

## Navigate real observations

The sidebar exposes four working destinations: **Overview**, **Workspace directory**,
**Agents & integrations** and **Most used models**. Direct links are `/#overview`,
`/#workspaces`, `/#agents` and `/#models`; browser Back/Forward remains supported.
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

## Local preference contract

The browser origin stores `orqst.shell.v1`: last implemented view, workspace ID,
sidebar collapse, session-status filter, workspace layout and workspace sort.
Values are allowlisted; malformed/unsupported storage uses safe defaults. An absent
workspace returns to all workspaces. An explicit known hash overrides the stored
view. Storage denial does not stop observation. Session links and notification
navigation select the source workspace and clear filters that could hide it.

Search terms, session selection, captured content and artifact drafts are not stored.
There is no process restoration, tab/split persistence, account, upload or database
migration. Clear site data to remove these UI preferences. Existing i18next language
storage and Bridge notification preferences keep their separate lifetimes.

## Screen and capability matrix

The status describes this checkout, not full product acceptance.

| Screen / capability            | Status      | Implemented files and verification                                                                                                                             | Remaining dependency or limitation                                                                                                                                  |
| ------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation shell and search    | Implemented | `App.tsx`, `Modal.tsx`, `CommandPalette.tsx`, `shell-preferences.ts`, `shell.css`; `tests/shell-preferences.test.ts`, `tests/browser/shell-navigation.spec.ts` | No workspace tabs, resizable splits or process/session restoration                                                                                                  |
| Overview / Observability       | Partial     | `App.tsx`, `LiveMetrics.tsx`, `SessionTokenBadge.tsx`, existing timeline/attention; dashboard, Live Metrics and shell browser tests                            | Rearrangeable widgets, broader performance metrics, verified costs and independent Observability screen remain planned; summary totals retain legacy limitations    |
| Workspaces                     | Partial     | `Workspaces.tsx`; shell browser cases cover scopes, search, sort, layout and reload                                                                            | No rename/archive, filesystem picker, pinning, multiple open project tabs or terminal layout                                                                        |
| Agents                         | Partial     | `Agents.tsx` projects actual adapter descriptors; shell cases cover matrix, unavailable state and locales                                                      | CLI path/version/auth/model discovery and managed profiles unavailable                                                                                              |
| Models & Analytics             | Partial     | Existing `ModelAnalytics.tsx`, `ModelComparison.tsx`, `ModelEvolution.tsx` and export components; dedicated existing browser suites                            | Observational comparisons only; real-provider comparative acceptance, task efficiency and verified cost remain pending                                              |
| Artifacts                      | Partial     | Existing `ArtifactPanel.tsx`, `artifact-preview.ts` and native save; artifact/draft/browser and native policy tests                                            | Manual extraction; inert limited Markdown, no standalone searchable artifact library or automatic extraction; draft persistence/navigation guards remain incomplete |
| Notifications                  | Partial     | `App.tsx`, `Modal.tsx`, `shell.css`; shell source-navigation/filter cases and existing dashboard/Desktop suites                                                | Native signed visual acceptance, quiet hours and broader preference scope pending                                                                                   |
| Settings                       | Partial     | Existing language/notification preferences, local shell preferences, temporary token threshold                                                                 | Grouped Settings, theme/density/font controls, global animation toggle, privacy/storage UI remain planned                                                           |
| Studio / interactive terminals | Blocked     | Existing `ObservedTools.tsx` is historical evidence only; observed-tools browser tests                                                                         | Managed ownership, operation authorization and validated PTY/provider runtime; no fake terminal or Start/Stop/Resume controls                                       |
| Orchestration / collaboration  | Blocked     | Explicit source-backed parent relationships remain visible in session details                                                                                  | No task/delegation execution contract; no agent-to-agent messages or inferred workflow                                                                              |
| Kanban                         | Planned     | No production board or placeholder cards                                                                                                                       | Requires explicit task entities, provenance and authorized transitions                                                                                              |
| Onboarding                     | Planned     | Existing empty/loading/offline states retained                                                                                                                 | Safe CLI discovery and a bounded first-run workflow                                                                                                                 |

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
