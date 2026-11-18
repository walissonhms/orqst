# V6 Settings, notifications and account limits

The approved Studio HTML defines the palette, typography and density.
The accompanying UI/UX specification covers these secondary screens in
§§3.10–3.12 and 4.2.
[Approved HTML](../../../design/v6/source/ORQST_workspace_v6_features.html) ·
[UI/UX specification](../../../design/v6/source/ORQST_UI_UX_FEATURES_ATUALIZADO.md).

## Comparison

Before captures are in commit `9c4719b` on `origin/docs/v6-parity-audit`,
under `docs/development/v6-parity/{1440x900,1280x800}/`. The table uses the
same relative names in the before and after directories.
[Before, 1440×900](https://github.com/walissonhms/orqst/tree/9c4719b/docs/development/v6-parity/1440x900) ·
[Before, 1280×800](https://github.com/walissonhms/orqst/tree/9c4719b/docs/development/v6-parity/1280x800).

| Screen         | Before and after names                  | After, 1440×900                                                                                                                                                                                                                                            | After, 1280×800                                                                                                                                                                                                                                            |
| -------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notifications  | `observer/04–05`, `observer/09–10`      | [Empty](1440x900/observer/04-notifications-empty.png), [unread filter empty](1440x900/observer/05-notifications-unread-empty.png), [unread](1440x900/observer/09-notifications-unread.png), [source](1440x900/observer/10-notification-source-session.png) | [Empty](1280x800/observer/04-notifications-empty.png), [unread filter empty](1280x800/observer/05-notifications-unread-empty.png), [unread](1280x800/observer/09-notifications-unread.png), [source](1280x800/observer/10-notification-source-session.png) |
| Settings       | `observer/settings`, `observer/08`      | [Settings](1440x900/observer/settings.png), [guide](1440x900/observer/08-settings-guide.png)                                                                                                                                                               | [Settings](1280x800/observer/settings.png), [guide](1280x800/observer/08-settings-guide.png)                                                                                                                                                               |
| Account limits | `tauri-chrome/19–21`, `tauri-chrome/24` | [Limits](1440x900/tauri-chrome/19-limits.png), [accounts](1440x900/tauri-chrome/20-limit-accounts.png), [thresholds](1440x900/tauri-chrome/21-limit-caps.png), [unavailable](1440x900/tauri-chrome/24-limits-unavailable.png)                              | [Limits](1280x800/tauri-chrome/19-limits.png), [accounts](1280x800/tauri-chrome/20-limit-accounts.png), [thresholds](1280x800/tauri-chrome/21-limit-caps.png), [unavailable](1280x800/tauri-chrome/24-limits-unavailable.png)                              |

The captures use PT-BR, dark appearance and reduced motion. Observer captures
use the production dashboard renderer with disposable Bridge fixtures. Chrome
captures mount the production Feature WebView document in Chromium with
synthetic native replies. Native WebKit, PTY and live provider acceptance are
pending.

The Settings groups and drawer use square near-black surfaces, compact
section headers and restrained purple accents. The guide keeps its heading
visible when scrolled. The observed source view retains its existing shell
and session inspector. The account panel uses a compact heading, displays
reported zero as zero and omits bars and countdowns for unknown or expired
usage. Its warning and critical controls set local display thresholds.

## Composition

- **Lane 1.** `SettingsProps.returnAction` accepts a localized label and an
  `onReturn` handler. Supply it when Settings was reached from Studio, using
  the same navigation guard and retained Workspace/Feature selection. The
  base branch reaches Settings through the Studio Overview action, and
  browser history returns to Studio. Expose the existing bell controller in
  Studio and reuse its snapshot, read counts and preference actions.
- **Lane 1.** Reuse `findNotificationSource(snapshot, sessionId)` when issuing
  an observer notification's source action. It requires exactly one matching
  session ID. `NativeSessionNavigation` uses the same lookup after its existing
  authenticated refresh and additionally requires the Codex adapter. Keep
  `notification-drawer shell-dialog` on the owning Modal to use the shared V6
  styles. The lane uses existing bilingual keys in the current catalogs.
- **Lane 2.** Keep `AccountLimits` in the active native Feature toolbar with
  the existing `AccountLimitsProps`, native refresh/lock callbacks and
  settings persistence. Wire Settings and Notifications through the existing
  host navigation mechanism when composing the standalone Feature WebView.
  The overlay exposes `data-native-overlay` and `onOpenChange` for the owning
  chrome. Recalculate covered native panes when its rectangle changes while
  open.

The current notification contract supplies observed completion, failure and
input requests, with confirmed read state and a session destination.
Per-Workspace rules, quiet hours, per-item dismissal and pane/task receipt
links require additional contracts.

## Reference decisions

- Anywh's [CodexSessionDriver](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/codexDriver.ts)
  depends on the Codex daemon, turn history and plan-usage capture. The
  [plan-usage policy](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/plan-usage.md)
  includes provider acquisition paths outside the renderer's authorization.
  Keep ORQST's existing validated native report contract and read-only
  observer boundary. [Apache-2.0 license](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE).
- Tucano's [usage function](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/usage.ts)
  consumes database receipts and counted token helpers to aggregate monthly
  totals. These data cannot establish ORQST account quota. Keep provider
  windows distinct from cumulative session metrics.
  [Apache-2.0 license](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE).
- The [existing reference audit](../../../research/reuse-first-audit.md)
  records license and notice evidence for these pins. Overclock remains a
  visual reference with no verified source and license pin for reuse. This
  increment uses ORQST components and the owner-supplied HTML palette.

## Verification

- Frozen install and dashboard-only Vite build passed on Node 24.22.2 and pnpm
  10.34.9. Vite reported its chunk-size advisory.
- Chromium passed 21 cases across the notifications and settings specs with
  `--workers=1 --timeout=60000` on the shared machine. Both locales exercised
  notification filtering, exact session selection, settings navigation, overlay
  focus and account thresholds. The PT-BR gallery covers both audit sizes.
- The focused account-limits model and native-notification navigation suites
  passed 10 cases. The full `pnpm test` run reported 1,328 passes, 11 failures
  and 3 cancellations. Failures included Studio preparation, Analytics and
  PTY timing. The remaining offline-reservation fixture was stopped after
  running for over 15 minutes on the shared machine.
