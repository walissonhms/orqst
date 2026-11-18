# ORQST V6 screen bodies

L5 implements §11 of the approved [ORQST app specification](../../product/orqst-app-specification.md). The existing dashboard outlet mounts the page bodies. Its baseline routes are `/overview`, `/models`, `/artifacts` and `/settings`. The existing `/agents` URL opens Settings › Agents. L1 owns the final route paths and shared header-actions slot. The bodies use compact local controls until that slot is available.

## Desktop captures

These Chromium captures show the actual dashboard components. The isolated bridge uses repository-supplied synthetic event data. The capture test also supplies schema-validated synthetic native evidence and analytics readings. The V6 HTML reference is the approved Studio prototype, so it provides shared palette, density and control geometry for comparison. Its stage and shell are outside L5.

| View                 | 1440 × 900                               | 1280 × 800                                |
| -------------------- | ---------------------------------------- | ----------------------------------------- |
| Approved V6 HTML     | [Reference](1440x900/v6-reference.png)   | [Reference](1280x800/v6-reference.png)    |
| Overview             | [Large](1440x900/overview.png)           | [Laptop](1280x800/overview.png)           |
| Metrics › Usage      | [Large](1440x900/metrics-usage.png)      | [Laptop](1280x800/metrics-usage.png)      |
| Metrics › Models     | [Large](1440x900/metrics-models.png)     | [Laptop](1280x800/metrics-models.png)     |
| Metrics › Limits     | [Large](1440x900/metrics-limits.png)     | [Laptop](1280x800/metrics-limits.png)     |
| Artifacts › Rendered | [Large](1440x900/artifacts-rendered.png) | [Laptop](1280x800/artifacts-rendered.png) |
| Artifacts › Markdown | [Large](1440x900/artifacts-markdown.png) | [Laptop](1280x800/artifacts-markdown.png) |
| Settings › General   | [Large](1440x900/settings-general.png)   | [Laptop](1280x800/settings-general.png)   |
| Settings › Agents    | [Large](1440x900/settings-agents.png)    | [Laptop](1280x800/settings-agents.png)    |
| Onboarding           | [Large](1440x900/onboarding.png)         | [Laptop](1280x800/onboarding.png)         |

The page bodies use the V6 panel background `#090b10`, separator `#262334`, purple accent `#a17bff`, square panels and buttons with a 5px radius. Settings content is capped at 640px. The captures preserve the baseline frame around those bodies.

## Contract coverage

- **Overview.** Core snapshots supply known terminal state, recent tool evidence and the selected Feature's retained message projection. Tokens today include confirmed usage for terminals started today. The observed history is collapsed and read-only. The bridge does not supply a cross-Feature delivery-failure list or a complete daily message/token aggregate. Rows use the existing Studio display labels and route using the terminal UUID.
- **Metrics.** Historical usage and model ranking cover observed records. The Feature view shows current owned snapshots with usage when the host provides it. Per-Feature historical series and wider provider-limit coverage require additional Core evidence. Cache is included in input.
- **Artifacts.** Copy and download work from the library. Save and open in the desktop editor use the installed native file capability. The existing retained Codex extraction identifies the Workspace and session. It supplies no Feature association, so the Feature filter displays that gap.
- **Settings.** Language, startup, appearance, existing notifications and quota thresholds use their current stores. The catalog supplies availability and models. The integrated native catalog reports the canonical path and pinned version when a unique reviewed executable matches. Login remains unknown. Terminal font, scrollback, safe-close preferences and log access require native settings contracts.
- **Onboarding.** The desktop can continue with the current Workspace and select its default Feature when present. The browser accepts the manual Workspace path supported by its bridge. A native folder picker and managed Workspace creation require an outlet from the host. Skip works in both.

## Verification

- `pnpm lint` and `pnpm typecheck`
- `pnpm --filter @orqst/dashboard build` builds the browser fixture assets. Root and native builds are outside this verification.
- `ORQST_SPEC_L5_SCREENSHOTS=1 pnpm test:browser tests/browser/spec-l5-screens.spec.ts --trace off --workers=1` runs the five screen checks and two viewport captures. Set `ORQST_BROWSER_PORT` to a free port for isolation.
- `pnpm exec tsx --test --test-concurrency=1 tests/overview-preferences.test.ts tests/artifact-library.test.ts tests/artifacts.test.ts tests/analytics-evolution.test.ts tests/live-metrics.test.ts tests/desktop-artifacts.test.ts` covers the existing data contracts.
- Native release acceptance remains open. The browser checks exercise UUID targeting, safe artifact handling, preferences and first-run navigation through the renderer and its test fixtures.
