# Private native administrative recovery boundary

This boundary belongs to the dedicated native `--offline-recovery` entry, before
observer/Core, file hosts, terminals, PTY or provider startup. It has no renderer
command, HTTP listener, websocket, public socket or bridge recovery endpoint. The
existing private Node sidecar transport is reused, with a separate administrative
budget. Ordinary preparation retains its 16 KiB detail limit and admission rules.

The dedicated static document is exactly
`orqst-recovery://local/index.html`, with no script or IPC capability. Native menu
events require that exact visible, focused document. AppKit deactivation,
navigation, close and another native surface revoke the captured generation.
Native window getters and dialogs execute outside application locks. The first
instance keeps its mode; a second launch only focuses it, never switches authority
or starts another helper.

## Fixed native context and durable anchor

The only helper argv context is Tauri's native AppData path. There is no key,
owner, boot UUID, operation nonce, capture path, PID or proof in argv or environment.
The helper inherits only `LANG`; system boot UUID remains the service's fixed,
read-only `/usr/sbin/sysctl -n kern.bootsessionuuid` call. Production passes no
fixture dependency overrides. AppData, its paths and the bundled helper are trusted
native composition, never renderer input.

Under that fixed AppData:

| Path                                                     | Contract                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `administrative-recovery/anchor/identity.json`           | Independent Ed25519 identity and signed installation preview; file `0600`, anchor directory `0700` |
| `administrative-recovery/bundles/offline-<operationId>/` | Service-owned private signed captures, original DB/WAL bytes, receipts and controls                |
| `managed-agents/`                                        | Existing reservation input; no runtime identity is acquired                                        |

Installation is a separate explicit native action before capture. An in-memory
candidate supplies the public fingerprint, canonical directory and ID for
immutable review; nonce and the 30-second service ceiling are generated only
after explicit consent. The exact format-1 installation record, including those
fresh volatile fields, is signed in the separate
`orqst.administrative-anchor-installation` domain and saved with the key pair only
after approval. Exclusive directory/file creation, file fsync and directory fsync
retain any partial installation. Existing, absent-on-load, malformed or substituted
material is never silently regenerated, repaired, rotated or enrolled from capture.

Readers reuse `terminalDirectory`, `readRecoveryFile`, `O_NOFOLLOW`, canonical path,
owner, mode, hardlink and full inode identity checks. A reload verifies Ed25519,
matching public/private keys, fingerprint, path and installation signature. The
retained identity is revalidated before review and again after its async result,
before signing. Private key bytes stay inside the trusted native Node helper;
neither pipe frames nor logs receive them. The installation signature is an audit
binding from trusted native provisioning, not a certificate inherited from Core.

## Wire v2

JSON lines travel only through the owned child's stdin/stdout. A helper-generated
UUID `session` keys the entire lifetime. Native action IDs are strictly increasing
safe integers; no pipelining, queued second action or respawn is accepted.

- Ready: `{kind:'ready',version:2,session}`; mixed old/new helpers deny.
- Native request: `{kind:'action',session,id,action,bundle}`. Actions are `install`,
  `capture`, `continueCapture`, `release`, `continueRelease`, `finalize`, `abort`.
  Install/capture require `bundle:null`. Other phases use a native folder picker
  followed by canonical immediate-child containment in the fixed bundles root.
- Review: `{kind:'review',session,id,nonce,digest,action,binding,detail}`. Review IDs
  and nonces are fresh UUIDs. `binding` is the immutable strict intention plus canonical complete-review fingerprint;
  `detail` contains the entire validated review, including all source hashes,
  identities, membership, metadata, journal facts and DB/WAL snapshot bindings.
  Proof nonce/expiry are absent until separate consent.
- Authorize: `{kind:'authorize',session,id,nonce,digest,binding,challenge,proofDigest,check,requestNonce}`.
  Every request has a fresh `requestNonce`, including every revalidation.
- Authorized: `{kind:'authorized',session,id,nonce,digest,proofDigest,requestNonce,remainingMs}`.
  Native validates original consent, exact intention/challenge and current native
  context before returning the floored remainder from the original click. No
  second signature or lease renewal is permitted.
- Answer: `{kind:'answer',session,id,nonce,digest,approved}` with exact keys.
  The digest is SHA-256 of the JSON tuple
  `[session,id,nonce,action,binding,detail]`; stale/mismatched/extra ACKs close the
  pipe and resolve pending consent false. A fresh phase never inherits approval.
