# Structured OpenCode Studio pilot — 2026-11-17

The **Structured agents** panel in native Studio supports Codex and OpenCode
under `ORQST_STRUCTURED_AGENTS=1`. In an active Feature, select OpenCode, name
the session and confirm the executable, version, SHA-256, project and permission
policy in the existing native sheet. The same sheet reviews prompts, decisions,
one-use delegation grants, interruption and stop. The Core uses the existing
Feature fence and session pool. See the
[Codex workflow](structured-codex-pilot.md) and
[private projection contract](../api/protocol.md#structured-studio-session-projections).

## Ownership and policy

- Core starts one new OpenCode 2.2.5 process per OpenCode session with
  `serve --stdio --hostname 127.0.0.1 --port 0`. It accepts only a numeric
  loopback endpoint, requires a 401 from the unauthenticated event endpoint,
  checks the authenticated server version and subscribes before creating the
  session. The random Basic Auth password stays in Core memory and the child
  launch environment. HTTP requests go directly to IPv4 loopback.
- Each process gets a disposable HOME and XDG roots. It uses the selected workspace
  as its project and starts independently of the user's existing OpenCode account,
  data and background service. The pinned configuration disables updates, sharing,
  external plugins, MCP, skills, project and Claude configuration discovery,
  formatters, LSP and snapshots. The child environment omits OTLP endpoints and
  headers, and Core emits no telemetry. Managed configuration takes precedence
  in 2.2.5, so the pilot refuses startup when those platform paths exist.
- Only file read, edit, glob and grep are exposed by the pilot permission rules,
  with an `ask` rule for each. Reviewable requests include an exact tool source and
  bounded resources. An edit also needs a full reviewable patch for its resources.
  The host checks the live pending request again before submitting `once` or
  `reject`. OpenCode may invalidate other pending permissions when handling a
  rejection. Shell, external-directory and subagent permissions are denied by the
  provider policy. This is an application policy boundary.
- Closing the panel or switching Features changes the view. Ending an owned
  session closes stdin, then escalates to TERM/KILL for the owned process group
  if needed. The provider database and cache in the disposable home are removed
  after exit. Startup or transport failure cannot adopt another server.

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

The synthetic suite covers stream updates, a 401 requirement, exact one-use
approval and rejection, interruption, recovered and unproved outcomes, scope
denials, process-group cleanup and same-provider and mixed delegation. The
optional smoke verifies the local binary digest, loopback listener, 401,
authenticated version, live SSE handshake, session creation, inbox admission
with `resume:false`, and a log watermark. It also verifies an empty delivered
history and normal exit after EOF with disposable storage. It uses neither
login nor a model turn.

Native acceptance still requires an isolated Tauri build with the desktop's
flag on and off, native review cancel and confirm, a real model turn, provider
permission and interruption behavior, live A → B → A, Feature switching and
normal Quit. The pilot does not provision an account or guarantee an available
model. Its application-level policy and ordinary process-group cleanup are
independent of OS sandboxing or cleanup guarantees after a host hard kill.
