# Reuse-first audit — 2026-11-03

## Scope and evidence rules

This is a static, commit-pinned audit of existing CLI integration, structured drivers,
owned processes, recovery, usage and collaboration. ORQST baseline:
`fe004d6` (Node `>=24 <25`, pnpm `10.34.9`, strict TypeScript `~6.0.3`, ESM,
Electron `45.2.1`, React 19, `node:sqlite`, `node-pty` `1.1.0`). The normal
Core/Bridge observer stays read-only. Explicit native grants, owned managed execution,
terminal input and scoped MCP delegation are legitimate separate mechanisms under
ADR-015/018/032/033; they are assessed by their actual evidence and authorization.
No generic execution or PTY prohibition is used as a technical rejection.

Evidence labels apply to every matrix cell and the detailed records below:

- **OBSERVED:** static source at the linked SHA/lines, or a named local test actually
  executed for this change. Static observation does not prove provider operation.
- **DECLARED:** a claim in upstream documentation/comments at the specified commit.
- **INFERRED:** an engineering assessment, effort estimate or proposed acceptance plan.
- **UNVERIFIED:** missing evidence; never promoted to a supported capability.

The [audited-reuse decision](../architecture/decisions.md#adr-035--audited-source-reuse-with-preserved-observer-and-managed-boundaries)
permits compatible incorporation after license, NOTICE, dependency and security review.
The historical Tucano audit is preserved. This is a new component decision, not a
retroactive claim that the observer was an execution system.

## Source and license ledger

| ID  | Exact source and license                                                                                                                                                                                                                                                                                                                                                                                               | NOTICE / package declaration / verification                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **OBSERVED:** [Anywh `546f189c04415c3c5af5f40e3931a0a90b9aba31`](https://github.com/anywh-sh/anywh/tree/546f189c04415c3c5af5f40e3931a0a90b9aba31), [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE), Apache-2.0.                                                                                                                                                     | **OBSERVED:** recursive tracked-tree scan finds root LICENSE, no NOTICE/COPYING or nested license files. `relay/package.json` and `client/package.json` have no SPDX `license` field; the root grant, not an invented manifest field, licenses the selected file. Selected source has no copyright/header or generated-code marker to remove. |
| T   | **OBSERVED:** owner-identified [Tucano `0501956d127699300209902e889f3e69a0948766`](https://github.com/eduwxyz/tucano/tree/0501956d127699300209902e889f3e69a0948766), [LICENSE](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE), [package.json](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/package.json): SPDX Apache-2.0, version 0.2.6. | **OBSERVED:** recursive tracked-tree scan finds root LICENSE, no NOTICE/COPYING or nested license files. No code/assets/schemas imported. A newer fetched tip `cdc70feb56f4ac29c74a9de46dff2d6b514ff61d` is recorded for identification only; it is **UNVERIFIED** for component reuse and does not replace this pin.                         |
| O   | **DECLARED:** [Overclock product](https://overclock.sh/en), [panes](https://overclock.sh/features/panes), [workflow](https://overclock.sh/en/how-it-works) describe agent panes and task delivery.                                                                                                                                                                                                                     | **UNVERIFIED:** the inspected official pages/search did not establish a corresponding source repository, exact source SHA, package SPDX, LICENSE or NOTICE. This is not proof that none exists. No source/binary extraction or code copying. Reconsider only after an exact permissive source grant is established.                           |

Both fetched A/T LICENSE blobs have SHA-256
`cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.
A `relay/src/agentHost/lineSplitter.ts` has SHA-256
`b9e38f1ddcb7537e3e84d1542c29c4233c546cde985ef4e9711ee9ff77eba882`.
Absence of NOTICE was checked in each complete tracked tree at its pin, not inferred
from GitHub's license badge. Untracked/release artifacts are not audited. Whole-project
and dependency redistribution is not approved by these narrow source grants.

## Decision matrix

`KEEP-EXISTING` means retain the current implementation; `WRAP` is a conditional next
integration design, not code already incorporated. `REJECT` applies to the concrete
candidate/configuration, not a permanent ban on its mechanism. All references A/T
below inherit the exact SHA and license/NOTICE record above. Detailed records give
component closure, platforms, affected storage/transport, tests and rollback.

| ID / concrete problem                          | Existing ORQST evidence                                                                                                                                                                                                                                                       | Exact upstream implementation                                                                                                                                                                                                                                                                                                          | Dependency / runtime evidence                                                                                                                                                                                                                                                                       | Decision and policy / architecture                                                                                                                                                                                                                                                                   | Effort, acceptance and rollback                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 CLI location without surprise execution      | **OBSERVED:** `packages/core/src/terminal/local-cli.ts:27`, `tests/local-cli-discovery.test.ts`; bounded PATH/realpath, authentication unknown.                                                                                                                               | **OBSERVED:** A [detection.ts:38–104](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/detection.ts#L38-L104), `detectRuntime`/`detectRuntimes`; `executables.ts` resolver.                                                                                                          | **OBSERVED:** child_process + childEnv + executable/path helpers; capabilities pass through definitions. **UNVERIFIED:** full transitive closure / installed-version operation.                                                                                                                     | **INFERRED: KEEP-EXISTING.** `--version` is execution, unlike current passive preflight; resolve-by-name is weaker than exact executable review. Explicit authorized version probing remains possible. A license, §§1/4/6 compatible only behind managed authorization.                              | **INFERRED:** small future bounded probe; accept missing/timeout/denied/symlink cases without changing passive discovery. Rollback: remove isolated opt-in probe; no data changes.                                                                                                        |
| 2 Model catalog and native auth                | **OBSERVED:** `terminal/local-cli.ts`, `managed-codex/runtime.ts`, `terminal/codex-profile.ts`; discovery unknown, structured `account/read`, exact model confirmation.                                                                                                       | **OBSERVED:** A [probes/modelCatalog.ts:21](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/probes/modelCatalog.ts#L21), `probeRuntimeAuth` in `probes/runtimeAuth.ts:33`; `defs/claude/def.ts:119–150`, `defs/codex.ts`.                                                           | **OBSERVED:** spawn, childEnv, executables, provider definitions/parsers; Codex session RPC differs from Claude subprocess initialization. **UNVERIFIED:** complete closure and installed CLI entitlement.                                                                                          | **INFERRED: WRAP**, future explicit per-provider request only; no automatic probe/login/cache-to-entitlement promotion. A grant compatible; preserve account-field minimization and §§1/4/6. Nothing imported.                                                                                       | **INFERRED:** medium; test malformed/timeout/native keyring, model visibility versus access and consent revocation. Rollback: wrapper absent returns unknown and existing model confirmation remains.                                                                                     |
| 3 Structured Codex protocol                    | **OBSERVED:** `managed-codex/{channel,adapter,runtime}.ts`, `tests/codex-structured-runtime.test.ts`, `tests/codex-native-initialize.test.ts`; bounded RPC, signed admission and separate task authority.                                                                     | **OBSERVED:** A [CodexSessionDriver](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/codexDriver.ts#L108), `defs/codex.ts:151–250`, `transports/codexDaemon.ts`, `jsonRpcStdio.ts`.                                                                                            | **OBSERVED:** driver imports daemon, history mapping, session-store types and planUsageCapture; generic frame decoder appends unbounded strings. **DECLARED:** codex.ts:15–17 cites generated Codex 0.154.0 bindings. **UNVERIFIED:** transitive license closure / ORQST's reviewed 0.162.1 parity. | **INFERRED: KEEP-EXISTING.** Avoid replacing bounded parsing/ownership with a coupled driver and expanded protocol. A license permits later narrow extraction; §§1/4/6 require separate opt-in managed ownership, not observer adoption.                                                             | **INFERRED:** high for full driver; synthetic late/mismatched RPC, lost receipt, revocation and UTF-8 tests first, separately authorized native evidence later. Rollback: existing driver remains; no schema change.                                                                      |
| 4 Claude structured driver                     | **OBSERVED:** `terminal/interactive-adapters.ts`, `terminal/provider-mcp-config.ts`, `tests/provider-mcp-config.test.ts`; reviewed interactive/MCP path, no production structured Claude adapter.                                                                             | **OBSERVED:** A [defs/claude/def.ts:175](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/claude/def.ts#L175), `driver.ts`, `session.ts`, `persistent.ts`; T `src/core/engines/claude.ts:36–170`.                                                                               | **OBSERVED:** A driver reaches session/transcript/grant/host infrastructure; T parser reaches `cli`, shared types/lang. **DECLARED:** A native subtask comments cite Claude 2.1.303. **UNVERIFIED:** closure / equivalence to locally reviewed 2.1.178.                                             | **INFERRED: WRAP**, future structured adapter only after per-version audit; A/T license eligible, native input grant is valid but does not prove structured protocol. No copy yet; §§1/4/6 unchanged.                                                                                                | **INFERRED:** medium/high; test partial results, permissions, native-auth sharing, canceled/queued delivery, malformed streams. Rollback: remove optional adapter, keep interactive path and unknown structured capability.                                                               |
| 5 Native PTY and independent process service   | **OBSERVED:** `terminal/{supervisor,pty-host,pty-backend,native-broker,managed-pair}.ts`; `tests/terminal-supervisor.test.ts`, `tests/managed-terminal-pair.test.ts`; node-pty 1.1.0 and signed operations.                                                                   | **OBSERVED:** A `agentHost/socketServer.ts:56–66,381`, `hostClient.ts`, [agent-host.md:69–87](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md#L69-L87).                                                                                                                             | **OBSERVED:** Unix socket + eventLog/protocol/release/lineSplitter, separate service and disk logs. **DECLARED:** host supports relay reconnection; local socket uses OS permissions only (doc:179). **UNVERIFIED:** complete closure/platform acceptance.                                          | **INFERRED: KEEP-EXISTING.** A new host/log writer duplicates current ownership/storage and weakens signed authority if copied whole. Not a ban on PTY/process isolation. A license eligible, §§4/6 require current one-writer/native authority composition.                                         | **INFERRED:** high; crash, reconnect, split Core/Desktop shutdown, descendant identity and privacy tests before any host replacement. Rollback: no import/service installed; current host remains.                                                                                        |
| 6 External-session checkpoints and recovery    | **OBSERVED:** `packages/adapters/codex/src/index.ts:125–214`, `tests/observer.test.ts`; source offsets/hash/anchor, oversized-line skip, budgets and read-only inputs.                                                                                                        | **OBSERVED:** A [BufferLineSplitter:55–95](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/lineSplitter.ts#L55-L95); `streams/codexHistory.ts` replays stored turns into events.                                                                                                   | **OBSERVED:** splitter has zero imports, Buffer runtime only, no own cap; history mapper imports relay-note/room-card/event mapping. **UNVERIFIED:** full history-mapper closure.                                                                                                                   | **INFERRED: KEEP-EXISTING.** Unbounded splitter alone is a regression for ingestion; reconstructed notifications are not source-backed observer events. A license eligible but §§1/4/6 plus provenance/checkpoints stay intact.                                                                      | **INFERRED:** no replacement; retain truncation/rotation/partial/oversized/symlink/replay tests. Rollback: none, reader untouched.                                                                                                                                                        |
| 7 Fragmented managed RPC line copies           | **OBSERVED:** baseline `managed-codex/channel.ts:194–206` concatenates every partial fragment; new `tests/codex-line-splitter.test.ts` checks concat bytes and integration limits.                                                                                            | **OBSERVED:** A [BufferLineSplitter:55–95](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/lineSplitter.ts#L55-L95), fragment list and one concat at newline.                                                                                                                      | **OBSERVED:** complete closure = zero imports/packages, Node Buffer only; adapted strict TS, Node 24 ESM/CJS build in private Node host, never renderer. No storage/transport addition.                                                                                                             | **OBSERVED: ADAPT**, incorporated as `managed-codex/line-splitter.ts`, preserving byte/chunk/session caps, fatal UTF-8 and correlation in caller. Apache-2.0 compatible with provenance/modification notice in source and root NOTICE. §§1/4/6 unchanged; no execution authority added.              | **INFERRED:** small; fragmentation/copy count/cap/reused buffer/invalid UTF-8/loss/order tests. Rollback: revert this increment to original framer; zero data/schema impact. See implementation record below.                                                                             |
| 8 Managed durable recovery / uncertain effects | **OBSERVED:** `packages/database/src/terminal-journal.ts`, `managed-codex/lifecycle-receipt.ts`, `tests/terminal-journal.test.ts`, `tests/codex-lifecycle-receipt.test.ts`; journal fencing, uncertain reservations.                                                          | **OBSERVED:** A `agentHost/hostClient.ts` replay/dedupe; `streams/codexHistory.ts:39` `codexTurnsToEvents`. **DECLARED:** A `docs/agent-host.md:83–87` logs can be shorter after crash.                                                                                                                                                | **OBSERVED:** disk log/protocol/event shape and relay-specific state; no direct equivalence to ORQST journal/receipts. **UNVERIFIED:** full closure and process identity across reboot.                                                                                                             | **INFERRED: KEEP-EXISTING.** Reconnect dedupe is not ownership reconciliation; never auto-resubmit uncertain effects or resume external sessions. A license eligible, §§1/4/6 preserve private writer and authorized recovery.                                                                       | **INFERRED:** high if changed; crash/reboot/duplicate/expired receipt tests. Rollback: no import; retain journals, never erase reservations or migration state.                                                                                                                           |
| 9 Subscription windows / consumption           | **OBSERVED:** `packages/database/src/analytics.ts`, adapter cumulative token handling and `tests/analytics.test.ts`; retained metrics are qualified.                                                                                                                          | **DECLARED:** A [plan-usage.md](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/plan-usage.md) documents Claude probe consumption, Codex account/rate-limit RPC and auth-file/keyring limitation. **OBSERVED:** T `src/core/usage.ts:26–30` calls countedTokens and defaults absent cost to zero. | **OBSERVED:** A live provider/session/plan-usage infrastructure; T Db + countedTokens/shared types. **UNVERIFIED:** full closure/native billing semantics.                                                                                                                                          | **INFERRED: REJECT** automatic Claude probe and auth-file login heuristic; **KEEP-EXISTING** canonical accounting. Read-only authorized native rate-limit RPC may be wrapped later. A/T eligible licenses do not prove no-cost access; §§1/6 prohibit surprise calls/credential exposure.            | **INFERRED:** medium future read wrapper; test unavailable, stale, keyring, no API-key fallback, shared account ambiguity. Rollback: remove wrapper, retain unknown limits; never fabricate zero usage/cost.                                                                              |
| 10 Team selection, identified panes and queue  | **OBSERVED:** `communication/service.ts:67`, `tests/pane-communication.test.ts`, `terminal/mcp-task.ts`, `tests/interactive-mcp.test.ts`; durable scoped queue with separate acceptance/start/result.                                                                         | **OBSERVED:** T [router.ts:73–94](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts#L73-L94) `parseRoute`/`route`; `runs.ts:123–124,406–417` Runner/in-memory queue; `gateway.ts`. O functional panes only.                                                                           | **OBSERVED:** T Runner imports engines, Db, policy, gateway, context, memory, browser/computer/connectors; wide closure. **UNVERIFIED:** full dependency licenses and O implementation.                                                                                                             | **INFERRED: KEEP-EXISTING** queue/identities; **REJECT** O copy without source/license. T routing is a model decision, not observed delegation evidence. Authorized explicit delegation remains legitimate under §§1/4/6.                                                                            | **INFERRED:** high for T extraction; accept idempotency, closed/busy target, forged actor, uncertainty and return correlation tests. Rollback: existing durable queue remains, no deletion/reset or new service.                                                                          |
| 11 Tucano Codex turn runner / SQLite           | **OBSERVED:** ORQST structured runtime and `packages/database/src/index.ts` single SQLite owner; observer provenance retained.                                                                                                                                                | **OBSERVED:** T [engines/codex.ts:85–116](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/codex.ts#L85-L116) `codexArgs` uses ephemeral exec; `src/core/db.ts:1,242–243` DatabaseSync/WAL.                                                                                            | **OBSERVED:** codex module imports fs/os/path, smol-toml, Claude gateway constant, CLI parser, shared language/types. Db references shared schema/types. **UNVERIFIED:** closed dependency license audit.                                                                                           | **INFERRED: KEEP-EXISTING.** Ephemeral exec is valid for authorized disposable turns, but lacks this app-server's persistent bidirectional task channel; different conversations/receipts schema must not replace source events. T license eligible; §§1/4/6 retain observer isolation and writer.   | **INFERRED:** high; receipt/lifecycle/partial-response/native-auth tests required for alternative driver. Rollback: no import, no new database/migration.                                                                                                                                 |
| 12 OpenCode remains a separate audit           | **OBSERVED:** `terminal/opencode-{profile,launch-plan}.ts`, `tests/opencode-profile.test.ts`, `tests/opencode-launch-plan.test.ts` and [standalone review](../development/opencode-standalone-review.md); explicit startup/migration acknowledgment, reviewed 2.2.5 identity. | **OBSERVED:** T [engines/opencode.ts:17–23,138](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/opencode.ts#L17-L23), `opencodeHome` / `opencodeEngine`; imports `opencode-v2`.                                                                                                       | **OBSERVED:** fs/os/path, Claude gateway name, cli parser, opencode-v2 and shared types/lang; creates XDG directories and links native auth.json. **UNVERIFIED:** full V2 dependency/license closure and compatibility with reviewed 2.2.5 native storage.                                          | **INFERRED: KEEP-EXISTING.** T license eligible but auth-file linking and a different version-dispatch path do not establish ORQST's reviewed shared-database identity/migration/lifetime contract. No code imported; §§1/4/6 retain explicit managed authorization and native credential ownership. | **INFERRED:** medium/high dedicated audit; test native identity selectors, SQLite migration effects, service isolation, startup activity and descendant lifetime before authorized execution. Rollback: no import/startup; leave native database and existing blocked review path intact. |

## Component risks and compatibility details

**1 — detection.** Upstream resolution returns a bare command when a PATH entry is
executable; a later PATH lookup is not ORQST's immutable binary/hash review. Timeout
and capability declarations must not become proof of login, model access or successful
launch. A's Node `>=20.12` ESM syntax is plausible on Node 24 (**INFERRED**), not an
installed-CLI acceptance result. Storage: none needed; transport: a new subprocess
probe only if explicitly authorized. Update burden: check provider output formats and
executable policy at every pin. Passive ORQST discovery stays the fallback.

**2 — catalog/auth.** The selected probes directly depend on `buildChildEnv`,
`EXTRA_PATH_DIRS`, `resolveAgentBin` and runtime-def parsers; copying one function is
not a closed component. A's relay manifest lists node-pty/ws/smol-toml/gpt-tokenizer,
but that is not a claim that each probe requires all four. Full transitive closure,
including side effects on import, is **UNVERIFIED** and blocks source incorporation.
Node-only managed host, not Electron renderer; reuse current private transport and
storage if later wrapped. Preserve native credential ownership; never expose email,
account IDs or provider errors in receipts. Update burden: native version/schema and
keyring handling. Auth unavailable stays unknown; do not silently perform login.

**3 — Codex.** The driver reaches plan usage and history/session state; wholesale
reuse is not an isolated parser import. Upstream's 0.154.0 protocol declaration is
not evidence for ORQST's reviewed 0.162.1 binary. No installed CLI is executed or
inspected for acceptance here; existing version pins are source observations only.
The local channel allows four request methods and distinct time budgets, while a
broad upstream connection would increase privileged surface. Any future wrap belongs
in the private Core/Node host, not protocol or dashboard. Retain current SQLite and
RPC transport. Update burden: generated protocol, permissions, native lifecycle and
unknown-effect recovery per CLI release.

**4 — Claude.** The structured candidate is coupled to transcript reading/forking,
grant rules, MCP setup and plan usage; importing it can write provider-owned history
rather than merely normalize events. This is a concrete integration risk, not a ban
on authorized managed history. No native transcript writes or driver imports occur.
A and T have different execution/context strategies and cannot establish one another's
capabilities. No new dependency, storage or listener is accepted; a future managed
adapter must audit those closures and preserve the existing authority boundary.
Update burden: permission/control protocol, stream fields and version-scoped delivery.

**5 — process host.** The Unix socket's private permissions are useful evidence of a
same-user boundary, but not equivalent to ORQST's native signed grants. A's host writes
its own event logs/cursors. Adding it wholesale would create a second owner and
parallel persistence, even though service/UI separation is a valid architecture.
Node 24 and node-pty 1.1.0 overlap at the manifest level; Tauri mobile/web UI does not
establish Electron native-process compatibility. Linux/macOS/Windows behavior remains
**UNVERIFIED** in ORQST. Update burden: OS lifecycle, socket protocol, log retention and
permissions. No new host is installed or started; no process-survival promise is made.

**6 — observer reader.** Current source records include offsets, line numbers and
hashes, with checkpoint commits only after complete lines. A's splitter exposes
positions but has no oversized-line discard/budget policy; its history mapping emits
reconstructed start/completion notifications. Neither is a substitute for observed
source evidence. Keep the source reader and all its security/recovery tests. This
change does not affect ingestion, so real-source `validate:local` is not required or
run; no captured session is read or published. Update burden: none for an unimported
candidate; reassess both recovery and provenance before revisiting.

**7 — actual reuse.** The audited closure is the `BufferLineSplitter` class only,
lines 55–95 of A's `relay/src/agentHost/lineSplitter.ts`; `StringLineSplitter`,
`PositionedLine`, source tests, source schemas, host code and assets are not copied.
The selected source has no imports, generated bindings or additional notices.
**OBSERVED:** inspection of the complete source blob identified by SHA-256 above
finds only framing comments at its start, no copyright/license header to omit; the
root LICENSE grant and the original framing comment within the copied fragment are retained.
Its Buffer operations already exist in the Node 24 host. No new dependency/lockfile,
SQLite owner/schema, listener, transport, remote logging, credential read or provider
call is introduced. Apache-2.0 is the same project license; retain root LICENSE,
source provenance/change notice and root NOTICE attribution. No trademark rights
or broad dependency clearance is claimed.

The adaptation keeps the upstream fragment-array/indexOf/subarray/concat-at-newline
code and copies unfinished fragments so callers may reuse buffers. Complete yielded lines may alias the input chunk;
consumers retaining a yielded line must copy it. The channel consumes each line
synchronously from its own copied chunk. It replaces file
positions and replacement-character decoding with lazy raw-byte lines, checks the
current line budget before retaining a piece, exposes pending length for diagnostics
and adds explicit clear. CodexChannel still owns the 256 KiB chunk/line and 8 MiB
session limits, fatal UTF-8, validated messages, RPC correlation, failure reasons and
no-signal behavior. Lazy emission preserves delivery of an earlier valid line before
a later line exceeds its limit. The source reader is untouched.

**OBSERVED:** `tests/codex-line-splitter.test.ts` verifies one concat of exactly the
completed line's bytes for 32 KiB of one-byte fragments, rather than repeated prefix
concatenation. The Buffer.concat counter is scoped to this synchronous test via the test mock
context; it is not global runtime instrumentation. This is a deterministic copy-work
assertion, not a provider latency,
throughput or memory benchmark. Fragment arrays add per-fragment object overhead;
the retained fragment count is bounded by the existing line byte cap, not a claim of
lower peak memory. Actual native performance remains **UNVERIFIED**. The baseline witness at
`fe004d6` counted 538,002,003 bytes cumulatively across concat inputs before newline;
this is repeated copy work, **not simultaneous memory usage**. The adapted test sees
zero concat bytes before newline and one complete-line concat afterward. It does not
measure Buffer.from copies, allocator overhead, throughput or provider performance.
The generator must be drained synchronously without overlapping push/reset calls.
Line budget excludes the newline; chunk budget includes every byte (and can include
multiple lines), preserving the pre-existing asymmetry at the exact limit. Update burden:
small manual diff of this single source class at a new pin; do not replace local
bounds with a newer upstream wholesale. There is no runtime upstream install/import,
so a missing clone or network leaves the bundled app usable. Malformed input fails
the optional managed channel closed; the observer never imports this component.

**8 — recovery.** A cursor sequence proves replay progress, not process ownership or
whether a task's external effect occurred. Keep ORQST's journal fencing, capacity
reservation and durable receipt semantics; do not use PID/inactivity as ownership
proof or auto-replay a lost task. Same SQLite writer, no adoption/signals/reset.
Future resume requires provider support and scoped authorization. Update burden:
crash, reboot, partial writes and versions of both host and native protocol.

**9 — usage.** The upstream doc declares that a minimal Claude turn consumes tokens
and can open a new usage window; it also records the Codex auth-file/keyring blind
spot and unmeasured paid limits. Those are concrete reasons not to adopt automatic
probing or treat absent auth.json as signed out. A source's assertion of free RPC is
**DECLARED**, not proof that ORQST can start that provider without other effects.
An explicitly authorized read through an existing owned native connection remains a
possible next wrapper. Preserve cumulative accounting, cached-input subset semantics,
missing values and coverage; do not replace totals with T's weighted receipts or
missing-cost zero. No provider/credential endpoint or storage is added. Update burden:
quota schemas, plan/window meanings and versions; no scraping private billing APIs.

**10 — collaboration.** T's model routing plus process-local work queue has different
acceptance/durability semantics from ORQST's SQLite idempotency and correlated result
inbox. Full Runner closure spans unrelated connectors, browser/computer APIs and
memory; not cleared for import by a root license check. O's visible features establish
functional reference only, not queue ordering, busy-agent delivery or source license.
Keep current IDs/grants and separate queued/accepted/processing/completed/failed/
closed/uncertain evidence. No sender prompt injection into external sessions. Native
MCP delegation through valid task grants is allowed; tests remain synthetic. Update
burden: actor binding, busy/closed queues, dedupe and native return transport.

**11 — Tucano runner/storage.** T's Node SQLite choice is compatible in principle,
but migration/table ownership models conversations rather than ORQST source events.
Its code imports Node APIs plus application-specific shared types. Codex execution
also reaches `smol-toml`, `cli`, Claude's gateway constant and language/types; those
transitive licenses and side effects are not cleared. Upstream's TS 7/Electron 44/
electron-vite toolchain is not an instruction to upgrade ORQST's TS 6/Electron 45/
esbuild/pnpm environment. No database or driver is replaced. Update burden: native
CLI args, shared types, migrations and receipt meanings.

**12 — OpenCode.** T's source creates private XDG directories but symlinks an existing
auth file, reads provider configuration and selects a V2 runner by version. The V2
closure is not audited here. That is not proof of separated credentials/sessions for
the reviewed local native database, nor of migration rollback or safe descendant
cleanup. Keep the [separate OpenCode review](../development/opencode-standalone-review.md)
and explicit acknowledgment gates. No auth file/config/database is read or linked
by this increment. Node-only execution, no renderer/observer capability; use the same
Store if a later adapter is authorized. Update burden: storage identity/migrations,
startup side effects and version-specific protocol, independently of Codex/Claude.

### Explicitly rejected relay exposure

**DECLARED:** A [README:115–117](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/README.md#L115-L117)
documents no relay authentication, open CORS and bypass-permission defaults.
**INFERRED: REJECT** that deployment/control surface for ORQST: network reachability
would confer execution authority without ORQST's native grants. This concrete finding
does not disqualify isolated pure code or an authenticated, authorized local wrapper.
No relay/HTTP route or remote binding is imported. Overclock remains **REJECT** for
copying until source/commit/compatible grant/NOTICE are available, not because panes
or authorized task delivery are disallowed.

## Implementation, acceptance and rollback

Effectively incorporated: only the A `BufferLineSplitter` fragment-buffering code,
adapted in `packages/core/src/managed-codex/line-splitter.ts`, integrated through
`channel.ts`. The original source hash/pin above and modification header identify
what must be diffed during an update. New tests are ORQST synthetic tests, not copied
upstream tests. Existing channel APIs and all ownership/authorization gates remain.
No external network/code installation is needed by the module. No dynamic plugin
fallback is introduced: recovery is fail-closed channel behavior or reverting the
increment to the original self-contained parser.

Rollback procedure for an integrated commit: `git revert <reuse-increment-commit>`,
then `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Before integration,
discard only this isolated branch/worktree after preserving the commit if desired.
Do not reset another contributor's worktree. The increment has one isolated module,
one caller and provenance/docs/tests; no data migration or deletion. The previous
framer and private Node build remain the fallback at the parent commit. Never use
rollback to erase journals, reclaim uncertain reservations, signal a provider or
restart the owner's service.

The A/B creation/retry work is separate and not modified by this increment. No
native-modal, real two-provider A-to-B-to-A, busy-agent queue, reconnection or N-agent
acceptance is claimed. Existing repository docs describe a previously failed native
structured attempt; synthetic success here does not resolve it. Recommended next
candidate: a narrow explicitly requested Codex model/rate-limit response wrapper
only after full dependency extraction audit, installed-protocol evidence, privacy
schema and a separately authorized native check. Do not import Anywh's host/driver
just to demonstrate reuse.

### Reproduce the static audit without running upstream code

Use disposable directories outside the checkout. These commands fetch Git objects
and print text only; do not run upstream hooks, package installs, scripts or tests.

```sh
git clone --bare https://github.com/anywh-sh/anywh.git anywh.git
git clone --bare https://github.com/eduwxyz/tucano.git tucano.git
git --git-dir=anywh.git show 546f189c04415c3c5af5f40e3931a0a90b9aba31:LICENSE
git --git-dir=tucano.git show 0501956d127699300209902e889f3e69a0948766:LICENSE
git --git-dir=anywh.git ls-tree -r --name-only 546f189c04415c3c5af5f40e3931a0a90b9aba31
git --git-dir=tucano.git ls-tree -r --name-only 0501956d127699300209902e889f3e69a0948766
git --git-dir=anywh.git show 546f189c04415c3c5af5f40e3931a0a90b9aba31:relay/package.json
git --git-dir=tucano.git show 0501956d127699300209902e889f3e69a0948766:package.json
git --git-dir=anywh.git show 546f189c04415c3c5af5f40e3931a0a90b9aba31:relay/src/agentHost/lineSplitter.ts
```

Inspect each tracked path for LICENSE/NOTICE/COPYING, attribution headers, imports,
side effects and generated-code provenance; use the pinned links in each row for
exact files. Hash LICENSE and selected source bytes with SHA-256 and compare with
the ledger. Missing package SPDX must be reported, not silently filled in.
A/T scripts were inspected as text only. A relay declares build/test commands using
tsc/tsx and optional SEA tooling; T includes packaging/install/release shell scripts.
None was run. No complete dependency SBOM or clearance of either entire app is claimed.

### Validation of the isolated increment

Executed with Node 24.22.2 / pnpm 10.34.9:

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: passed. Build produced ignored local
  artifacts only; no application/service was restarted and no native provider ran.
- `pnpm exec tsx --test tests/codex-line-splitter.test.ts tests/codex-structured-runtime.test.ts`:
  67 passed. Independent critical-path review also approved the adaptation.
- `pnpm test:browser tests/browser/dashboard.spec.ts` on a separate disposable
  loopback fixture port: 4 Chromium tests passed. Full browser/native Desktop
  acceptance was not run; this increment changes no UI source.
- Rollback check: temporarily restored the original `fe004d6` channel in the isolated
  worktree, ran `tests/codex-structured-runtime.test.ts` (63 passed), then restored
  the adaptation. The new copy-work test failed against that original channel as
  expected, demonstrating the concrete repeated-concat difference.
- Initial worktree bootstrap lacked workspace dependency links and caused module
  resolution failures; repaired local links without a manifest/lockfile change.
  A subsequent default-concurrency `pnpm test` had Analytics HTTP/worker deadline
  failures and a startup-counter timing failure. It was terminated after failures
  and stalled completion (487 passed, 7 failed, 1 cancelled, including the source-guard
  file cancellation). Their cause is unresolved; this run is not reported as
  green and is not attributed to the framer. The unchanged full suite was repeated with
  `pnpm exec tsx --test --test-concurrency=1 tests/*.test.ts`: **502 passed, zero
  failures/cancellations/skips**. Scheduling alone changed; assertions, deadlines
  and test files were not weakened.

Ingestion was not changed: `validate:local`/`validate:live` were not run. No provider
login/model probe, token-consuming test, real A/B task, installed service restart,
credential/history read, source mutation or upstream executable/test was performed.
Packaged-release inclusion of LICENSE/NOTICE must be preserved when distribution is
implemented; successful checkout builds alone are not distribution acceptance.

### Integration after native pair creation — 2026-11-03

Source delivery `71402366f2a57d9095f217a2a964fafc3a939c76` was applied after
Create A/B `5ee2b967651d30a4337a45ea383076528138fd92`. Both changelog entries
were retained; no pair-creation, broker, router, client or acceptance assertion was
changed. The recovery guide now recognizes the owner's direct authorization for
audited compatible reuse and links to this audit and ADR-035. Repository instruction
files and the historical Tucano audit remain unchanged.

Pinned Anywh/Tucano LICENSE hashes, the Anywh source hash and absence of tracked
NOTICE files were rechecked against the separate Git object stores. The existing
QA528 closure approved the splitter adaptation and recorded 506/506 passing pair
baseline unit cases; it explicitly left full PTY acceptance **NOT APPROVED** with
attach/Stop flakes open. That is historical review evidence, not a new PTY run.

Current integrated validation with Node 24.22.2 / pnpm 10.34.9:

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: passed; the existing Vite chunk-size
  advisory remains.
- `pnpm exec tsx --test --test-concurrency=1 tests/*.test.ts`: 510 passed, zero
  failures, cancellations or skips. Sequential scheduling was selected in view of
  the earlier concurrent-run failures above; no assertion or timeout was changed.
- `pnpm test:browser tests/browser/dashboard.spec.ts`: four Chromium tests passed
  on disposable loopback port 53666 with output outside the checkout.

Default-concurrency tests, full Chromium, native Desktop/PTY acceptance and
`validate:local`/`validate:live` were not rerun. Ingestion is unchanged. No real
provider, inference, login/model probe, installed service restart or user-data
migration was performed. PTY stability, real A-to-B processing/return and native
provider acceptance remain open.

### Native CLI environment follow-up — 2026-11-03

The [pinned runtime comparison](native-cli-runtime-comparison.md) re-inspects
executable resolution, child environments/authentication, PTY versus pipe transport,
UI, lifecycle and per-CLI compatibility. It explicitly inspects Tucano's OpenCode V2
path, whose data-directory credential reuse differs from the V1 auth-file linking
described above; neither source path was executed/imported. A single local passive
PATH policy is now wired into discovery and newly reviewed Desktop manifest child
environments. No additional upstream source is incorporated; the attributed Anywh
framer remains the actual reused component. Provider gates and the unvalidated
real A-to-B-to-A milestone are preserved.
