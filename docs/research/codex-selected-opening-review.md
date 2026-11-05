# Codex selected opening: integration review

Source baseline: `f8db3dd4e631731e4b95d40b29f249918476725b`, reviewed on
2026-11-04. The owner identifies `dist/native-preview-mcp-unavailable/ORQST Preview.app`
as the new package. This review did not inspect, operate or replace that package,
start a Core/PTY/provider, read authentication storage, or touch an existing attempt.
The historical failure after confirmation remains unexplained. The existing
[preparation diagnostics](terminal-preparation-diagnostics.md) are instrumentation,
not a correction of its cause; review-time source drift is only a synthetic case.

## Selected flow and bindings

The normal `create-selected` route differs from advanced `create`: it uses the
registered workspace, permits its existing files, selects an opaque model ID and
does not ask for an empty substitute project. The approved V6 hierarchy remains
Workspace → Feature → TerminalPane → AgentSession.

| Boundary                          | Actual source and invariant                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalogue and selection           | `terminal-catalog.ts::terminalPreparationCatalog` resolves the trusted workspace/Feature and hashes its fence, Feature revision and provider/model evidence. `prepareTauriTerminals` selects one reviewed executable and the exact model evidence by ID.                                                                                                                                        |
| Plan and review                   | `terminal-creation.ts::prepareTerminalCreation` binds the selected provider and Node hashes, canonical project, native identity, tool PATH, model evidence and preparation fence. Selected Codex uses version `0.162.1`, SHA-256 `[historical CLI binary SHA-256 removed]`, native authentication reuse and MCP disabled for independent opening.                                               |
| Revalidation and commit           | `prepareTauriTerminals` recomputes the catalogue after native review, before `ports.commit`. `plan.provision` rechecks directories, binaries, PATH identities, model evidence, Feature fence and expiry before staging/publication. Unknown/changed evidence is refused; no fallback executable or model is selected.                                                                           |
| Inspection and Feature assignment | Provision validates staged configurations, publishes them together and reads the final manifests. `inspectManagedTerminalFiles` rejects blocked/overlapping states and duplicate identities. Feature assignment adds the new terminal UUID; it changes membership revision, not the saved view/status fence, so assignment alone does not invalidate its own preparation.                       |
| Native opening                    | `terminal_creation.rs::run` enters `opening` only after the helper's result. Initial opening calls `start_selected_with_open`; live addition uses `enroll_selected` with the current Core epoch. This is separate from the completed provisioning transaction.                                                                                                                                  |
| Host and Core                     | `tauri-terminal-host.ts` inspects the manifests before `connectManagedTerminalCore`. The existing private Core creates its own authority epoch, admission and journals; the client validates returned terminal identities. Host readiness is not provider startup.                                                                                                                              |
| Native intent and broker          | `terminal_open_prepared` consumes one native-held profile/document/presentation/deadline intent. `TauriTerminalService` enters `TerminalNativeBroker` using trusted focus/document state. A separate native Open review covers launch, output attachment and keyboard input through separate signed challenges. Fresh attach/input challenges cannot extend the original start review deadline. |
| Last dispatch boundary            | `TerminalSupervisor.launch` checks the frozen profile and consumes its signed challenge. `managedTerminalBackend.validate/start` rereads the exact manifest and rebuilds profiles; `pty-host` validates/rebuilds again before its single spawn boundary. Codex's explicit model reaches `--model`, and `config.project` reaches `cwd`.                                                          |

Relevant source roots are `apps/desktop/src/`, `packages/core/src/terminal/` and
`apps/tauri/src-tauri/src/`. `model-selection.ts` validates the evidence bytes and
cache expiry; `preparation-context.ts` validates workspace/view/status and directory
identities. These guards remain unchanged. A requested model is not evidence of
provider entitlement or the model actually used after native startup.

The selected path is the interactive Codex PTY profile. The separately opt-in
`managed-codex/runtime.ts` app-server path uses `thread/start` and response model
confirmation. Its initialization/account/thread diagnostics do not identify a
failure in the selected PTY route. No source divergence in the reviewed normal
bindings was demonstrated, so this review makes no speculative implementation fix.

## Revalidated reference decisions

The existing external Git objects/checkouts were read at the exact revisions below,
including Anywh's `docs/architecture.md`, `docs/agent-host.md` and runtime README.
Neither upstream runtime was executed.

