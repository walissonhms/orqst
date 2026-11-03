# Structured startup counter contract

Implemented for future explicit structured starts only. No normal observer startup,
public API, WebSocket or dashboard behavior changes. Historical initialize timeouts
remain unexplained: these counters did not exist for them and cannot be reconstructed.

## Bounded native-auth initialization latency mitigation — 2026-11-03

The previous comparison used the wrong refresh redirect variable. Official Codex
0.162.1, tag `rust-v0.162.1`, resolves to commit
`092d3acd6bec3e3a14bdc7e7a2810ab628ab759d`. Its
[auth manager](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/auth/manager.rs)
uses `CODEX_REFRESH_TOKEN_URL_OVERRIDE`, not `CODEX_REFRESH_TOKEN_URL`.
The [startup path](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server/src/lib.rs)
loads auth and configuration before processing RPCs. The
[cloud configuration loader](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/cloud-config/src/service.rs)
calls `auth().await` before checking plan eligibility, under its own 20-second
startup fetch timeout. Expired ChatGPT tokens can therefore trigger refresh before
`initialize`, even for the synthetic free-plan identity used here. Source inspection
does not attest the installed binary; the controlled native measurements below
independently establish that binary's behavior.

A bounded follow-up used the same recorded 0.162.1 binary hash, production backend,
host, pipes and channel, new disposable homes/projects, file storage and false expired
tokens. A test-only host injected the redirect; production never inherits it. Only
the fixture's selected loopback port was reachable. The listener counted a fixed
`POST /oauth/token` classification without recording headers, body or credentials.
No account, thread, turn, login or inference request was sent.

| Synthetic control                                                       | Initialize result                              | Refresh requests/replies |
| ----------------------------------------------------------------------- | ---------------------------------------------- | ------------------------ |
| Redirect absent, endpoint silent                                        | 42 ms                                          | 0 / 0                    |
| Previous wrong variable, endpoint silent                                | 42 ms                                          | 0 / 0                    |
| Correct variable, endpoint silent                                       | Old 8-second timeout, 8.198 s after host start | 1 / 0                    |
| Correct variable, reply after 1.5 s per refresh                         | 3.069 s                                        | 2 / 2                    |
| Correct variable, reply after 9 s per refresh, old channel policy       | Old 8-second timeout, 8.227 s after host start | 1 / 0                    |
| Correct variable, reply after 9 s per refresh, 30-second channel policy | 18.066 s                                       | 2 / 2                    |

Fixture replies were synthetic HTTP 400 failures. Successful initialization does not
mean that credentials refreshed successfully or an account became available. Other
loopback connections occurred in the absent/wrong-variable controls; total connection
counts alone had incorrectly suggested refresh coverage in the earlier probe.
All six runs retained actual owned direct exits and matching durable receipts.
Timeout rows measure host-start through failure; success rows measure the RPC await.
The outer driver deadline/owned cleanup are separate from both measurements.
The old/new late-reply pair used the same 35-second outer deadline; only the
channel initialization budget differed. An exploratory old-budget run with a
12-second outer deadline is excluded from this final comparison.
The direct transport probe retained its own handle for bounded shutdown; it did not
exercise signed runtime admission or authorize signals after runtime ownership loss.

