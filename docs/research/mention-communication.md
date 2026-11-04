# Managed mention communication increment — 2026-11-04

## Baseline and retained mechanisms

Isolated worktree `/private/tmp/orqst-mention-permissions-680`, branch
`feat/mention-permissions-680`, baseline `368bbc1`. Inspection preceded edits:
`AGENTS.md`, README, the preserved implementation plan/Tucano audit, the owner master
specification and the existing protocol, Store journal, `PaneCommunication`,
`CodexCommunicationAdapter`, `CodexStructuredRuntime`, `authorizedDelegation`,
`DesktopManagedAgents`, isolated native document/preload/main/Node-host IPC and tests.

The checked manifests require Node >=24 <25 and pnpm 10.x; verification uses Node
24.22.2/pnpm 10.34.9. Existing strict TypeScript 6, React 19/i18next, Electron 45,
Tauri 2 preview, node:sqlite and the original package/dependency boundaries remain.
No dependency, lockfile, observer source reader, generic server or process manager
is added/replaced. Worktree dependency links point workspace packages to this
checkout; third-party installed packages are reused without running install scripts.

## Pinned component research and decisions

Research uses separate Git object stores `/private/tmp/orqst-audit-tucano-665` and
`/private/tmp/orqst-audit-anywh-665`; upstream executables/installers/tests were never
run. The historical audit remains unchanged. These pins were re-read for this use.

