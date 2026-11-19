# Diag28 native terminal lifecycle

The baseline was `origin/integrate/spec` at `d3d3ef1`, including the Studio
embedding change `122db7d`. The packaged check used the default Node terminal
Core, an ad-hoc signed macOS debug bundle, an isolated app identifier and
loopback port, and a disposable registered workspace. Codex, OpenCode and
Claude were the installed native binaries.

## Root causes and changes

- **Terminate.** The Studio sent a close request from the main dashboard, while
  the AppKit review check required the removed
  `orqst-features://local/index.html` document. Both the card dialog and the
  pane menu enter this same native route. The native sheet now uses the
  current dashboard document. Its final dispatch retains the exact document,
  review, Feature, slot, terminal and Core identity. AppKit may deliver the
  confirmation before restoring the main WKWebView responder, so the final
  check accepts the key parent or its exact recorded sheet. The private
  broker signs the stop. Once a graceful stop is acknowledged, it can send
  one further signed stop after two seconds if the same owned attempt is
  still running. Release still requires exit or nondispatch evidence.
- **Reopen.** After the last confirmed close, the old metadata generation
  could outlive its Core and prevent the shell from adopting the next pool.
  A correlated whole-pool completion clears those cached generations and
  rereads durable Feature metadata. Reopen refreshes the catalog and only
  submits the selected released member. The existing database transaction
  preserves the display ordinal while recording the new terminal UUID.
- **Quit.** The pinned Tao macOS delegate reached its final event loop exit
  through `applicationWillTerminate:`. The AppKit termination path did not
  ask the Tauri `ExitRequested` circuit first. The app now adds the
  `applicationShouldTerminate:` decision to that delegate and schedules the
  same native Quit circuit used by the app menu. AppKit cancels the original
  request, so AppleScript can see `-128` while the sheet is pending. After
  confirmation, the Core supplies durable exit and retirement evidence
  before the app exits. OpenCode can still require the existing preserved
  leader-exit path when descendant retirement is unavailable.
- **Feature switch.** The old path hid existing geometry before it had
  accepted the selection or acquired the metadata latch. AX activation of
  a sidebar button can also leave the child PTY as the AppKit first
  responder. Selection and v2 geometry check the active owned window and
  exact document, with current scope and revision. The Feature service
  commits the selected view before replacing geometry. The retained PTYs
  and their buffers stay in their existing native documents.
- **First frame.** The old trace showed preparation, enrollment/host
  readiness, a native presentation gap, then provider startup and output
  polling. Two launch paths now reuse a just-verified executable digest
  from the same host process after reopening and checking file identity.
  The PTY child independently hashes the binaries before spawn. Claude
  reuses the result of the same publisher check within profile composition.
  A successful notarized publisher check already proves the base publisher
  requirement, so the base check is now the fallback. The catalog, signed
  start proof and process-exit evidence boundaries retain their checks.

## Historical diag28 T-004

A read-only check against the owner's original data found the kernel ancestry
`6390 → 6409 → 6426` while PID 6390 had parent PID 1. The current directory
of 6409 matched the private terminal manifest in the active admission marker.
That manifest's terminal UUID mapped to display ordinal 4 and had no durable
release. Its receipt records `prepared`, `armed` and `started`. The kernel
check and receipt show a live legacy process chain and an outstanding
reservation. The legacy producer has no authenticated reattachment endpoint.
The saved Feature projects this entry as **Estado incerto** inside Encerrados
and offers recovery details. It has no exit timestamp or Reopen action.
The documented native recovery and fresh confirmation remain the release
path. The original processes and admission marker were left in place.

## Reference review