The controlled comparison proves that the 8-second first-response budget interrupts
this delayed native-auth startup and that a 30-second budget permits its handshake.
The adjustment mitigates startup latency; it does not repair token refresh or establish
why historical attempts failed. Existing-login initialization now permits 30 seconds; account
read/task RPCs remain at 8 seconds, separate-login initialization remains at 8 seconds,
thread preparation remains at 30 seconds, and the overall 50-second startup deadline
still caps all serial work. This is bounded tolerance for native startup, not a
guarantee of readiness under every network or credential-store failure. No auth
backend, native policy, required MCP, framing, ownership or retry rule changes.
The compiled synthetic process regression delays initialization beyond 8 seconds
then requires complete signed startup, owned stop and a durable exit receipt.
Mock-clock regressions cover the new limit, late replies, legacy limits and the
shared overall deadline. Automatic tests never execute Codex or token refresh.
The 30-second value covers the measured 18.066-second handshake with bounded
headroom, matching the existing thread-preparation budget. It is a policy choice,
not a measured maximum or a guarantee: upstream's 20-second cloud-config timeout
does not bound every serial native-auth/config operation. A slow or silent native
process can now remain in initialization up to 22 seconds longer before ownership
loss. An uncertain admission reservation remains held after loss under either budget.
Channel timeout or the overall deadline still detaches, clears pending request timers
and prevents late replies from restoring ownership; neither path signals after loss
or releases an uncertain reservation. The existing independent host lifetime remains
30 minutes before TERM, followed by KILL after 5 more seconds if necessary; this
policy owns eventual direct-child cleanup, with no descendant containment claim. The six direct-probe exit receipts do not prove that runtime
timeout cleanup, because that probe kept its own transport handle.

This reproduces one timeout path; it does **not** identify the cause of preparation
604 or run 598. Their missing native/hop evidence remains missing. Historical
quarantines and reservations remain unchanged, and real-provider acceptance stays
blocked. Keyring/auto was inspected in source only: startup can call synchronous
credential-store reads; auto fallback runs only after that read returns. No Keychain
was accessed. Temporary HOME alone would not isolate the same macOS user's Keychain.
DNS/VPN/mDNS and fixed remote endpoints remain untested; no DNS settings, proxy or
system network configuration was changed. No additional matrix or native retry is
needed to review this mitigation.

## Installed-binary comparison and causal limits

Local investigation on 2026-11-03 retained an initialize-only probe of Codex 0.162.1
with the same recorded executable SHA-256 as the failed preparation attempt. Its
correlated initialize response took 38 ms through the production backend, compiled
native host and channel. This is a measured handshake, not complete runtime startup
or existing-login acceptance. The driver invoked that transport directly; it did
not exercise signed runtime admission, account availability, thread creation, model
entitlement or delegation.

The following comparison predates the mitigation: its 8-second initialize deadline
was the policy measured at that time, not the current native-auth initialization
budget.

| Boundary              | Isolated probe                                                                                                                                           | Preparation 604 (retained initialize diagnostic)                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Executable            | Installed 0.162.1, recorded binary hash                                                                                                                  | Same version/hash in the sanitized report                                                                                                   |
| Argv                  | Production `structuredCodexArguments` reuse branch: fixed `-c` overrides, then `app-server --listen stdio://`                                            | Same source recipe at the reviewed revision; no independently captured native argv                                                          |
| Environment           | `managedCodexEnvironment`; temporary HOME/CODEX_HOME, private SQLite/log/temp directories, fixed system PATH; no inherited credentials                   | Same environment recipe; existing native HOME/CODEX_HOME permitted, private SQLite/log/temp directories; actual shared contents uninspected |
| Cwd                   | Host in private state; native child in a new empty temporary project                                                                                     | Same source recipe; retained report describes an empty disposable project, different paths                                                  |
| Configuration allowed | Empty temporary native home except file credential-backend setting; OS sandbox denies network, user-home data reads and writes outside binary exceptions | Existing native auth/config shared by explicit contract; configured MCP startup and native refresh/network effects permitted and unverified |
| Transport             | Real stdin/stdout pipes, LF JSONL, base64 slices over Node JSON IPC; stderr drained/count-only                                                           | Same pipe/IPC/framing recipe; historical stderr ignored; no hop counters retained                                                           |
| Order                 | Wait for host started, send initialize with experimental API requested, await response, send initialized, stop owned child                               | Production order is initialize response, initialized, account/read, thread/start; failed during initialize, so later requests never sent    |
| Time budget           | Pre-mitigation 8-second initialize deadline; 38 ms measured after started, excludes pre-RPC launch work and later startup stages                         | 8-second initialize deadline expired despite a separate 50-second overall startup budget; 30-second thread/start budget never reached       |
| Outcome               | 465 stdout bytes, two complete lines, one notification, one correlated response; owned exit code 0 plus bound durable exit receipt                       | request_timeout/initialize, ownership_lost, no confirmed native exit in the retained report                                                 |

