# Passive terminal admission and startup diagnostics

Source increment on `19f68b4` (2026-11-04). The earlier owner-reported alert and
hang remain unproven historical causes. The read-only investigation established
that an earlier reservation can block a new Core and that startup layers discarded
the reason. This increment corrects that source path without inspecting or changing
human runtime state, prior manifests, reservations or quarantine.

## Preparation and authority

`inspectDesktopAdmission` performs no mkdir, claim, Store open, PID probe or cleanup.
It reuses the canonical/private-owner/mode/ancestor/O_NOFOLLOW/bounded-read checks in
`terminalDirectory`/`terminalFile`. The latter can bind its opened descriptor to a
captured device/inode. The marker read has a 16 KiB budget; regular-file, single-link,
before/after inode/device/size/mode/uid/mtime/ctime and directory identity checks fail
closed. A missing directory is checked through its canonical private parent and is
not created. No manifest referenced by the marker is opened by the inspector.

For a new Core, an existing marker produces `admission_preflight/capacity_reserved`
before review, native commit or provisioning. Invalid or changed evidence reports
`admission_invalid`. Inspection is repeated around the commit boundary and before
fork. This is advisory absence evidence only: the Core still checks admission and
keeps its exclusive claim and pre-start owner checks against races. It never releases
or reconciles the previous reservation. The Electron pre-fork inspection also uses
the passive helper instead of constructing mutating admission as an inspection.

Append uses owner/epoch/initial files from the existing owned Core's inherited ready
and native `Running`, not a renderer boolean. Only that exact marker may coexist
with preparation. The new Core marker adds its epoch; legacy markers remain blocked
for new ownership and are never rewritten. Native snapshots include presentation,
layout revision and member count. The helper receives only the private native argv
context, never persisted launch authority. Native context is checked again after
helper waits and before dispatch; changed Core/presentation/enrollment fails closed.

After append dispatch, the consumer verifies owner, epoch, initial files and the
outstanding request ID **before** removing pending entries or changing latches.
Rejected/ready/timeout/late UI results cannot clear another operation or Core. A
successful authoritative receipt may advance member/layout revisions; it is not
rejected merely because it advanced the pre-dispatch snapshot. Existing slots and
uncertain reservations remain intact. Ready/admitted is not provider execution or
exit evidence.

## Bounded failure path

The inherited Core startup failure is `{type:'startup-failure',id,failure}`; the
native host stdout projection is `{kind:'failure',id,failure}`. The request ID is
native-owned (`startup-N`, bounded to 20 digits, or a UUID). Every ready/failure
must match it. `failure` contains exactly `stage`, `code`, `effects`. New stages:
`admission_preflight`, `core_admission`, `core_startup`. New codes:
`capacity_reserved`, `admission_invalid`, `startup_failed`, `startup_timeout`,
`startup_eof`, `startup_protocol`. No message text classification is used.

A proved pre-provision inspection can say `not_started`; native commit/open evidence
upgrades it to `possible`. Provision, unknown startup, EOF, malformed transport and
timeout always remain `possible`. Late ACKs do not downgrade effects, replay an
operation, materialize a timed-out member or release ownership. The Core stderr
remains ignored; stdout never includes raw exception messages or stderr.

Studio displays the localized reason and effects, with stage under optional details.
It receives completion without dismissing an error sheet. Native-menu error notices
are nonblocking. Completing transient `busy` does not reset committed/opened latches,
Core ownership, grants or uncertain attempts. Native review/Start approvals remain
unchanged; there is no new wizard, retry, adoption or recovery action.

## Security review

Only existing native argv, inherited Core IPC and helper stdout are extended. There
is no HTTP/WebSocket/cookie/static/CSP capability change. Private owner, epoch and
initial paths stay off Studio replies and logs; fixed failure enums are the only
new UI data. The private same-user boundary is not a sandbox against a malicious
same-user process. No new dependency or upstream implementation is incorporated;
see the [reference review](../research/terminal-admission-diagnostics.md).

## Verification boundary

The focused Node cases use disposable synthetic files, fake inherited IPC peers and
in-memory backends. `fork` is replaced for client handshake tests. No app, Core,
provider, PTY, probe, authentication database or human reservation is launched/read.
The standalone Rust tests execute the exact production identity gates without Tauri,
Cargo or a target directory. They test pre-dispatch Core/presentation/revision
changes and old results against a new owner/epoch/files/request ID. They do not
compile or validate the complete native shell.

Full app build, Cargo, resources, installation, native UI and provider acceptance
are excluded. This source increment cannot resolve the earlier reservation or
establish the historical cause of the owner's first alert/hang. The worktree must
remain preserved until root integrates it; no push or main mutation is performed.

Current source checks: 167 focused Node cases passed (the four private helper
subprocess cases are deliberately excluded by the name filter), plus 3 standalone
Rust identity-gate cases passed with `-D warnings`. Full workspace typecheck passed.
Full lint initially found two caught-error preservation violations in the inspector;
those branches now retain the internal caught error until the fixed outer boundary
projects it to an allowlisted refusal. No raw error is exposed. Final full lint/format passed after that correction. The first broader Node run caught an unnecessary change to the
helper's proven pre-provision effect classification; that change was removed while
retaining native commit/open promotion to `possible`. Final 167 cases pass without
relaxing the existing catalog/ownership assertions.

The native reader also takes its host atomically only when owner, epoch and initial
files still match that reader. Missing/incomplete identity fails closed. All shutdown
effects run after releasing the state mutex. The extracted `stop_running` body keeps
the original cleanup; explicit public Stop retains its intentional unconditional
take. A pure regression verifies replacement/absent/reinstalled hosts survive a late
EOF and current-host cleanup is consumed once. This fixes a demonstrated source
risk, not a proven cause of the historical hang.

## Combined source integration — 2026-11-04

This candidate is integrated with the UI-getter fix in `5e2b034`. The combined
187-case Node log includes four synthetic private helper subprocess tests despite
the requested negative-lookahead filter; the earlier exclusion statement above is
not established by that filter and is not relied on. No app/Core/PTY/provider or
real consent was exercised. See the [integration record](tauri-opening-source-integration.md)
for actual checks, conflict resolution, cleanup comparison and remaining logger,
package and native acceptance gates.
