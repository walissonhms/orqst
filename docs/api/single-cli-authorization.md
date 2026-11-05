# Single local CLI authorization

Native host source increment, based on `f2466101c5731189f68f555d180eb8a879f6f3a9`.
This changes the private Tauri terminal host, not the read-only observer API.
See [pinned research and decisions](../research/single-cli-authorization.md).

## Exact private contract

`TerminalNativeHost.cliAuthorization` is an optional trusted host port:

```ts
interface TerminalCliAuthorization<Document extends object> {
  authorizeCli(
    document: Document,
    profile: Readonly<TerminalProfile>,
  ): Promise<'allowed' | 'blocked' | 'revoked'>;
  current(
    document: Document,
    profile: Readonly<TerminalProfile>,
  ): 'allowed' | 'blocked' | 'revoked';
  epoch(profile: Readonly<TerminalProfile>): string | undefined;
}
```

The production Tauri host installs it using `TerminalCliPolicyStore`; legacy hosts
without the port retain their existing explicit confirmation contract. No renderer
can install the port, supply its answer or request a signature.

The renderer still sends exactly `{version:1, action:'open', profileId}`. The existing
native route validates the actual source/document/focus/owned opening intent. The
broker prepares the exact current Core profile, then `authorizeCli` checks existing
policy. A previously unseen executable may show one compact native review (path,
SHA-256, version and CLI-use scope). Acceptance persists the policy and continues
the same opening through launch, output attach and keyboard input. Each operation
still consumes its own fresh signed Core challenge bound to the exact profile.
A subsequent opening/model choice needs no new application authorization while the
canonical executable hash and explicit policy scope remain valid.

Public refusal shape extends the existing reply with optional
`authorization: 'blocked' | 'revoked'`. It contains no policy epoch, path, signature,
attachment ID, lease, credential or process handle. Refusal requires inline feedback;
it must not trigger a loop of Start/Attach/Input/Paste dialogs.

## Durable policy and scope

The native-owned admission directory contains `cli-authorizations/<path digest>.json`,
private directory `0700` and bounded regular single-link file `0600`. The strict
record stores only version, `owned-local-terminal-v1`, canonical executable path,
executable SHA-256, authorization UUID epoch, permission-scope digest and
allowed/revoked state. No sessions, PIDs, process proofs, keys or captured text persist.

The permission-scope digest covers the literal versioned `environmentProfile` and
`cliAuthorizationScope`, both supplied by the trusted profile factory. Missing scope
is blocked without a review. Scope strings distinguish provider, native/shared versus
managed credential environment, Codex read-only/on-request defaults and configured
ORQST MCP versus inherited native definitions. They contain no model ID, cwd, PATH,
state/cache/config inode or session ID. Model/cwd/argv and catalog validity remain in
the immutable Core profile and one-shot proofs; changing them does not itself demand
another CLI-use modal. Display-only permission prose is not a trust key.

Executable bytes are hashed before review/reuse and checked against their canonical
path, owner and safe permissions. Volatile file identity caches only avoid rehashing
unchanged bytes on every keystroke; identity changes trigger hashing again. Identical
bytes retain policy; changed bytes require the CLI review again and a fresh epoch.
An explicit revocation or changed permission scope remains blocked until explicit
configuration. A fresh epoch never reauthorizes existing views from an older epoch.
Policy is local same-user authority, not protection against a malicious same-user
process rewriting private policy and the application itself.

## Input and release

Blur/sheet revokes the existing Core input lease. Returning focus permits silent
reacquisition only for the same document, owned view/attachment, native source and
unchanged policy epoch. A background request is denied. The broker renews an expiring
lease under those checks; no manual two-minute renewal is needed. Renderer sequence
and fresh-lease sequence are tracked separately so renewal cannot replay input.
An uncertain write/paste reply fences input for that view, without replay or process
adoption. Clipboard text remains plain/untrusted and bounded by existing caps.
The client must resume its suspended UI input state after genuine native focus; this
backend alone cannot change a renderer that permanently disables input on blur.

User Stop on a known owned instance remains available after binary/policy revocation:
release authority is independent of permission to start or write. It still uses actual
native focus and a fresh Core stop proof. No observed/external instance is accepted.

`TauriTerminalRetirement.run` accepts a private
`authorizeOwnedRetirement(evidence: OwnedTerminalRetirementEvidence): boolean` port.
The production service installs it. Identity comes from the exact private Core evidence,
current Core epoch and known selection slots, independently of volatile broker views;
strict nonempty evidence requires the current Core epoch and `prepared`/`start_failed`, or
`exited` with a receipt. Core independently revalidates nondispatch/owned exit,
journal/reservation ownership and its signed one-shot retirement challenge. Revoked
CLI-use policy does not prevent release. Invalid/missing/uncertain evidence denies
inline and never falls back to `confirm`. The legacy `confirm` callback is used only
by a host without this port. No PID-absence inference, reservation deletion, retry or
provider task is added. Close/hide and Quit orchestration remain native lifecycle work.

## Security review and acceptance boundaries

Origin, document, native focus/generation, current reviewed CLI/profile/model/cwd,
owned opening intent, CSP, signed Core challenge/epoch, capacity, journal ownership,
exit receipts and honest transport uncertainty are preserved. The observer has no new
HTTP/WS endpoint. Provider/OS login, password and tool approvals are unchanged.
CLI-use trust grants no task execution, background prompt, MCP task grant, communication,
PID adoption or cross-Feature/Workspace authority; configured bilateral MCP remains required.

Source/fixture validation does not establish WebKit native focus, real-provider operation,
package behavior or deterministic Quit cleanup. Independent review and separately
coordinated native acceptance are required before real use.
