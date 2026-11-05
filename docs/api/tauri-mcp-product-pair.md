# Tauri product MCP pair preparation

The existing private `studio_request` command accepts one additional strict
request. `contractVersion: 1`, existing replies/failure stages, capability,
source-document identity, focus, generation and native-review requirements remain.
There is no observer HTTP/WebSocket route or new MCP tool/server.

```ts
{
  action: 'create-mcp-pair';
  generation: number; // current native Studio generation
  workspaceId: string;
  featureId: string | null; // same catalog/current Feature fence
  catalogId: string; // current catalog SHA-256
  sourceProvider: 'codex' | 'opencode';
  codexModelId: string; // opaque current Codex catalog ID
  openCodeModelId: string; // opaque current OpenCode catalog ID
}
```

The helper receives the same request without `generation`, after native
validation. Each provider/model must resolve in its own current catalog. The
opposite provider is the worker; count is fixed at two. Arbitrary providers,
member arrays, paths, tasks, proofs, extra properties and partial opt-in are
refused. The action is initial-selection-only: it cannot append MCP members or
upgrade an existing Core. The existing `create-selected` action still creates
independent terminals with MCP disabled, including incremental enrollment.

Native configuration review precedes writes and includes each manifest's exact
model, pin, workspace/preparation binding, native identity and acknowledgments.
Its `communication` projection contains `sourceTerminalId`, `workerTerminalId`
and `separateTaskGrantRequired: true`. This is review metadata, not a persisted
grant or runtime instance identity. Both complete pages must be accepted when
the pair requires pagination; no truncated review or first-page-only approval.

Actual signed Open, owned starts, MCP authorization and tool calls retain the
existing [interactive MCP contract](../development/tauri-interactive-mcp.md).
Slot 0 is source and slot 1 worker; native focus does not change roles. At grant
preparation the Core binds their actual instance IDs, workspace and epoch. One
separate native grant permits `delegate_task` → `wait_task` → `submit_result`
with exactly the same `taskId` returned to the source. The grant expires at the
reviewed deadline (at most 120 seconds from preparation); task/result budgets
remain 4096/8192 bytes. The broker remains memory-only and single-use.

`ready` means grant-authorized, `queued` means held by the broker, `delivered`
means returned by worker `wait_task`, and `completed` means a matching worker
`submit_result` returned to the source. These are MCP exchange states, not
independent verification of provider execution or result quality. PTY stdout,
an idle prompt, pane opening and process exit establish none of those task
transitions. Lost ownership, expiry or disconnection preserves `unknown`, with
no resend, recovery or adoption. Feature/N-member routing and durable queue
composition remain pending; the Feature Delegate button remains unavailable.

## Security review note

The renderer gains only a constrained preparation intent through the existing
capability. Native code strictly validates both model digests, source provider,
workspace/Feature scope and generation; it refuses a live Core and requires two
returned files. Unsupported inherited OpenCode selectors are refused before the
allowlisted helper environment can omit them, in either source direction.

All paths, executable/native identity review, source/worker UUIDs, native dialog
results and signed grants remain native/Node-owned. A checkbox is not consent;
complete native configuration review and the existing separate per-CLI Open and
one-task grant are mandatory. The same catalog is rediscovered after all pages;
model and preparation evidence are checked again at publication and eventual
launch. Failure effects and native latches keep their existing conservative
classification. No body-size, socket capability, queue, ownership, epoch,
revalidation, focus or quarantine guard is weakened. No credential, task payload,
proof, raw provider error or native configuration is added to renderer replies or
logs. Loopback HTTP, cookies, CSP, Host/Origin and observer ingestion are unchanged.

## Mixed MCP grant and security review — 2026-11-05

The [mixed communication increment](../development/mixed-mcp-communication.md)
supersedes earlier single-exchange-per-pair statements: each exchange still requires
a new native review and signed single-use broker. The relay negotiates only the two
reviewed revisions, with a supported fallback for unknown well-formed versions.
The Unix socket budget changes from three calls per connection to three per confirmed
grant and role, capped at 16 grants per pair. Preparation does not reset the budget.
A new broker is installed only when sockets are idle; calls already received remain
bound to the old broker, and old task IDs cannot complete a new task. After installation
the runtime cannot infer when the model conceived a newly received call. Disconnect,
loss, exit and invalidation remain terminal. No new network listener, credential
exposure, renderer authority or PTY injection is introduced. The Tauri test and
synthetic acceptance script split replay from a new native grant; the script and real
provider acceptance were not run for this increment.