The probe's outer sandbox had a separate 10-second driver deadline. Its total
835 ms included launch work and a deliberate 600 ms sampling delay before shutdown;
comparing that total directly with the 38 ms RPC measurement would mix boundaries.
Run 598, the earlier native-login attempt, retained an approximately 8.3-second
duration but no method-specific diagnostic. Its failed method and cause cannot be
retroactively assigned from preparation 604.
Previously reproduced IPC backpressure and slow required-MCP thread startup were
fixed before the latest preparation attempt. Neither establishes an initialize
failure in that attempt.

This evidence rules out a universal inability of that binary to initialize over
these production pipes with minimal configuration. It does not locate the historical
stall or identify shared configuration, MCP, authentication, cwd or a deadline as
its cause. No new framing, argv, authentication or timeout fix follows from it.
No new native execution is required to review these retained results. Future
existing-login acceptance still needs its own authorization and capacity decision;
diagnostics cannot reconcile or release quarantined reservations.

A follow-up controlled comparison uses only disposable synthetic homes/configuration,
empty projects and the pinned installed binary. It compares empty/file-backend config,
legacy/reuse argv, required MCP, project trust, hooks, large config, custom providers,
analytics/update settings, marketplaces and false expired authentication. The loopback
blackhole accepts TCP connections and withholds responses; other network access stays
denied. This matters because immediate network denial can conceal a blocking-network
failure. The authentication variant additionally redirects the native refresh URL in
its test-only host; that environment difference is explicit, not production behavior.
The redirect variable in that earlier comparison was found in binary strings, not
established by an upstream contract. Its loopback traffic did not prove refresh.
The corrected-variable/removal control above supersedes that experiment's refresh
coverage, without expanding its historical conclusions.
No account, thread, turn, login or inference request is sent.

Those configurations have not reproduced the historical initialize timeout. Required
MCP did not start during this handshake-only comparison; prior evidence of a slow
required MCP concerned `thread/start`. Successful JSONL responses and direct exits
with bound receipts do not prove full readiness, descendant cleanup or that different
real configuration cannot block startup. Named-pipe probes likewise do not establish
that the native loader actually read a source. The stderr error-handler fix covers a
separately injected host regression introduced by these diagnostics, after preparation
604; it is not a historical root-cause claim. No deadline or shared-config policy is
changed on this evidence.

The negative result covers only the tested configurations. Loopback blackholes do
not cover DNS, VPN or mDNS stalls. Only the file credential backend was exercised;
`keyring`/`auto`, locked Keychain and native credential UI prompts were not tested.
Calls to fixed endpoints may ignore redirects and fail immediately under the sandbox
instead of reproducing a stall. These gaps leave the historical cause unresolved.
Per-cell repetitions, connection counts and synthetic controls stay in private local
evidence outside Git; none contains native user configuration or credentials.

`CodexStructuredRuntime.snapshot().startupDiagnostic` is version 1, in memory only.
It retains one parser snapshot and, for the native backend, one parent snapshot and
the last received host sample. The parent binds its sample to the prelaunch instance,
authority epoch, manifest digest and config digest from that backend invocation. Host
metadata travels on that invocation's private IPC handle. It does not authenticate
an arbitrary native process. No new files, logs, retention store or export command
are added. Restart loses these counters; durable lifecycle receipts remain separate.

## Observations and limits

- Parent: queued sends, callbacks, errors, backpressure; received data frames/bytes;
  accepted/rejected diagnostic frames. A false send result is accepted backpressure,
  never a reason to retransmit. Existing 512 KiB send budget remains intact.
- Host: received commands, accepted/rejected stdin writes, submitted stdin bytes,
  callbacks/errors/backpressure/drain; stdout bytes/chunks/LF; stderr **byte count
  only**, drained and discarded; lifecycle receipt queued/completed/error and direct
  child exit event counts. IPC totals include lifecycle/data frames; `ipcData*`
  counters separately describe data frames queued/callback/error. Diagnostic frames
  are excluded from those totals, so diagnostics do not count themselves.
