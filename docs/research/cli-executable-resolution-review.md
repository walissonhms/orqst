# CLI executable resolution reference review

2026-11-05. Research for the proposed provider-signature and version contract; this
note is not an implementation or acceptance record.

- [Anywh `resolveAgentBin`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/executables.ts)
  uses Node filesystem access checks, PATH and well-known directories. Explicit
  paths pass through and a missing executable remains a command name. Its
  [Claude session](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/claude/session.ts)
  spawns that selection. These checks establish executability, not vendor code
  signature or the binary identity authorized by ORQST. **Keep ORQST's existing
  controlled selection; do not reuse this resolver.**
- [Tucano `detect.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/detect.ts)
  uses Node filesystem access and `execFile`, finds binaries on PATH, and probes
  versions with a permissive regular expression. Its detection also runs auth or
  model commands and inherits the process environment by default. Its
  [CLI runner](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/cli.ts)
  uses Node `spawn`. This does not establish the explicit signature, strict
  version evidence or minimal probe environment required by ORQST. **Do not reuse
  the detector or runner for this authorization boundary.**

Both pinned [Anywh](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
and [Tucano](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE)
licenses are Apache-2.0; no NOTICE file was found in the inspected checkouts and
no upstream code is copied by this note. Dependency license review would be
required before incorporating any upstream dependencies. No real CLI was run.

## Group revocation follow-up — 2026-11-05

Re-read the exact pinned Anywh `resolveAgentBin` and Tucano `detect.ts` sources
linked above for this race fix, alongside ORQST's `TerminalCliPolicyStore`,
`authorizePreparedGroup`, native preparation and `prepareTerminalCreation` guards.
The earlier reuse decisions remain: neither upstream resolver/probe implements
ORQST's native informed contract-set review, per-executable policy CAS/epoch or
whole-group grant continuity. Keep and narrowly adapt the existing ORQST flow;
no upstream code, assets or dependencies are incorporated. The pinned license and
NOTICE findings above remain the provenance for this unchanged use.

The adaptation rechecks signatures and every existing/new binding after the last
probe, then compares all cached bindings without awaits after the last native
current check. The same helper is reused before Tauri/Electron provisioning, with
synchronous continuity in existing provision guards. The probe checks authority
before temporary HOME creation and again before spawn. These are separate checks,
not cross-process policy/focus/filesystem atomicity: a successful check can precede
revocation or ephemeral directory creation. Durable grants remain individual;
partial artifacts and uncertain effects are not rolled back or retried. No actual
provider, native acceptance, reservation recovery or package freeze is implied.
