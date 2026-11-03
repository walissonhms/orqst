# Experimental native terminal client boundary

The later [durable recovery increment](../development/terminal-recovery.md) adds an
optional private Store journal to the supervisor. It does not change this wire
contract, compose a provider or enable a production control surface.

Implemented engineering code, **not an application API**. No `/api` route, WebSocket
message, normal Desktop IPC listener, observer preload or dashboard registers this contract. Core's
public entry point does not export the experimental supervisor or broker. There is
no enabled provider, generic shell, external-session adoption or credential import.
See [provider research](../adapters/managed-terminal-research.md) and the
[managed design](../architecture/managed-terminal-design.md).

## Native ownership and request contract

`TerminalNativeBroker` consumes the strict, version-1 `terminalNativeRequestSchema`
from protocol. Trusted composition supplies a separately enrolled Ed25519 private
key, authority, supervisor, immutable native document identity and host. The host
must validate the actual current document and native focus, and invoke the native
confirmation helper. A renderer-provided click, cookie, origin or focus flag never
substitutes for those checks. This is not persistent enrollment or a production
cross-process authenticated transport. Use a unique enrolled client ID for every
broker/document: `close()` revokes that ID globally in its authority, so sharing
an ID would revoke other clients.

| Action     | Accepted request fields beyond version/action | Authority/effect                                                             |
| ---------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| `start`    | `profileId`                                   | Exact prepared immutable manifest, native confirmation, one-use signed start |
| `attach`   | `instanceId`                                  | Native confirmation for the broker's own known instance, read attachment     |
| `input`    | `instanceId`                                  | Native confirmation, up to two-minute input lease                            |
| `write`    | `instanceId`, `sequence`, `text`              | Current focus and lease, exact next sequence, supervisor byte/rate limits    |
| `paste`    | `instanceId`, `sequence`, `text`              | Separate confirmation bound to exact text, attachment, lease and sequence    |
| `resize`   | `instanceId`, `columns`, `rows`               | Existing attachment; supervisor dimensions/rate limits                       |
| `read`     | `instanceId`, `cursor`                        | Existing attachment; defensive bounded bytes and explicit gap                |
| `snapshot` | `instanceId`                                  | Owned library lifecycle evidence, independent of agent statuses              |
| `detach`   | `instanceId`                                  | Remove attachment and lease; no signal                                       |
| `stop`     | `instanceId`, `signal`                        | Separate exact `SIGTERM` or `SIGKILL` confirmation; no inferred exit         |

Unknown fields/actions are denied, including executable, argv, cwd, environment,
credentials, raw proofs, adoption, resume and provider approval. Instance IDs are
random attempt identities, never provider/session/PID aliases. The broker only
knows attempts it prepared: navigation recovery or another document's attachment
inventory is not implemented. Native composition cannot recover it from a PID.

Replies are `ok`, `denied`, `cancelled` or `busy`. Success contains the instance ID
and a snapshot or inert output bytes/cursor/gap. It never returns signatures,
challenges, keys, attachment/lease IDs or backend diagnostics. `ok` means the request
was processed; a snapshot may still report `starting`, `start_failed` or uncertainty.
Neither successful stop nor dispatch success proves process exit.

Only one request is in flight per broker, without an offline queue. Native
confirmation starts only from a current focused document. Expiry, enrollment,
document and revocation generation are rechecked after the asynchronous dialog
and synchronously before signing/dispatching the effect. Native blur/transport loss
must call `revokeInput`; navigation/destruction calls `close`. Re-focus never renews
authority. A running broker requires its native host to observe every relevant
focus/transport event; polling a focus Boolean alone cannot detect blur/refocus.

## Electron helpers and gesture limits

`authorizedTerminalSender` requires the exact native window/session/main-frame
objects, matching document generation, reserved dedicated URL
`orqst-terminal://local/index.html`, and focus when requested. The observer URL,
subframes, stale reload generations and other windows/sessions are refused. The
scheme/document is reserved, not registered or served by this increment. Generation
must be maintained by trusted native lifecycle code before new dispatch; frame
object identity alone is insufficient for reload protection.