| Candidate                          | Source and exact responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Decision, dependencies and contract/security difference                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit mention extraction        | [Tucano `0501956d127699300209902e889f3e69a0948766`, `src/core/context.ts:303`, `mentioned`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/context.ts#L303), and [`src/shared/types.ts`, `CODE_SPANS`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/shared/types.ts#L461)                                                                                                                                                                                                                                                                                             | **ADAPT** this pure string/RegExp/array fragment only into `packages/core/src/communication/mentions.ts`. Remove application-specific `Agent` dependencies, return normalized handles, strengthen email/Unicode boundaries and retain unknown/oversized references for rejection rather than silently selecting a known subset. Preserve upstream fenced/inline-code exclusion, case normalization and first-occurrence deduplication. No runtime dependency/import from upstream.                        |
| Queue and automatic agent chaining | [Same Tucano pin, `src/core/runs.ts`, `Runner.send`, `enqueue`, `execute`, `chain`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/runs.ts#L1389), plus [`context.ts`, `systemPrompt`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/context.ts)                                                                                                                                                                                                                                                                                                                  | **KEEP EXISTING ORQST**. Tucano's process-local conversation queue and `chain` execute model-output mentions, bounded by reply depth. Its closure imports DB, engines, memory, connectors, language and broader gateway behavior. ORQST already has durable task/message/attempt IDs, actor-scoped grants, per-target FIFO, hash-scoped payload/result resolver and correlated evidence. Automatic prose chaining would bypass the exact-task consent boundary. Roles/mentions do not grant capabilities. |
| Model-selected speakers            | [Same Tucano pin, `src/core/router.ts`, `route`, `parseRoute`, `routerPrompt`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **DO NOT USE** for this explicit-routing increment. Requires an engine inference plus shared Agent/Connector/Message/language contracts. `parseRoute` tolerates surrounding text and filters known handles. Explicit destination selection must fail on unknown/multiple targets, incur no router inference and never fall back to another provider.                                                                                                                                                      |
| Native Codex ownership/lifecycle   | [Anywh `546f189c04415c3c5af5f40e3931a0a90b9aba31`, `relay/src/runtimes/defs/codexDriver.ts`, `CodexSessionDriver`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/codexDriver.ts), [`docs/architecture.md`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md), [`docs/agent-host.md`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md), [`relay/src/runtimes/README.md`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md) | **KEEP EXISTING ORQST**. Driver imports daemon/history/session/plan-usage contracts and distinguishes turn acceptance from later completion, as ORQST already does. Host service/log ownership and resume/reconnect authority differ from ORQST's native-signed per-instance journals and uncertainty fencing. No second host/session manager is needed. Existing attributed Anywh byte framer and Tauri integrations remain intact.                                                                      |
| Panes and visual communication     | [Overclock official product reference](https://overclock.sh)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **FUNCTIONAL REFERENCE ONLY**, no source/assets copied. Exact public source SHA and compatible source/NOTICE grant were not established; no licensing inference from running the product. ORQST identity and the existing native-client flow are preserved.                                                                                                                                                                                                                                               |

### License and extracted closure

Tucano root [LICENSE at the exact pin](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE)
and `package.json` identify Apache-2.0, matching ORQST. The tracked pinned tree has
no NOTICE/COPYING or nested license file. Selected source has framing comments and
no separate copyright header to omit. Retain root LICENSE, add the exact fragment,
SHA and modification notice in source and root NOTICE. No assets/trademark rights,
complete Runner dependency clearance or entire-app license clearance is claimed.

Verified SHA-256 of exact upstream blobs:

- `LICENSE`: `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.
- `src/core/context.ts`: `766e6fc49776917d4a891ee0b46ae0683196886b3db471b1ab85127edd2a6c15`.
- `src/shared/types.ts`: `3183da7622c853cba4209656e3df6d8eead4c4e342f770ca5216daa5bd4a9295`.

Only `mentioned`/`CODE_SPANS` logic is adapted; upstream imports, shared application
types and tests are not copied. Node 24 natively supports the selected standard JS
features; no transitive package installation, generated code or new dependency
license is introduced. A network/upstream outage does not affect the bundled parser.
Future changes require re-diffing these exact fragments and rerunning parser,
permission/recovery and native-return tests; do not import the Runner wholesale.

## Implementation and evidence boundary

New managed pane metadata binds unique handle, descriptive role and directed
permission targets to the existing UUID/runtime identity. New Desktop routes start
empty. Trusted edits are atomic in the existing journal and audited; grants,
admission and dispatch all check the matrix. Duplicate handles, foreign/external
panes, duplicate/self edges and transitive cycles are refused. Roles are neither
permissions nor an automatic choice of source.

The existing managed-client document now edits identity/routes, chooses either
source and offers permitted mention suggestions. Core resolves one explicit handle
from submitted task text to a UUID, signs/reviews the exact task, then reuses the
existing dynamic tool, SQLite queue, adapter, provider events and scoped tool result
back into the source CLI. Task bytes are preserved. Captured output is never parsed
for delegation. There is no `PTY.write` delivery/completion shortcut or fake receipt.
The message trail retains separate accepted/running/completed/unknown evidence.

Routing reviews bind before/after identity and policy to one-use native challenges.
A revision change invalidates stale reviews and prepared tasks. Active/unknown root
work blocks edits. The existing 4 KiB native review limit, focused authenticated
sender, activation, Cancel-default modal, expiry and signature checks remain.
No HTTP, WebSocket, cookie, origin/CSP or observer control authority changes; see
[the security review](../architecture/security-model.md#managed-mention-routing-review--2026-11-04).

Metadata persists in existing version-1 JSON rows; legacy missing routing parses as
null and retains its original exact-task grants. Restoring metadata creates no live
grants/adapters or process ownership. The Desktop still requires fresh slots after
restart; no journal deletion, retry, PID adoption, native session rewrite or resident
service/Desktop restart was performed. Payload bodies remain private memory with
hash references in the durable journal; no body persistence or content retention
claim is added.

The current executable path remains exactly two Codex structured instances in the
Electron client. Interactive 1–8 PTY teams and the Tauri observer preview are separate.
N-member UI, mixed-provider communication, automatic chains/planning, native provider
approvals, runtime reconnection and hard token/spend containment remain unimplemented.
Real installed-provider inference, login/model entitlement and human native-modal
acceptance are not validated by synthetic processes/Chromium.

## Reproduction and rollback

Use the project's Node 24/pnpm 10 toolchain, without restarting a resident app:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm accept:managed-agents --authorize-synthetic-agents
```

The explicit last command compiles a fixed synthetic C CLI and creates private
manifests/journals/Node hosts under a disposable directory. Chromium loads the actual
native document and built client, with a trusted test signer replacing native dialogs.
It checks deny-by-default routing, UI role/permission edit, autocomplete preservation,
A-to-B-to-A native structured transport, correlated rendering, confirmed owned exits
and signed retirement. It does not run an installed provider or read credentials.
Independent fixture watchdogs bound orphan lifetime even on a failed test.

Rollback the isolated commit with `git revert <commit>` and repeat relevant checks.
Do not reset/delete journals, reclaim uncertain reservations or restart existing
processes to roll back. No public listener, observer migration or provider dependency
needs uninstalling. Additive routing metadata remains inert with no restored grants;
any release rollback against these private journals needs explicit compatibility
review, since old strict protocol validators predate the metadata field.

## Current verification

Executed in the isolated worktree with Node 24.22.2/pnpm 10.34.9:

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: passed. The existing Vite >500 KiB
  chunk advisory remains; dependencies/budgets were not altered to suppress it.
- `pnpm test`: 582 passed, zero failures/cancellations/skips. An earlier full run
  also passed 582; the final repeat includes stronger Unicode/email parser boundaries.
  New coverage includes handle collision/rename/recovery, explicit matrix denial at
  grant/admission/dispatch, self/direct/transitive cycles, foreign/external targets,
  quoted/unknown/multiple handles, signed stale reviews and reverse B-to-A-to-B return.
- `pnpm accept:managed-agents --authorize-synthetic-agents`: passed with actual
  private Node hosts, compiled synthetic native CLI processes and Chromium running
  the shipped document/client. Verified denied initial route, signed identity/role/
  permission change, completion of an empty-prefix `@` without losing prior text,
  correlated source/worker result rendering, owned native exits and signed retirement.
  The ordinary task plan stayed within the existing 4 KiB native review bound.
- `ORQST_BROWSER_PORT=54780 pnpm test:browser tests/browser/managed-agents-open.spec.ts
--output=/private/tmp/orqst-680-browser-results`: 2 Chromium tests passed. Existing
  focus-refusal/legacy-preload checks remain; the synthetic state regression now uses
  the actual extracted document instead of a divergent hand-written DOM fixture.
- `pnpm test:desktop`: passed in a separate disposable Electron 45.2.1 application
  (macOS arm64, Chromium 156). Real preload/IPC opener/start focus refusal, the empty
  managed document, isolation, hide/reopen and lifecycle behavior passed. Provider
  execution and active native modal consent were not exercised. Export dialogs and
  clipboard delivery in that existing smoke remain intercepted/unconfirmed as labeled.
- `git diff --check`: passed. No generated output, logs, credentials or temporary
  evidence is included in the commit.

Earlier failed checks: lint caught two unnecessary escapes in a new test and they
were removed; the first extended Chromium/native attempt stopped before inference
because tsx's `__name` helper was unavailable inside a serialized page function.
The fixture injection now uses a fixed test-only script. The first focal Playwright
attempt needed Node 24's explicit JSON import attribute in the new locale import;
that import was corrected. Final commands above passed with the shipped authority,
assertions, timeouts and failure semantics intact. No failure was relabeled as a pass.

Not run: the full Chromium suite, Tauri/Rust build/package checks, `validate:local`/
`validate:live`, installed-provider inference/login/model tests and human active
native-modal acceptance. Ingestion and the Tauri shell are unchanged. The real
multiagent installed-provider milestone remains open; synthetic native success does
not resolve the previously documented provider startup/acceptance gap.
