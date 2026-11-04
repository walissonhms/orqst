# OpenCode catalogue and native consent delivery — 2026-11-04

Source-only increment on top of the accepted `4eeeea2` (published in `7bfdca3`).
No provider, CLI, probe, server, Core, PTY, packaged app, native UI or auth database
was executed. All checks below ran in this worktree, on Node 24.22.2 / pnpm 10.34.9,
with dependencies linked offline from the existing store.

## Implemented

1. **OpenCode offers the models the CLI already recorded.** Existing OpenCode config
   models stay authoritative; `favorite`, `recent` and saved `variant` entries from
   `<XDG_STATE_HOME|~/.local/state>/opencode/model.json` add real
   `provider/model[#variant]` choices with `source: 'native-state'` and
   `availability: 'unverified'`. Decoder bounds: 64 + 64 entries, 160-character ids,
   160-character variants, existing 128-option catalogue cap, existing 2 MiB file cap.
   The decoder is a bounded adaptation of OpenCode's own MIT `decodeModelPreference`
   (`9bbb8ce`); see [reuse audit](../research/opencode-model-catalog.md).
2. **No false invalidation from a preference log.** A `native-state` selection binds
   only the chosen reference (`provider`, `model`, `variant`) — the same invariant the
   accepted cache fix established. Another OpenCode session rotating its recent list,
   editing a different entry or saving another variant does not invalidate the chosen
   option. Removing the chosen entry does: re-resolution returns no option, so the
   request is refused at `selection` with `selection_unavailable` and zero effects.
3. **Native sheets are short.** The selected and pair consent sheets carry the
   localised effects text only (`detail` empty); the failure sheet carries one outcome
   sentence and one reason sentence. The complete configuration remains inspectable in
   the written `terminal.json` (owner-only) and the Studio Advanced section says where.

## Not changed

Focus/document/generation fences, the commit latch, `effects` accounting, grants,
revalidation before commit and again before provision, receipts, the separate Open
confirmation, the executable pins, and the existing manifest/IPC/UI contracts. No new
dialog, window, action or runtime was added. No credentials, auth files, provider
databases or captured content are read; the preference document is metadata only.

## Checks actually run

| Check                                                                                                                                                                                                       | Result     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `pnpm exec tsc --noEmit`                                                                                                                                                                                    | pass       |
| `pnpm exec tsx --test tests/terminal-selected-preparation.test.ts`                                                                                                                                          | 80/80 pass |
| `pnpm exec tsx --test tests/terminal-model-selection.test.ts tests/terminal-creation.test.ts tests/tauri-studio-preparation-ui.test.ts tests/tauri-studio.test.ts tests/terminal-mcp-pair-contract.test.ts` | 32/32 pass |
| `pnpm exec tsx --test tests/locales.test.ts tests/tauri-studio-preparation-ui.test.ts`                                                                                                                      | 2/2 pass   |
| `pnpm exec eslint` on every changed TypeScript file                                                                                                                                                         | pass       |
| `pnpm exec prettier --check` on every changed file                                                                                                                                                          | pass       |

Not run, deliberately: `pnpm build`, packaging, `cargo`/Clippy (no Rust toolchain in
this environment, so `rustfmt` also could not be executed), and the full repository
test/lint sweep — root owns integration and package. The Rust edit is limited to two
allow-list entries, one alert body composition and one empty-detail branch; it is
reviewed but not compiled here.

## Evidence distinctions

- **Synthetic fixtures**: every test above. The OpenCode preference document is written
  by the test into a temporary home; no CLI is started.
- **Real CLI**: none started. The reviewed OpenCode 2.2.5 binary is used only as a hash
  fixture.
- **Real provider / effective model**: not verified. `availability` stays
  `'unverified'`; nothing claims entitlement, login or that the CLI honoured the
  requested model.
- **Native UI**: not observed. Sheet size is proven by the source and by tests asserting
  that the confirmation receives an empty `detail`; the visual result in a packaged app
  still needs packaged acceptance.

## Remaining limits

- The passive catalogue is still incomplete by design. A person whose preference
  document is empty sees only `cli-default`, and the panel keeps saying the catalogue
  was limited.
- The consented dynamic probe (private disposable `opencode serve`, adaptation of
  Tucano `0501956`) is specified and _not_ implemented; it needs the root's
  authorization for provider startup ownership, as recorded in the reuse audit.
- The legacy native menu wizard (`prepare-*`, `review`) still reviews its page content
  verbatim. Only the normal CLI → model → Open flow was shortened.
