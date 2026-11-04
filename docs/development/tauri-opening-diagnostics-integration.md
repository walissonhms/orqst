# Tauri opening diagnostics integration — 2026-11-04

This delivery combines published opening source `87a1872` (code `5e2b034`)
with original logger branch `fix/local-diagnostics-739`: `73bef77` (writer),
`d4a408b` (hooks) and `7d97db5` (documentation). Merge commits preserve those
originals. Abandoned candidates `7c2d38c` and `7957d9a` are not integrated.
The source delivery tag is `delivery/2026-11-04-tauri-opening-diagnostics-source`.
It identifies reviewed source, not runtime or provider acceptance.

## Review and security boundary

The source and pinned Anywh/Tucano implementations and LICENSE files were inspected
again; see the [component decisions and permanent source links](../research/local-diagnostics.md).
Anywh is pinned to `546f189c04415c3c5af5f40e3931a0a90b9aba31`, Tucano to
`0501956d127699300209902e889f3e69a0948766`. Both root Apache-2.0 LICENSE files
have SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`;
no upstream code, dependency or asset is added by integration.

Diagnostic queue admission uses `try_send`, never disk, a UI getter, an await or
an application mutex. An optional thread owns fixed local files and stops after
a disk error. Closed stage/outcome/effects enums cannot retain raw failure text.
There is no new HTTP/WebSocket, cookie, CSP or execution surface. Timestamps and
activity cadence remain potentially private. The UUID is correlation only.

Preparation's document/generation fences, metadata's exact pending-request Arc,
owner/epoch/files checks, native startup-N correlation and helper/host protocols
are preserved. The optional per-member tags are bounded by the existing eight-pane
ceiling and affect only diagnostic correlation. Host stream diagnostics cannot
attribute a later host-lifetime loss to a particular appended terminal. The bodies
of `stop_running`, public `stop` and `stop_and_wait` were compared byte for byte
with `5e2b034` and match. Keyed append/EOF ownership remains unchanged.

## Checks before the published freeze

Existing Node 24.22.2, pnpm 10.34.9 and Rust 1.99.1 were selected from the
coordinated toolchain. No dependencies, Node install or Cargo target were duplicated.
The integrated source passed full `pnpm lint`, `pnpm typecheck`, Rust formatting
and Git staged/unstaged whitespace checks. Thirteen focused Node test files passed
187 distinct cases, including four disposable helper Node subprocess tests and
the private-metadata namespace test. They do not start the product app, Core,
PTY, provider or real consent. See the [exact test scope](tauri-opening-source-integration.md#current-checks).

The standalone production-code Rust runners passed 21 distinct cases: 13 logger/
opening projection, 5 locks/metadata and 3 admission/EOF gates. Two new regressions
cover FIFO refusal without a reader and append failure preserving unrelated data.
The first FIFO harness spawned `mkfifo` concurrently with a lock-release test;
that run failed its immediate reacquire assertion, consistent with transient
fork inheritance of open descriptors. The corrected runner creates its two disposable FIFOs
before launching concurrent Rust tests, and the full 13-case rerun passed. No
production logger behavior changed. The FIFO case is explicitly ignored in Cargo
without these fixtures; the standalone runner includes and requires it.

```sh
pnpm lint
pnpm typecheck
pnpm exec tsx --test --test-reporter=spec tests/terminal-admission-inspection.test.ts tests/terminal-startup-failure.test.ts tests/terminal-selected-preparation.test.ts tests/terminal-enrollment-client.test.ts tests/terminal-team.test.ts tests/interactive-profile.test.ts tests/tauri-studio.test.ts tests/tauri-studio-preparation-ui.test.ts tests/tauri-terminal-preparation.test.ts tests/terminal-enrollment.test.ts tests/managed-terminal-pair.test.ts tests/feature-view.test.ts tests/tauri-terminal-layout.test.ts
node scripts/test-local-diagnostics.mjs
node scripts/test-tauri-ui-locks.mjs
rustc --edition=2021 -D warnings --test apps/tauri/src-tauri/src/terminal_admission.rs -o /temporary/directory/admission-tests
/temporary/directory/admission-tests
```

## Packaging boundary and consultation

Cargo/default and custom-protocol tests, all-target Clippy with warnings denied,
filtered dashboard build, resources and unsigned debug bundle are performed only
after publishing the source freeze, serially in `/tmp/orqst-691-target`. Actual
commands/results, native/resource hashes, source SHA, disk measurements and protected
app comparisons belong to the generated `build-manifest.json` beside the new app
in `dist/native-preview-opening-diagnostics/`. This source document does not claim
those later checks have already passed. A failing source check requires a new
published freeze before rebuilding. Root `pnpm build` is excluded because it cleans
shared dist. Existing previews and `ORQST Coexistence 698.app` remain protected.

Normal macOS log location for the configured Preview identifier:

```sh
tail -n 100 "$HOME/Library/Application Support/dev.orqst.desktop.preview/diagnostics/native.jsonl"
```

Search an exact diagnostic UUID across `native.2.jsonl`, `native.1.jsonl`, then
`native.jsonl`. Consult [retention and failure isolation](local-diagnostics.md):
three 1 MiB segments, 256 queued records, 512 bytes per record, directory 0700,
files 0600, best-effort tail loss and silent sink disable on failure. Existing
apps predate the logger; absence of logs cannot explain their history. No logs
are created by this packaging task because the app is not launched.

Full `pnpm test`, root build, browser tests and `validate:local` are not run for
this integration; ingestion is unchanged. No app/provider/Core/PTY launch, native
UI acceptance, consent or real reproduction is authorized here. The older global
reservation still prevents opening and is not reconciled, adopted, removed or
released by diagnostics. Terminal functionality and the cause of the historical
alert/hang remain unproved. Root decides the next acceptance step.
