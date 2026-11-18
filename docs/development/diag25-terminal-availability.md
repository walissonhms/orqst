# Studio terminal availability and opening

The catalog distinguishes a missing launcher, a failed executable inspection, a
binary outside the reviewed checksum policy, an ambiguous executable, and a
limited model source. For Codex, both reviewed cache versions (0.162.1 and
0.169.0) use the same version-bound digest and five-minute expiry. Explicit
model references describe reviewed local observations. The CLI establishes
effective model selection and account access.

When no managed Core is attached, a scoped catalog read can recover the saved
active Feature. The catalog's optional `restoredFeature` carries the Feature ID,
name and saved member IDs. Open sends the resolved Feature ID and catalog ID
back through normal native generation and scope checks. The helper rejects a
changed view revision, Feature membership, or selected executable/model
evidence. The compact picker sends the reviewed CLI-default ID as well as
explicit model IDs. A refusal with no possible effects can refresh the picker
for a new explicit selection.

The saved member list distinguishes a closed slot in the current Core from a
saved ID without a matching slot. The latter carries no verified process
status. Remove from view affects presentation in the current component and
can be undone with Show hidden terminals. Reopen starts a separate terminal
through the reviewed picker and the usual capacity limits. Saved
assignments, journals, exit markers and reservations are retained.

A Tauri batch takes the native commit latch once and checks the participating
catalog entries after that round trip. It checks context, admission and bound
model evidence at each write. The first write for each executable in the
batch rehashes it. Later writes verify the canonical file's metadata before
reusing the digest within that helper. Core admission and PTY launch still
verify the manifest, executable and the signed, one-use start/attach/input
challenges. Native focus is checked in dispatch before the pipe write and
again before returning opening privileges.

The local diagnostic records distinguish a catalog response, native request
refusal, the write latch, Core admission and per-pane `cli_opening`. Batch
acceptance describes Core enrollment. Use `cli_opening: ready` for the signed
CLI opening path and correlate by attempt. An attempt with no opening markers
cannot establish a CLI preparation or provider startup duration.

## Reproducing the preparation measurement

Run the patched benchmark script from each checkout's working directory
with the private Node 24 toolchain:

```sh
pnpm exec tsx /path/to/fix/scripts/benchmark-native-opening.ts 3 --batch-preparation
```

The mode creates four disposable Codex fixture manifests. Median helper reply
was 579 ms on the diag25 source and 303 ms with this change. The post-commit
portion was 417 ms and 139 ms, respectively. Full-hash work fell from 1,068 to
427 MiB. Catalog median was 188 ms and 187 ms respectively. These measurements
cover preparation under a synthetic HOME on macOS. Native presentation, PTY
startup and real provider readiness need their own trace.

## Reference review

- Anywh's Apache-2.0 terminal uses `node-pty` with a named tmux session for
  process retention. ORQST keeps its existing signed PTY ownership and
  SQLite-backed Feature membership. See the pinned
  [terminal source](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/relay/src/host/terminalSession.ts)
  and [license](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/LICENSE).
- Tucano's Apache-2.0 Codex engine uses an isolated HOME with a separate login
  and passes provider configuration on its own execution path. The passive
  ORQST picker keeps its existing reviewed local metadata contract. See the
  [engine](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/codex.ts)
  and [license](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE).
- The [Overclock product reference](https://overclock.sh/en) shows visible panes.
  ORQST retains the existing V6 layout and uses the existing Studio picker.
