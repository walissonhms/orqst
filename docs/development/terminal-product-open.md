# CLI → model → Open, first increment

This source increment removes Finder from the normal Tauri Studio creation path.
Select an existing workspace in the single Studio sidebar, choose **+ Terminal**,
then choose Codex, Claude Code or OpenCode and a concrete catalog option. **Open**
uses the existing native preparation host with the bundled Node 24. The renderer
supplies workspace/Feature IDs and opaque catalog/model IDs, never launch paths.
The owned observer SQLite resolves the project and the existing preferences store
validates Feature scope. Native configuration/CLI cache/official aliases are
identified honestly; availability and authentication remain unverified until the
CLI itself runs. There is no automatic provider probe, login, task or model fallback.

The first native review describes the concrete configuration, selected model,
workspace and shared native effects, and provisions only that reviewed selection.
The retained terminal document then presents the operational **Open** confirmation:
start this exact profile, attach its output and enable keyboard input. Each of
those effects still needs its own one-shot signed Core challenge. This consolidates
the old manual Start → attach → input chain without approving a hidden runtime
request. Cancel remains the default. The **Advanced · folder and executable**
disclosure retains the legacy explicit Finder wizard, independently of the normal
catalog path. Legacy/Electron Start continues to grant startup only.

The native automatic-opening intent is single-use, bound to the selected profile,
terminal document generation, presentation epoch and a 60-second monotonic deadline.
The intentional Studio → terminal transition records it after the existing
presentation fence; obsolete layout messages cannot restore it. Real blur,
deactivation, reload, dashboard navigation or Quit consumes it. Both focus awaits
revalidate the captured epoch before dispatch. An invalidated intent is never
rearmed automatically. A later explicit Open requires a fresh native review.

If launch may have occurred but output/input or the final snapshot fails, the
broker returns the attempt ID with `opening: incomplete`, even without a snapshot.
The xterm renderer retains that ID, blocks another Start and offers connection for
that same instance once its real state is available. It never signals, adopts or
retries the process. Successful composed replies connect real xterm output and
keyboard. Hide, detach and terminate remain separate operations.

## Explicit remaining product gap

This first increment still admits only one selection per app launch. **A second

- Terminal with another CLI/model while the selected host exists is not supported.**
  The UI states this limitation; it is not complete delivery of independent V6
  terminal creation. `State.begin`, `is_running` and the durable selection latch stay
  closed. Their removal alone would bypass ownership rather than add enrollment.

The next required increment must append a reviewed member to the existing Pair,
admission reservation, private RPC/client, terminal service, retained native
vectors/documents and layout. It needs a selection epoch, CAS revision, operation
ID and durable ready/rejected/uncertain receipt; admission itself must grant no
Start/output/input authority. A partial admission preserves its slot/reservation
and all old processes. Existing documents must not reload and no second Core is
created. These are integration requirements, not APIs claimed by this increment.

## Verification

All checks use isolated source and in-memory synthetic facades. The owner's open
Preview, active dist, runtime/data, providers and quarantines are untouched.

- `pnpm lint`, `pnpm typecheck` and `git diff --check` passed on final source.
- 54 focused Node cases passed: broker, service, document and Studio contract.
- `accept-studio-preparation.ts --authorize-synthetic-studio-ui` passed EN/PT,
  scoped provider/model selection, unavailable catalog, no mutation retry,
  one retained workspace/sidebar, Escape/focus restoration and widths down to 320px.
- `accept-terminal-open-renderer.ts --authorize-synthetic-terminal-renderer`
  passed EN/PT using actual xterm with a synthetic native facade, output/keyboard
  and partial-attempt continuation, without repeated Open/Start.
- Rust source was formatted. New source tests cover catalog bounds/official aliases,
  intent invalidation before/during focus, expiry and late partial replies.
  Cargo tests/clippy/build were not run: available space fell below the coordinated
  4GiB margin. No resource staging or new target/runtime was started.

The renderer scripts run headless Chromium without a Core, host, PTY, native app or
network server. To reuse existing compiled CSS without rebuilding the active app:

```sh
ORQST_STUDIO_CSS_DIR=/absolute/read-only/dashboard/dist/assets pnpm exec tsx scripts/accept-studio-preparation.ts --authorize-synthetic-studio-ui
pnpm exec tsx scripts/accept-terminal-open-renderer.ts --authorize-synthetic-terminal-renderer
```

Full test/build, native WebKit/ACL/focus/dialog acceptance, provider entitlement,
real model application/readiness, packaging and the second-terminal workflow are
not validated by renderer or pure tests. The first xterm regression exposed a
serialized test helper and a camel-case HTML data-attribute lookup; both were
corrected without weakening the runtime assertions.
