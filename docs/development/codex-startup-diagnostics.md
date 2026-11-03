# Structured startup counter contract

Implemented for future explicit structured starts only. No normal observer startup,
public API, WebSocket or dashboard behavior changes. Historical initialize timeouts
remain unexplained: these counters did not exist for them and cannot be reconstructed.

## Installed-binary comparison and causal limits

Local investigation on 2026-11-03 retained an initialize-only probe of Codex 0.162.1
with the same recorded executable SHA-256 as the failed preparation attempt. Its
correlated initialize response took 38 ms through the production backend, compiled
native host and channel. This is a measured handshake, not complete runtime startup
or existing-login acceptance. The driver invoked that transport directly; it did
not exercise signed runtime admission, account availability, thread creation, model
entitlement or delegation.

| Boundary              | Isolated probe                                                                                                                                           | Preparation 604 (retained initialize diagnostic)                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Executable            | Installed 0.162.1, recorded binary hash                                                                                                                  | Same version/hash in the sanitized report                                                                                                   |
| Argv                  | Production `structuredCodexArguments` reuse branch: fixed `-c` overrides, then `app-server --listen stdio://`                                            | Same source recipe at the reviewed revision; no independently captured native argv                                                          |
| Environment           | `managedCodexEnvironment`; temporary HOME/CODEX_HOME, private SQLite/log/temp directories, fixed system PATH; no inherited credentials                   | Same environment recipe; existing native HOME/CODEX_HOME permitted, private SQLite/log/temp directories; actual shared contents uninspected |
| Cwd                   | Host in private state; native child in a new empty temporary project                                                                                     | Same source recipe; retained report describes an empty disposable project, different paths                                                  |
| Configuration allowed | Empty temporary native home except file credential-backend setting; OS sandbox denies network, user-home data reads and writes outside binary exceptions | Existing native auth/config shared by explicit contract; configured MCP startup and native refresh/network effects permitted and unverified |
| Transport             | Real stdin/stdout pipes, LF JSONL, base64 slices over Node JSON IPC; stderr drained/count-only                                                           | Same pipe/IPC/framing recipe; historical stderr ignored; no hop counters retained                                                           |
| Order                 | Wait for host started, send initialize with experimental API requested, await response, send initialized, stop owned child                               | Production order is initialize response, initialized, account/read, thread/start; failed during initialize, so later requests never sent    |
| Time budget           | Unchanged 8-second initialize deadline; 38 ms measured after started, excludes pre-RPC launch work and later startup stages                              | 8-second initialize deadline expired despite a separate 50-second overall startup budget; 30-second thread/start budget never reached       |
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
The redirect variable was found in binary strings, not established by an upstream
contract. Observed loopback traffic does not prove token refresh: the refresh path
remains inconclusive without an otherwise identical redirect-removal control.
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
unchanged request deadlines and lost ownership. A real stderr Readable error is
injected into the compiled host: startup and the still-owned exit plus durable
receipt must survive, without retaining the error payload. Fake cleanup still
requires genuine durable exits and preserves uncertain disposable state. They do not execute Codex,
login, inference, user configuration or quarantines, and are not provider acceptance.