Anywh's [terminalSession.ts](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/relay/src/host/terminalSession.ts#L5-L16)
keeps interactive PTYs in a separate named tmux server. The Relay uses
[spawnTerminal](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/relay/src/host/terminalSession.ts#L61-L117)
with `node-pty` and `tmux new-session -A` to attach again.
[AgentHost.restore](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/relay/src/agentHost/agentHost.ts#L280-L349)
and [AgentHost.close](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/relay/src/agentHost/agentHost.ts#L1286-L1334)
use a persisted registry, process-tree sweep and the retained agent log.
See the pinned [architecture](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/docs/architecture.md),
[Agent Host](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/docs/agent-host.md),
[runtime contract](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/relay/src/runtimes/README.md)
and [Apache-2.0 LICENSE](https://github.com/anywh-sh/anywh/blob/16d572d247ef16b79431c1ffe5695a8a1b57c913/LICENSE).
There is no root NOTICE at the inspected revision. ORQST keeps signed,
receipt-bound owned shutdown. A tmux session name or process-tree sweep
does not supply its admission ledger, owner confirmation or complete kernel
proof. This delivery incorporates no external code, dependencies or assets.

The macOS dispatch was checked in the locked Tao 0.37.2
[`app_delegate.rs`](https://github.com/tauri-apps/tao/blob/2d9b2ba15247879787878ae565e350bcc1b9f622/src/platform_impl/macos/app_delegate.rs)
and Tauri Runtime Wry 2.12.3 `lib.rs`. The integration adds a missing
selector without replacing an existing delegate implementation.

## Packaged macOS checks

- **Terminate and Reopen** — Closing the isolated Codex T-002 via the
  card and native confirmation returned a correlated success 343 ms after
  approval. T-002 appeared in Encerrados. Reabrir T-002 launched a new
  Codex process and a new UUID with the same visible ID. Its first frame
  arrived in 2,021 ms from the Reopen confirmation.
- **Feature switch** — Geral → Teste → Geral took 25 ms and 10 ms from
  native request to accepted metadata. The original pane and Codex output
  returned in place. There was no new CLI start for either switch. The
  browser fixture separately asserts the same UUID and rectangle after
  a Feature round trip.
- **Quit and relaunch** — AppleScript entered the native review. In the
  Codex-only run, the owned receipt recorded SIGTERM, the private broker
  returned `retired`, and the sampled process tree exited. Relaunch kept
  the same Feature selected, with the released terminal in Encerrados
  and no live card. In the Codex/OpenCode/Claude run, the broker recorded
  `exited_retirement_unavailable` followed by `closePreservedOwned: closed`.
  All sampled tree PIDs were absent afterward. The OpenCode descendant
  retirement remains pending under the existing contract.
- **Historical process check** — The original diag28 terminal's own
  receipt recorded SIGTERM at 23:07:57 local time, 30 minutes after its
  start, consistent with the existing PTY lifetime timer. At the final
  check PIDs 6390, 6409 and 6426 were absent and the original admission
  marker was still present. The receipt is leader-exit evidence and
  supplies no fresh administrative approval or complete-session fence.

## First PTY frame

The before column comes from the diag27 AX and `native.jsonl` evidence on
the owner's Mac. The after column uses the isolated lifecycle bundle and the
same installed binaries. The app had a cold Core for Codex and an active
Core for the subsequent providers. Each duration ends at the first nonempty
owned PTY read. The timings are individual observations from different
runs. They do not establish p95 or isolate a speedup to a single change.

| CLI      | Submit → card before → after | Submit → frame before → after |
| -------- | ---------------------------: | ----------------------------: |
| Codex    |                   24 → 18 ms |              3,093 → 2,138 ms |
| OpenCode |                   40 → 25 ms |              7,084 → 3,826 ms |
| Claude   |                   94 → 45 ms |              8,525 → 4,504 ms |

The stage breakdown uses elapsed milliseconds from the native request.
Helper includes the commit round trip, shown separately as a subset.
Presentation includes native layout, view load and focus. The last column
includes provider startup after the PTY leader exists and the broker read.

| CLI      |      Helper (to commit) | Host/enrollment | Presentation → dispatch | Dispatch → ready | Ready → first output |
| -------- | ----------------------: | --------------: | ----------------------: | ---------------: | -------------------: |
| Codex    |     1,129→432 (290→247) |         699→545 |                 463→457 |          677→533 |              122→168 |
| OpenCode |     1,843→702 (750→354) |         912→414 |                 372→696 |        1,096→493 |          2,856→1,517 |
| Claude   | 3,439→1,235 (1,514→533) |       1,252→815 |               1,432→943 |        1,654→932 |              737→576 |

There was no separate interactive executable review in those traced opens.
OpenCode still spent 1.52 s after the broker reached ready. Claude still
spent 2.05 s in preparation and enrollment and 0.94 s reaching dispatch.
Both exceeded the three-second budget in the sampled run. The package
validated initial terminal output, including Claude's workspace trust prompt.

A final repeat on the rebuilt package reopened T-001 and submitted a second
Codex terminal without refreshing the provider catalog by hand. The second
card appeared in 26 ms and its first frame took 3,107 ms during the final
browser run. AppleScript Quit retired this Codex-only pool.

## Checks and evidence

| Check                                              | Result                               |
| -------------------------------------------------- | ------------------------------------ |
| `pnpm lint`, `pnpm typecheck`                      | Passed                               |
| Focused Node suites, serial                        | 112 passed                           |
| Feature/Studio Chromium spec, `--workers=1`        | 9 passed, 1 optional capture skipped |
| Tauri shell Cargo suite, `--test-threads=1`        | 202 passed, 2 ignored                |
| Rust terminal Core Cargo suite, `--test-threads=1` | 71 passed, 1 ignored                 |
| Dashboard resource staging and isolated Preview    | Passed                               |

The combined Chromium run of the Feature/Studio fixture, L3 lifecycle and
Studio workspace specs had 10 passes, 1 optional capture skip and 9 failures.
The nine failures match the older cases recorded on the untouched baseline
in the [diag27 report](diag27-terminal-embedding.md#checks).

The browser regression spec covers native request shapes and UI state with
synthetic replies. The package checks used AX actions, native diagnostics, exit
receipts, process snapshots and `screencapture -x -o -l` on the real macOS
window. The package uses the default Node terminal Core. No root `pnpm build`
or full Node suite was run. The shared Cargo target was reused throughout.