- Completion: `{kind:'complete',session,id,status,outcome}` where status is `done` or
  `blocked`. A blocked phase can have uncertain effects; it is never a rollback or
  cancellation receipt. Allowlisted outcomes distinguish `installed`, `captured`,
  `capture_continued`, `release_prepared`, `aborted`, `finalized` and
  `finalized_controls_preserved`; `unconfirmed` accompanies a blocked result.
  Finalization concerns the old operation only, never global capacity.
  No raw error, path, captured content or key is logged.
  A typed frozen-enrollment source mismatch adds only
  `failure:{stage:'inspection',code:'enrollment_binding_changed'}` to the blocked
  completion. Native accepts exactly that pair and those keys, records
  `inspection/enrollment_binding_changed` in the bounded allowlisted diagnostic
  vocabulary, and displays the localized reason. Unknown exceptions keep the
  generic completion; error messages, stacks and arbitrary error fields never
  enter the pipe or diagnostic sink. A diagnosed completion remains blocked with
  unconfirmed effects; it grants no retry, adoption, release or source rebinding.
  Completion with a failure attached can never be accepted as success.

  Legacy enrollment bindings include the historical CLI device and inode. If an
  executable is replaced and its original identity is no longer available as
  evidence, the binding cannot be reconstructed. The result is uncertain and
  preserved; it is neither accepted nor declared invalid, and the old journal is
  not rewritten. The diagnostic code is retained for compatibility and the
  localized message describes the binding as unverifiable. Recovery never runs
  the CLI or treats this outcome as launch authorization.

Complete detail is at most **64 KiB UTF-8**, frame **128 KiB**, cumulative output
**512 KiB**, queued output **128 KiB**. Input buffering is **16 KiB**, with a
**512 KiB** lifetime input budget and no batched ACKs. Escaped-format controls are
visible rather than interpreted; expansion exceeding a budget rejects the review,
never truncates it. The original absolute **300-second** session bounds pre-consent reading and is
never refreshed. Only Approve starts the **30-second** native consent window;
transport, signing and fsync consume it. See the
[canonical intention and conservative clock transfer](../development/offline-recovery-consent-clock.md).

Native summary makes the complete read-only AppKit details panel available before separate approval becomes possible. The panel uses NSScrollView/NSTextView with plain selectable text, wrapping and a vertical scroller. It contains only the bounded review; no key or unrelated data is copied. Display availability does not prove that a human read the text.
Details can only return to summary or Cancel; the panel has no approval control and Cancel is the default. Each sheet must be observed as the
exact active parent's AppKit sheet; generation, source, presentation and deadline
are checked again after blocking dialogs and immediately before the ACK. The
helper separately checks pending session/id/nonce/digest/deadline, current pipe,
immutable intention and retained anchor after async consent, then issues and signs only
`administrativeRecoveryBytes` in its independent administrative domain.

## Interruption and authority limits

EOF/error/timeout revokes pending consent and cannot authorize a new signature.
An accepted proof whose effects already began is **uncertain** when its completion
is lost. Original reservations and signed artifacts remain preserved; no inferred
rollback, signal, process adoption, PID scan or automatic retry occurs. Native
consumes an actual `CommandEvent::Terminated` when received, without treating that
exit as transaction completion. Dropping `CommandChild` closes its writer and is
not exit proof; unknown same-boot helper leases are never reclaimed by this entry.

The service's explicit per-boot continuation rules remain authoritative. A single
helper retains its service instance for the session. Closing a pipe does not hand
its lease to another helper. Native diagnostics use the existing bounded,
allowlisted logger; logger availability never grants authority or changes effects.

This same-user anchor does not resist malicious same-UID replacement, compromise
of the installed native app/kernel, or rollback of the whole AppData/volume. A
self-signed capture cannot establish its own anchor. Neither native presentation
nor kernel reboot proves historical binary provenance. The entry uses corrected service freeze `739870cb7782d9b1274ee2ad658500b1652b719e`: release preparation retains the original marker, and only a fresh finalization approval authorizes the final rename. The integrated correction `03823016b81f28111628089795e571ad242104af` rechecks the exact boot lease and 30-second proof deadline immediately before rename, after durable preparation/source checks. Its exact-deadline and slow-fsync regressions preserve the original marker; expiry after commit preserves truthful completion. Packaging and real native acceptance remain separate gates. No old advisory-gate/legacy-autoreopen incompatibility is used to refuse the corrected protocol.

The [two-moment correction](../development/offline-recovery-consent-clock.md) supersedes
pre-review challenge issuance: v2 proofs bind the displayed complete intention
fingerprint, native `Instant` plus continuous clock start in the AppKit delegate,
and Core enforces the minimum effective deadline through the final commit.
Existing format-1 anchors are loaded without migration or regeneration.

## Optional exact historical binding candidate

Native-only `--offline-recovery --offline-recovery-binding-evidence ABS` passes a
candidate file to the existing capture helper through argv, never an action or
renderer field. Evidence is data until the complete historical enrollment
preimage matches frozen intent/receipt and native phase approval signs the full
review. The new bundle retains exact private evidence bytes/metadata; all later
phases use only that copy. [Contract, operator vector and current-content limits](../development/offline-historical-binding.md).

## CLI enrollment binding v2 — 2026-11-05

A v2 interactive manifest records the canonical CLI path, provider signature
identity, contract revision, policy revision and authorization epoch. Its
versioned enrollment preimage excludes the CLI digest and inode; Node identity,
the manifest, state, project and model-source binding remain checked. Offline
inspection reads the v2 manifest without opening the CLI. This does not grant
execution: an updated executable still needs a current independently verified
local CLI authorization before PTY spawn. Mixed v1/v2 reservations are supported.
