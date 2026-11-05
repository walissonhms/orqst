# Cross-boot recovery delivery — 2026-11-04

The final implementation is `7ae5d1892b75fd5499fdbad3aead3784b43b0b82`, parent
`0622fca4ba422805bb97d697cdc2f412a1d37faf`, fast-forwarded from
`dbf92ca284b4192d86511f1443253c57265f282d`. The independent source review accepted
that exact implementation. No replay or diagnostic-only `bc50878` integration was
needed. Rust and the launch/claim contracts are unchanged.

The delivery tag `delivery/2026-11-04-offline-cross-boot-release-source` identifies
the frozen source including this documentation. Publish main, that tag and the
original `fix/offline-cross-boot-754` / `fix/offline-finalize-physical-pin-755`
branches atomically before packaging. A build correction requires a separate commit
and a new published freeze; never suppress checks or overwrite the delivery tag.

The existing Core authenticates signed historical evidence and declares the exact
current physical difference for fresh administrative approval. It does not certify
volume continuity. Finalization pins the released physical records before final
approval and rename, refusing a second device generation. The original marker
remains until commit; future-owner controls remain protected. See the
[contract and pinned reuse research](../research/offline-cross-boot-admission.md).
No upstream code or dependency is incorporated.

## Actual source verification

The integrating pane reran all 295 focused synthetic cases in offline recovery,
terminal journal/enrollment, Tauri preparation, helper wire and arguments, plus
full `pnpm lint` and `pnpm typecheck`: all passed on Node 24.22.2/pnpm 10.34.9.
Independent review separately reported 7 adversarial and 9 independent cases;
those are inherited review evidence, not integrator reruns.

The earlier package reported 97 passing Rust cases and one explicit FIFO fixture
ignore in each mode. That is inherited evidence on unchanged Rust, not a current
run. Current build, Cargo and signature results belong only to the new ignored
package's `build-manifest.json` and `verification-logs`. Full `pnpm test`, root
`pnpm build`, browser, ingestion and native/provider acceptance are not claimed.
Root build is excluded because it clears `dist` containing an active Preview.

## Packaging and operator boundary

Use the existing filtered dashboard build and `scripts/build-tauri-resources.mjs`,
then custom-protocol debug app bundling with CI and locked/offline Cargo. Use one
coordinated target `/tmp/orqst-691-target`, one job, no incremental compilation and
reduced debug symbols. After the reboot the old 676 temporary Rust tree was absent;
Rust/Cargo 1.99.1 was restored in the existing private 693 toolchain/cache. The
Node 24.22.2 official source-tag LICENSE matches the preserved bundle's license.
Do not change system toolchains or dependencies.

The new local destination is `dist/native-preview-cross-boot-release`. Keep every
older app intact and compare recursive inventories before/after. Sign only the new
outer app ad hoc, preserving the Node Developer ID signature; verify deep/strict
and compare every configured resource with staging. Record source, executable,
helper, Node, licenses and inventory hashes in the ignored manifest. A packaged
Preview is not native acceptance and must not be launched by the integrator.

Root 676 owns existing-instance preflight and human acceptance. Launch the new
executable with **only** `--offline-recovery`; the already authenticated durable
bundle contains its evidence. Do not supply an external capsule flag, install a
new anchor, capture a new bundle or reboot again for this delivery. In the existing
post-capture boot, explicitly select the exact durable bundle, review and approve
release preparation, then separately review and approve final administrative
release commit in that same boot. Each approval binds current facts and consumes
its own bounded grant. Stop on refusal or uncertainty; preserve all partials and
proofs. This is operator guidance, not execution or consent.

No real AppData, reservation, capsule, anchor, auth/config/key content or provider
state is part of integration/packaging. No application, Core, PTY or provider is
launched, signalled, adopted or retried. Normal Open remains a later distinct human
action with the existing authority checks.