- [Anywh Codex definition](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/codex.ts):
  `startThread` and `startTurn` separate thread creation from per-turn model/policy
  parameters. [CodexSessionDriver](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/codexDriver.ts)
  owns the daemon transport. Dependencies include runtime/session contracts,
  child-process/environment helpers and its JSON-RPC transport. **Keep ORQST**:
  importing an app-server driver would replace the selected interactive TUI contract
  and would not prove or repair a preparation/PTY-opening failure.
- [Anywh terminal host](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/host/terminalSession.ts):
  `spawnTerminal` uses node-pty and external tmux `new-session -A`; `killTerminal`
  uses tmux process control. **Do not use**: attachment/recovery and authority differ
  from ORQST's explicit non-adopting manifests, journals and signed broker.
- [Tucano Codex engine](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/codex.ts):
  `codexArgs` binds `-C`/`-m` for `exec --json --ephemeral`; `codexEnv` selects a
  separate home. Dependencies include `smol-toml`, CLI stream/child-process helpers
  and gateway/types/localization. [Router](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts)
  `route`/`parseRoute` select speakers; they do not grant terminal authority.
  **Keep ORQST**: neither headless turns nor speaker routing substitute for the
  interactive selected profile, native review or stable Feature/Core bindings.

The exact [Anywh LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
and [Tucano LICENSE](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE)
are Apache-2.0, each SHA-256
`cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.
Neither pinned tree has a `NOTICE` file. Inspected TypeScript files have no separate
license header. No source/assets/dependencies were incorporated; ORQST's existing
NOTICE is unchanged. Overclock remains a UX reference with no source reuse here.

## Native evidence needed to locate the failure

No new attempt is authorized or performed by this review. Preserve the original
attempt/reservation/quarantine. Do not retry it, release its latch, adopt a process,
reconcile ownership, send input/signals or remove evidence.

For evidence already visible in the owner's active app, record the exact approved
selection and which confirmation was last accepted: **selected configuration** or
**Open/start-output-keyboard**. Record the displayed `stage`, `code`, `effects`
verbatim, plus whether a terminal pane or a separate Open confirmation appeared.
Use the package identity supplied by the owner; source SHA alone is not a runtime
receipt. Do not collect raw configuration, authentication data or terminal content.

| Observed result                                              | What it establishes / next distinction                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `revalidation / catalog_changed / not_started`               | The post-review catalogue differs and provisioning was not entered. The code does not identify which source changed. Prove the changed binary/model/workspace/Feature evidence before attributing a cause; the drift unit test is insufficient. |
| `provision / failed / possible`                              | Commit was accepted and the provision path was entered. This does not prove publication or identify the failing validation/write. The effect flag cannot authorize rollback or retry.                                                           |
| `inspection / selection_blocked / possible`                  | The helper reached final selection inspection and found a blocker. `failed` at this stage can also mean native result/transport validation, so preserve the exact code and boundary.                                                            |
| `feature_assignment / failed / possible`                     | Provisioning/inspection completed far enough to enter Feature assignment; partial assignments may remain. It is not provider startup evidence.                                                                                                  |
| `opening / failed / possible`                                | The native opening boundary was entered. It may fail before host ready, during live enrollment or during native pane presentation; this envelope does not isolate the hop.                                                                      |
| Pane appears, then `opening: incomplete` with an instance ID | The broker's combined operation did not finish all grants. Launch may have succeeded. Keep the instance ID; do not restart, reattach or infer exit. This reply is distinct from the preparation failure envelope.                               |
| Pane appears with no Open confirmation/attempt               | Inspect native-held intent consumption, document/presentation generation, focus and expiry. The helper's `open` result alone cannot prove broker dispatch.                                                                                      |

If existing visible evidence is insufficient, the required next action is a
**separately authorized, disposable native acceptance attempt**, on a reviewed
isolated package/profile/workspace, with one selected Codex/model and one native
configuration approval, followed by one Open approval only if offered. It must not
reuse an uncertain attempt or modify the active user packages. This is a future
owner action, not an instruction to start it during the source review.

At that acceptance boundary, capture only allowlisted stage/operation outcomes and
opaque correlation IDs: helper commit/result, host ready, native intent consumed,
broker prepare/confirmation/launch/attach/input/final snapshot, Core epoch, instance
ID and effect classification. Obtain these from the owned local/dev diagnostics
surface when available; do not infer them from timing, inactivity or screenshots.
The existing preparation envelope and generic broker refusal do not expose all of
these distinctions. If unavailable, report the missing boundary explicitly and
coordinate bounded diagnostic work in its owning front before attempting a fix.
Never log proof signatures, grants, capabilities, private paths or provider content.

> 2026-11-05: The project owner directed removal of real CLI binary SHA-256
> values from the repository. The historical findings above are otherwise unchanged.
