# Native startup and terminal-opening performance

The Desktop dashboard can load while the observer reads the first bounded pass
through Codex history. The pass still records real checkpoints and ingests
historical records without marking them live. The dashboard shows the localized
history status during that pass and waits for a matching session before resolving
a historical deep link. Additional passes can be needed for large files.

## Stage map and diagnostic evidence

| Stage                              | Work on the path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `observer_startup`                 | Tauri's `sidecar::start` spawns pinned Node and waits for `ORQST_CORE_READY`. The Bridge opens SQLite, binds loopback and runs retention. Previously, readiness then waited for `CodexObserver.start` to walk the tree, open files, validate checkpoint anchors and read up to 8 MiB per file. Parsing, redaction, SHA-256 of source records and synchronous SQLite writes are part of this pass. The watcher and polling now run while the first pass catches up.                                                                                   |
| `helper_spawn` → `helper_complete` | `terminal_creation::run` spawns one bundled Node preparation helper per request. Catalog discovery reads bounded PATH metadata and model sources, verifies reviewed native executables, resolves the workspace from observer SQLite and inspects pending exit metadata. There is no CLI `--version` or authentication command. The old catalog hashed each sole reviewed executable twice. OpenCode now stops at the first reviewed candidate, preserving precedence. Catalog and the initial Studio snapshot can be requested together.             |
| `commit`                           | The native handler revalidates document, generation, current owner and one-use latch before replying. Time before the latch includes helper startup, admission checks, repeated executable/model discovery and planning. Time after it includes revalidation, directory and binary checks, writing and renaming the staged profiles, manifest inspection and optional Feature assignment. Preparation checks only its selected providers and model evidence, including after the native commit.                                                      |
| `enrollment`                       | The native host waits for the existing Core over a correlated pipe. `enroll` flushes layout, inspects the reservation, verifies the manifest and binding, reserves the slot, opens the journal, commits evidence and appends layout/document state. The admission marker has synchronous durability work. Previously, the same large CLI and Node files were rehashed across each repeated manifest validation. The Core freshly hashes at candidate inspection and repeats the metadata, model, scope and receipt checks across the durable fences. |
| `presentation`                     | The native main-thread callback creates the retained WebView and records its opening intent. The separate presentation ACK refreshes Feature/layout under the captured generation. The native timing includes both. On the supplied enrollment traces, presentation itself took 73–121 ms. The preceding enrollment work took 1.04–4.88 s.                                                                                                                                                                                                           |
| `cli_opening`                      | The broker validates native consent and signs separate start, attach and input challenges. Node revalidates the profile and the pinned Node runtime before forking the PTY host. That independent host rehashes the launch files, arms the durable lifecycle receipt and spawns the PTY. The broker polls `starting` at 100 ms intervals up to its deadline before attaching. Polling adds a quantization interval under normal scheduling, while child scheduling, hashing and durable writes can dominate.                                         |

The read-only native log shows 7 ms to spawn the observer at the reported slow
startup, 104.94 s from observer request to ready and another 2.35 s to native setup
ready. Earlier starts in the same log completed observer startup in 0.16–0.20 s.
Native catalog helper spawn took 5–7 ms on the reported samples. Completed helper
requests reached 4.68–9.15 s in the later samples, compared with many earlier
requests around 0.9–1.5 s. A separate request failed at 15.743 s with only the
generic `request/failed/possible` envelope. It does not identify a timeout or
failure cause. The checked-out sidecar source has a 30 s ready watchdog. The 105 s
trace alone cannot establish why that watchdog did not appear. The controlled
benchmark establishes the ingestion dependency independently.

## Reproduce with disposable fixtures

From the repository root on macOS arm64, use Node 24, pnpm 10 and the Xcode
Command Line Tools. Run the same script on the base and candidate revisions.

```bash
pnpm exec tsx scripts/benchmark-native-opening.ts 3
pnpm exec tsx scripts/benchmark-native-opening.ts 3 --catalog-only
```

The benchmark uses bundled production Node entries, ephemeral loopback ports,
a fresh SQLite store per trial, 16 synthetic JSONL files with 32,768 messages,
three approximately 97 MiB synthetic executable copies, the actual Node
executable and a real PTY running the synthetic C fixture. Only the disposable
bundle substitutes synthetic provider pins. The harness sends native-equivalent
commit, enrollment, presentation and consent messages through the existing
private pipes. It measures the Node presentation ACK independently of AppKit.
The two manifests are prepared before the Core starts, and the second is enrolled
into the already-running Core. A synthetic-only helper reports bytes hashed and
process CPU time (user + system). No application bundle is launched and the
fixture supplies its own HOME and configuration.

## Before and after

The base is `20cb5ccfa4cb5e4a87c6f41788cfd271dc6011a2`. Values below are medians
in milliseconds, based on three trials per revision. The native arm64 machine
has 10 logical CPUs.

| Measurement                                               |  Base | Candidate |
| --------------------------------------------------------- | ----: | --------: |
| Observer ready, empty source                              |   205 |       153 |
| Observer ready, synthetic history                         |   885 |       152 |
| First snapshot, synthetic history                         |   898 |       167 |
| First scan completed, synthetic history                   |   899 |       480 |
| Catalog helper, spawn to exit                             |   722 |       388 |
| Catalog helper CPU                                        |   685 |       392 |
| Preparation helper, spawn to commit request               | 1,348 |       365 |
| Commit reply to preparation result                        | 1,268 |       274 |
| Preparation helper, spawn to exit                         | 2,623 |       648 |
| Cold managed host, spawn to ready                         | 1,634 |     1,033 |
| Enrollment, request to reply                              | 1,406 |       476 |
| Presentation, Node ACK only                               |    26 |        10 |
| CLI opening, request to ready                             | 2,383 |       828 |
| Preparation + enrollment + presentation ACK + CLI opening | 6,439 |     2,022 |