`confirmTerminalAction` calls Electron's native `showMessageBox`, with Cancel as
both default and dismissal result. It displays the exact frozen instance/profile,
policy, signal and quoted paste, escaping controls. It refuses details beyond 4096
characters and paste beyond 1024 characters instead of asking approval of a
truncated preview. The Core paste limit remains 16 KiB; larger native review needs
a trusted scrolling surface. Native dialog visibility/layout, focus interactions,
accessibility and an actual human gesture have not been accepted on a machine.
The helper is implemented and tested with a dialog double, not claimed as live
native authorization evidence. Translations exist in en-US and pt-BR.

`bindTerminalNativeLifecycle` wires blur to input revocation and main navigation,
renderer loss, WebContents destruction or window closure to permanent client close.
Every main-frame navigation, including same-document navigation, revokes the client;
the fixed terminal document has no in-page navigation. Disposal closes the client
and removes listeners. Modal-focus behavior needs native acceptance on every target
platform: if the modal does not restore native focus, a legitimate confirmation may
be denied. A focus loss fails closed, including while confirmation is pending.
Transport loss remains the composition owner's explicit revocation responsibility.
None of these helpers is installed on the observer window.

## Lifecycle and shutdown

Closing a broker revokes its enrollment, pending grants, attachment and input,
without stopping Core-owned work. It does not destroy the supervisor or claim exit.
Explicit `TerminalSupervisor.shutdown()` denies further preparation/start/attach,
invalidates attachments and marks live work `ownership_lost`, releasing listeners
without a signal. Unstarted preparations become `start_failed`. It is idempotent;
late callbacks cannot erase uncertainty. This conservative teardown policy is not
durable crash recovery, descendant cleanup or a guarantee that work survives.

The optional [metadata journal](../development/terminal-recovery.md) now provides
conservative epoch recovery outside this lab. There is no immutable executable/cwd
binding, resource sandbox, lifetime timer, safe relaunch, signed packaging or credential
provisioning. These production gates still prevent runtime composition. Automatic tests
use only in-memory doubles; the explicit synthetic PTY lab now exercises this broker
against a real fixed Node PTY with a synthetic confirmation host. That host is not
a genuine native user gesture and no real CLI is exercised.

## Security review note

No existing local API, WebSocket handshake, cookie or static-file policy changes.
The schema adds no reachable control surface. The experimental boundary rejects
command/env/grant injection, document substitution, concurrent confirmations,
expired/revoked pending consent and external-instance adoption. Output remains
bounded inert bytes; no emulator, automatic terminal reply, clipboard action, link,
HTML interpretation or persisted transcript is introduced. A compromised renderer
with an active keyboard lease can still abuse typed input; it cannot be prevented
by a schema. Restricted documents, trusted event classification, isolated signing
and production transport/enrollment must be validated before enabling any control.

## Native integration lab — 2026-11-03

The [explicit acceptance application](../development/terminal-native-acceptance.md)
now composes these helpers with a dedicated document/session/preload and
`orqst:terminal-native` handler. Normal Desktop/Bridge startup remains unchanged.
Replies use a strict bounded wire schema (output bytes as at most 64 KiB integer
arrays); unknown fields and backend diagnostics are denied. One request is in
flight; preload adds transient-activation checks and has no generic IPC or queue.
Enrollment/signing stays in the disposable native main process, with a separate
Node host owning only the fixed synthetic PTY. Host transport loss now invokes
`lost()` and preserves `ownership_lost`, including after late exit callbacks.

Real Electron/preload/IPC/Node-host/PTY acceptance passed with intercepted native
dialogs. This is not genuine human-consent acceptance or a production Core control
transport. The lab cannot enable Codex, Claude Code or OpenCode. Immutable
executable/cwd admission, separately provisioned credentials, containment/lifetime
and durable long-lived ownership recovery still block provider activation.
