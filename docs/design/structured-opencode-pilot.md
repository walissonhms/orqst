# Structured OpenCode Studio pilot — 2026-11-17

The **Structured agents** panel in native Studio supports Codex and OpenCode
under `ORQST_STRUCTURED_AGENTS=1`. In an active Feature, select OpenCode, name
the session and confirm the executable, version, SHA-256, project and permission
policy in the existing native sheet. The same sheet reviews prompts, decisions,
one-use delegation grants, interruption and stop. The Core uses the existing
Feature fence and session pool. See the
[Codex workflow](structured-codex-pilot.md),
[Claude protocol record](structured-claude-pilot.md) and
[private projection contract](../api/protocol.md#structured-studio-session-projections).

## Ownership and policy

- Core starts one new OpenCode 2.2.5 process per OpenCode session with
  `serve --stdio --hostname 127.0.0.1 --port 0`. It accepts only a numeric
  loopback endpoint, requires a 401 from the unauthenticated event endpoint,
  checks the authenticated server version and subscribes before creating the
  session. A disposable-home cold start under load reported its stdio endpoint
  after 32.4 seconds. Process readiness gets up to 36 seconds and HTTP calls
  retain their separate eight-second budgets. Native apply allows 75 seconds for
  this OpenCode startup sequence. The random Basic Auth password stays in Core memory and the child
  launch environment. HTTP requests go directly to IPv4 loopback.
- The owner approved shared OpenCode storage on 2026-11-17. Each new process uses
  the user's `HOME` and any absolute `XDG_CONFIG_HOME`, `XDG_DATA_HOME`,
  `XDG_STATE_HOME` and `XDG_CACHE_HOME`
  supplied to Studio. OpenCode resolves its own default roots for unset XDG values.
  It uses the selected workspace and inherits the user's global OpenCode configuration
  and saved login. ORQST passes directory paths and lets the OpenCode process resolve
  credentials. ORQST never reads, copies, links or logs credential files. Parent
  API keys, OpenCode-specific path overrides and OTLP settings are excluded from the
  launch environment. Core emits no telemetry.
- Per-invocation settings disable updates, sharing, formatters, LSP, snapshots,
  warming and scheduled prompts. Project configuration and Claude discovery stay off.
  Startup refuses existing platform-managed configuration because it can override
  the invocation settings. The environment also disables the OpenCode updater.
- The invocation removes `opencode.config.mcp` to keep settings-file MCP servers
  from registering, and denies `plugin.use`, `mcp.use`, `skill.use` and
  `integration.connect` for all resources. In 2.2.5, policy decisions use the
  first matching config document in load order, so a matching global user or
  account-supplied allow can outrank the inline deny. An allowed external plugin
  can execute during startup and register MCP servers, and an earlier `mcp.use`
  allow can keep a server contributed outside `opencode.config.mcp` active. The
  pinned CLI exposes no unconditional per-invocation external-plugin or MCP switch.
  See [config order](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/core/src/config.ts),
  [plugin loading](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/core/src/plugin/module.ts),
  [policy matching](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/core/src/managed-policy.ts)
  and [MCP filtering](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/core/src/config/plugin/policy.ts).
- Only file read, edit, glob and grep are exposed by the pilot permission rules,
  with an `ask` rule for each. Reviewable requests include an exact tool source and
  bounded resources. An edit also needs a full reviewable patch for its resources.
  The host checks the live pending request again before submitting `once` or
  `reject`. OpenCode may invalidate other pending permissions when handling a
  rejection. Shell, external-directory and subagent permissions are denied by the
  provider policy. OpenCode applies any matching saved project approvals from its
  database after the session's `ask` rules. Those actions can run without a new
  request, so ORQST's human review applies to permissions OpenCode actually emits.
  See [permission evaluation](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/core/src/permission.ts).
- Closing the panel or switching Features changes the view. Ending an owned
  session closes stdin, then escalates to TERM/KILL for the owned process group
  if needed. Exit stays unproved without a reported code or signal. Sessions appear
  in normal OpenCode history. ORQST leaves the user's database and cache intact
  on stop and failure. Startup or transport failure cannot adopt another server.
- OpenCode owns writes to its shared database, including native migrations and
  scheduler bookkeeping. The 2.2.5 server starts its scheduler in stdio mode.
  The invocation setting disables new scheduled prompts, but the scheduler's
  leader can wake an already queued scheduled prompt from the user's database
  before it checks the flag for due work. The pilot sends inputs only to sessions
  it creates. See [server boot](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/server/src/process.ts)
  and [scheduler recovery](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/core/src/schedule.ts).

## Turns, recovery and delegation

Core sends a unique input ID to `POST /api/session/:id/prompt` and correlates
execution and stream events with the owned session and delivered inbox ID.
The `session.interrupt` response acknowledges the operation. The correlated
terminal event determines the execution outcome.

After SSE loss, Core invalidates stale approvals. The installed pin's
experimental log returned `log.synced` watermarks without records, including
after a disposable `resume:false` inbox insertion. Core therefore reads the
session outcome and bounded, ordered message projection. It requires busy and
idle times newer than the pre-dispatch baseline and delivery of the exact
input ID within that execution. A final assistant message is recovered only
with matching history and timestamps. Without conclusive evidence Core
retains `unknown`, ends the session and never resends the input. A proved
outcome allows a fresh subscription for later operations.

The Core sends a fresh same-Feature peer roster with each newly dispatched human
or delegated turn. OpenCode receives it as a JSON preface with only peer
identity and execution state. The roster is informational and supplies no grant.

Codex uses its existing dynamic tool. OpenCode 2.2.5 exposes no equivalent
in-process dynamic tool callback in the pinned HTTP API. An OpenCode source
can request the reviewed route with a whole final JSON answer using a per-turn
challenge and the exact target and task. The same Core broker checks workspace,
Feature, expiry, readiness and one-use consumption. Delegated turns and
continuations cannot issue a second delegation. For an OpenCode source, Core
submits B's bounded answer as untrusted synthetic context and starts a
continuation. **Result returned** requires delivery of that exact synthetic
inbox item. The continuation has its own execution outcome. The mixed Codex
routes keep their evidence in Core and never pass an OpenCode input ID to a
Codex turn-link field.

## Provenance and decisions

| Reference                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Inspected contract and decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode 2.2.5, MIT. [License](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/LICENSE), [server process](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/cli/src/server-process.ts), [standalone](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/cli/src/services/standalone.ts), [generated client](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/client/src/promise/generated/client.ts) | Use the pinned stdio lease, readiness, session, permission and SSE contracts. Checked `Session.prompt`, `Session.synthetic`, `Session.interrupt`, the live event feed and session projector, and the managed config and plugin loader's policy order. `@opencode/client` is MIT and uses generated bindings and shared protocol/schema packages. Keep a bounded client using Node HTTP and ORQST's line splitter to avoid dependency and transport changes. No upstream code or packages were incorporated. |
| T3 Code, MIT. [License](https://github.com/pingdotgg/t3code/blob/de7b5e05f6a95573f65c923727fe84542a5b86e9/LICENSE), [v2 adapter sources](https://github.com/pingdotgg/t3code/tree/de7b5e05f6a95573f65c923727fe84542a5b86e9/packages/provider-opencode/src/server/v2), [server owner](https://github.com/pingdotgg/t3code/blob/de7b5e05f6a95573f65c923727fe84542a5b86e9/packages/provider-opencode/src/server/OpenCodeServerOwner.ts)                                                                                                                                      | `OpenCode2Server.make`, `verifyServer`, the v2 client's authenticated event subscription and the adapter's reconnect/reconciliation separate provider evidence from transport success. Keep ORQST's per-session process groups and exact scopes. T3's Effect-based shared process owner, external-server support and dynamic MCP path have different admission and authority boundaries.                                                                                                                    |
| Anywh, Apache-2.0. [License and source](https://github.com/anywh-sh/anywh/tree/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21)                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Read the architecture, Agent Host, runtime and `CodexPool` sources. Keep ORQST's existing session owner and bounded channel utilities. Host-level process sharing, transcript replay and reconnect across host lifetimes do not establish the pinned OpenCode outcome.                                                                                                                                                                                                                                      |
| Tucano, Apache-2.0. [License and source](https://github.com/eduwxyz/tucano/tree/0501956d127699300209902e889f3e69a0948766)                                                                                                                                                                                                                                                                                                                                                                                                                                                 | The router routes channel messages to persistent named roles. Keep the existing ORQST exact same-Feature grant and explicit return evidence.                                                                                                                                                                                                                                                                                                                                                                |
| ORQST. [Structured pilot base](https://github.com/walissonhms/orqst/commit/33e412de4a495debc9fcdf7a2940a598d0a72709)                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Reuse the Core broker, native review, Studio controls, process-group transport and version/hash pin. The per-process EOF grace accommodates the OpenCode stdio contract. No changes to pane layout are needed.                                                                                                                                                                                                                                                                                              |

No separate repository-level NOTICE was present at either pinned MIT source.
ORQST's existing line framing attribution remains in its source and NOTICE.

## Verification and limits

```sh
pnpm exec tsx --test packages/core/test/structured-agents.test.ts packages/core/test/structured-opencode.test.ts
ORQST_STRUCTURED_REAL_OPENCODE=/absolute/path/to/opencode pnpm exec tsx --test packages/core/test/structured-opencode.test.ts
```

The synthetic suite covers inherited and default directory settings, exclusion of
secret and telemetry variables, preservation of provider files, stream updates,
a 401 requirement, exact one-use approval and rejection, interruption, recovered
and unproved outcomes, scope denials, process-group cleanup and delegation between
both providers. The optional smoke inherits the supplied shell environment.
It verifies the pinned binary, loopback listener, 401, authenticated version,
live SSE handshake, empty session history and a log watermark. It submits no
prompt and checks normal EOF exit and persistence by reopening the session with
a second process. The smoke leaves an empty session in the selected OpenCode
database. Supply test-owned `HOME` and XDG roots when running the smoke without
accessing a real user's data or scheduled work.

Native acceptance still requires an isolated Tauri build with the desktop's
flag on and off, native review cancel and confirm, a real model turn, provider
permission and interruption behavior, live A → B → A, Feature switching and
normal Quit. The pilot does not provision an account or guarantee an available
model. Its application-level policy and ordinary process-group cleanup are
independent of OS sandboxing or cleanup guarantees after a host hard kill.