In each base trial the history fixture added 611–703 ms to readiness compared
with the empty source. The candidate's corresponding deltas ranged from −36 to
15 ms. The base had all 16 sessions in its first snapshot. The candidate had
zero in its first snapshot and all 16 when the pass finished. Scan completion
is polled at 100 ms in the harness.

The helper read 581 → 290 MiB to hash the catalog and 2,810 → 427 MiB to hash
the subsequent preparation. Preparation helper CPU fell from 2,459 → 580 ms.
The initial one-minute load averages were 19.8–23.5 for the base and 16.1–16.6
for the candidate. Wall times include scheduling and I/O delays. In a higher-load
catalog-only run (21.5–24.0), helper CPU fell from 808 to 533 ms while elapsed
exit time rose from 965 to 1,524 ms. The byte and CPU counters establish the
reduction in helper work independently of a wall-time claim at higher load.

An additional base control at load 18.0–18.2 took 1,673 ms to announce history
readiness, 835 ms for catalog exit, 1,313 ms for enrollment and 1,918 ms for CLI
opening. The candidate trial ending at load 18.2 measured 152, 388, 476 and
1,018 ms respectively. A single overlapping observation cannot characterize
scheduling variance.

The standalone Bridge still waits for scan readiness. Cold Desktop startup
still includes process initialization and retention. The first catalog in a
helper still hashes each reviewed candidate used for the decision. Opening
still pays for fresh hashes, native host/PTY startup, signed RPCs and durable
evidence. Native WebView behavior, the running Preview, real CLI/provider
startup and the opt-in Rust terminal Core require separate acceptance.

## Security and reuse review

The digest cache is bounded and process-local. A cache hit still opens the
canonical file with `O_NOFOLLOW`, checks current owner, mode and ancestry, and
compares the descriptor and path identities. Device, inode, birth time, size,
mtime, ctime and permission/ownership changes invalidate the verification. A
full hash rejects mid-read metadata changes. Provisioning, initial enrollment
and executable dispatch retain fresh hashing at their trust boundaries.
Workspace/Feature fences, native focus and review, signed challenges, admission
markers and lifecycle receipts still govern each effect. The local API uses the
existing Host/Origin checks, bootstrap cookie, CSP and loopback binding.

- Anywh `4f8aef7b5f0dc9cf0832e457c224dc09a9792a21` was checked against its
  architecture, Agent Host and runtime contract. Its Tauri/Tokio/serde sidecar
  reports the existing local listen address when the sidecar protocol publishes
  it. Its persistent Relay terminal request calls `spawnTerminal`, which uses
  `node-pty` and an existing named tmux session when available. Apache-2.0,
  with no tracked NOTICE at this revision. Keep ORQST's existing Anywh-derived
  sidecar and signed PTY admission. Tmux does not provide those guarantees.
  [Sidecar source](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/client/src-tauri/src/tailnet_sidecar.rs#L166)
  [Terminal source](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/relay/src/host/terminalSession.ts#L87)
  [License](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/LICENSE)
- T3 Code `009966d073aa093832ed39278f524e9870adffd6` uses a persistent Effect
  manager with direct `node-pty` spawning and cached spawn-helper setup. Its
  `ProviderRegistry.syncLiveSources` serves cached boot status and subscribes
  to refreshes. Provider status checks may invoke `--version`, independently
  of terminal open. MIT root license and no root NOTICE. Keep ORQST's separate
  passive discovery and execution authority. Adapt the general separation of
  readiness from background work using the existing observer, with no code copy.
  [Terminal manager](https://github.com/pingdotgg/t3code/blob/009966d073aa093832ed39278f524e9870adffd6/apps/server/src/terminal/Manager.ts#L2807)
  [PTY adapter](https://github.com/pingdotgg/t3code/blob/009966d073aa093832ed39278f524e9870adffd6/apps/server/src/terminal/NodePtyAdapter.ts#L247)
  [Provider registry](https://github.com/pingdotgg/t3code/blob/009966d073aa093832ed39278f524e9870adffd6/apps/server/src/provider/ProviderRegistry.ts#L962)
  [License](https://github.com/pingdotgg/t3code/blob/009966d073aa093832ed39278f524e9870adffd6/LICENSE)
- Tucano `86b785dc4f83c656fd2bf936bb47a1e4d801a04c` uses Electron WebContents
  for conversation routing. Apache-2.0 and no root NOTICE. The inspected path
  does not implement ORQST's pinned PTY admission or Codex observer startup.
  Keep the existing ORQST path.
  [Routing source](https://github.com/eduwxyz/tucano/blob/86b785dc4f83c656fd2bf936bb47a1e4d801a04c/src/main/servers.ts#L298)
  [License](https://github.com/eduwxyz/tucano/blob/86b785dc4f83c656fd2bf936bb47a1e4d801a04c/LICENSE)
- The public Overclock site describes pane UX. It supplies no source and license
  for the costs measured here. No UI or code reuse.
  [Overclock](https://overclock.sh/en)

The two historical files named in the project instructions
(`implementation-plan.md` and `tucano-audit.md`) are absent at the pinned
baseline. The current architecture overview, master-spec tracker, V6 references
and checked-out upstream source were used.

## Verification

The full Node suite ran 1,517 tests. A structured Codex startup diagnostic
exceeded its 55 s deadline and the synthetic AppKit coexistence preflight
missed its resident-process assertion in that run. Both files passed when
run individually. The 131 focused checks covering Core startup, the Desktop
sidecar, Native Terminal Creator, enrollment files and selection also passed.
