# Chromium suite recovery at d9c3e17

The unchanged dashboard and one Chromium worker reported **218 passed, 13 failed
and 4 skipped**. The four skips are the existing opt-in visual captures. This
delivery keeps every test.

| Baseline case in `tests/browser/`                 | Runs | Class | Change and retained coverage                                                                                                                                                                  |
| ------------------------------------------------- | ---: | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `observation-guide` · offline onboarding          |    1 | B     | Restore Skip when the observer's first snapshot fails. Start stays disabled. Diagnostics still show unknowns and Core Offline. §3.5 and §11.5.                                                |
| `settings` · comfortable appearance across views  |    1 | A     | Assert the current Settings and Metrics headings. Preserve the overflow, contrast, spacing and exact confirmed token assertions. §11.2 and §11.4.                                             |
| `shell-navigation` · shared frame                 |    2 | A     | Observed projects stay in observation views. Supply Core process evidence and verify the real managed counts, geometry, route and exact palette target. §3.2 and §3.4.                        |
| `shell-navigation` · adapter inventory            |    1 | A     | Use a verified-scope catalog with unreported fields. Assert both languages, missing values and passive-only requests. §7 and §11.4.                                                           |
| `shell-navigation` · responsive views and dialogs |    1 | A     | Assert the unavailable discovery state in a browser without native authority. Preserve viewport and keyboard checks. §7 and §11.4.                                                            |
| `studio-alerts` · deduplication and focus         |    1 | A     | Supply live process evidence for the target card. Preserve exact Feature/UUID focus, read persistence and deduplication. §6.1 and §8.4.                                                       |
| `studio-workspace` · full viewport and drawer     |    1 | B     | Keep startup recovery inside the stage and fit the limits chip on a 320 px viewport. The fixture waits for saved metadata before requesting the denied catalog. §3.1, §3.5 and §5.1.          |
| `studio-workspace` · scoped Feature geometry      |    2 | A     | Open the available free slot on the approved grid. Preserve exact selection revisions, PTY membership, archive refusal and viewport checks. §4.1.                                             |
| `studio-workspace` · focus restoration            |    1 | A     | Enter through the React menu button and verify that focus returns to the same card UUID with zero native pane commands. §2.1 and §4.2.                                                        |
| `studio` · scoped breadcrumb delegation           |    2 | A     | Provide synthetic process evidence for the four in-scope cards. Preserve the signed request shape, exclusion of the other Feature and rejection of a mismatched receipt. §5.2, §6.1 and §8.1. |

**C · Reading preferences.** The baseline full run passed this case, but the
reproduction with a write observer recorded three replicated writes from the
receiving tab on the unchanged build. The previous effect persisted every React
update, including updates from storage events. A stale event could therefore
write older values back. Only explicit local edits now persist. Receivers read
the latest stored value. The test asserts zero receiver writes as well as
cross-tab synchronization, reload persistence and reset focus. No sleeps or
retry configuration were added.

ORQST's `useWorkspacePins` already uses explicit writes and reads the latest
stored value on a storage event. The fix keeps that local pattern. Anywh's
Apache-licensed settings module owns separate profile and update storage.
ORQST keeps its existing appearance keys and defaults. No external source or
dependency was incorporated. The renderer retains the existing Core snapshot
and signed arrange authority described in the diag27 review. [Anywh settings](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/client/src/lib/settings.ts),
[diag27 reference review](diag27-terminal-embedding.md#reference-review).

| Browser capture             | 1440 × 900                                                   | 1280 × 800                                                   |
| --------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Offline observer onboarding | [Dashboard](suite-green-d9c3e17/offline-onboarding-1440.png) | [Dashboard](suite-green-d9c3e17/offline-onboarding-1280.png) |
| Managed startup recovery    | [Dashboard](suite-green-d9c3e17/startup-retry-1440.png)      | [Dashboard](suite-green-d9c3e17/startup-retry-1280.png)      |
| Approved Studio shell       | [V6](diag28-ui/1440x900/v6-studio.png)                       | [V6](diag28-ui/1280x800/v6-studio.png)                       |

The [320 × 600 capture](suite-green-d9c3e17/startup-retry-320.png) shows the
limits chip within the same shell. The browser uses synthetic native facades.

## Additional validation

The two opt-in L5 captures initially expected first-run onboarding from a
populated live workspace. Their fresh page now uses a confirmed empty startup
catalogue and independent CLI discovery. Both L5 captures and the two reference
captures passed with capture flags enabled.

The first serial Node run reported 1,595 passed and 3 failed. The startup
counter fault-injection fixture now supplies a fail-closed `spawnSync` stub for
the executable signature import. Two model-observation tests now check the
short historical label and its nested tooltip separately. The same assertions
still prohibit fabricated model time, availability, controls and usage.

## Final checks

| Command                                                               | Result                                          |
| --------------------------------------------------------------------- | ----------------------------------------------- |
| `pnpm exec playwright test tests/browser --workers=1`                 | 231 passed, 0 failed, 4 opt-in captures skipped |
| Same Chromium runner with the four capture cases enabled              | 4 passed, 0 failed                              |
| `pnpm exec tsx --test --test-concurrency=1 tests/*.test.ts`           | 1,598 passed, 0 failed, 0 skipped               |
| `pnpm lint`, `pnpm typecheck`, `pnpm --filter @orqst/dashboard build` | Passed                                          |