- Parser: received bytes/chunks, complete lines, notifications, response candidates,
  valid correlated responses, invalid messages/output limits, and buffered bytes.
  Buffer size is retained before failure clears the actual private byte buffer.

All keys are fixed. Counters saturate at 16 MiB/count with `saturated:true`; elapsed
monotonic milliseconds saturate at 60,000. There is no per-event history or native
method-name retention. Host samples are at most 128 frames, at 250 ms intervals,
less than 1 KiB each, with one metadata frame in flight and no retries. Reporting
stops on its count/deadline, IPC disconnect, direct host finish or send failure.
Its timers are unreferenced and cannot extend process lifetime. Stderr keeps being
drained after sampling stops. Unlike the earlier `/dev/null` sink, stderr is now a
pipe: if the host dies first, a later native write can fail with `EPIPE` (Rust Codex
ignores `SIGPIPE`). Read errors on this optional diagnostic stream are discarded
locally; they must not terminate the host, its lifetime timer or receipt writer.
This does not catch errors on stdin, stdout, IPC or lifecycle persistence.
Diagnostic metadata shares the same Node IPC channel and its contention with data
and lifecycle frames. Exclusion from the counters does not mean isolation from
backpressure; `sendBackpressure > 0` does not prove pressure exclusively from data.
A diagnostic send/read failure must not bypass the existing host lifetime/escalation
or lifecycle persistence. Host death or IPC contention still limits these guarantees.

Parser/parent snapshots freeze when startup resolves/rejects or transport detaches.
Host sampling independently lasts at most 32 seconds when callbacks flow, or 60
seconds when a callback stalls. Host samples can lag the parent and are **not final
or simultaneous readings**. `host:null` means unobserved, never zero native output.
A short-lived host may finish before its first sample. Unknown versions, extra
fields, counter/sequence bounds and regressing host samples are rejected without
changing process authority. Frozen diagnostics ignore later receipts/messages.

No payload, prompt, response body, arbitrary error, stderr text, request ID, path,
environment, account data, credential or credential hash is retained by this feature.
The existing nonsecret launch binding digests are identity, not authentication or
proof of native parsing. This is a trusted same-user boundary, not hard containment.
Byte counts themselves disclose traffic size; they remain private Core metadata.

## Interpreting the synthetic regressions

The compiled production-host fixture reproduces three identical initialize timeouts:

| Synthetic behavior             | Host stdout          | Parser complete lines | Parser buffered bytes |
| ------------------------------ | -------------------- | --------------------- | --------------------- |
| Does not read stdin            | zero                 | zero                  | zero                  |
| Correlated response without LF | positive, no LF      | zero                  | positive              |
| Notification only              | positive, LF present | one notification      | zero                  |

All three can have a successful stdin write callback: pipe delivery does **not**
prove the native process read or parsed the request. A host-data callback likewise
does not establish parent receipt; compare separate observed boundaries, accounting
for sample lag. Correlated rejection/framing failures retain only fixed reason
labels. Late output cannot repair timeout, restore ownership, free capacity, signal
lost processes, fabricate cleanup, or authorize another execution.

Run fake-only checks with Node 24/pnpm 10:

```bash
pnpm exec tsx --test tests/codex-startup-diagnostics.test.ts tests/codex-native-initialize.test.ts tests/codex-structured-runtime.test.ts
```

These test metadata injection/version rejection, saturation, immutability, bounded
reporting under blocked/error/throwing send callbacks, timer cleanup, withheld/final
LF and late response, secret sentinels including stderr, real fake-process pipes/IPC,
bounded method deadlines and lost ownership. A real stderr Readable error is
injected into the compiled host: startup and the still-owned exit plus durable
receipt must survive, without retaining the error payload. Fake cleanup still
requires genuine durable exits and preserves uncertain disposable state. They do not execute Codex,
login, inference, user configuration or quarantines, and are not provider acceptance.
