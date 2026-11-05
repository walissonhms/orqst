# Tauri Studio preparation contract

The owned dashboard receives `window.orqstTauriStudio` (`contractVersion: 1`).
It is separate from the unchanged Electron `window.orqstStudio`. The only native
command is `studio_request`; it is not a Bridge HTTP/WebSocket or Core RPC endpoint.

The strict public request union is:

```ts
{ action: 'snapshot' }
{ action: 'catalog', workspaceId: string, featureId: string | null }
{ action: 'create-selected', generation: number, workspaceId: string, featureId: string | null, catalogId: string, provider: 'codex' | 'claude' | 'opencode', modelId: string, count: number }
{ action: 'create', generation: number, provider: 'codex' | 'claude', count: number }
{ action: 'review', generation: number }
```

Generation is a nonnegative safe integer from the latest native snapshot. Count is
an integer 1–8. The normal drawer creates one selected member. Catalog/model IDs
are scoped hex64 digests; `catalog` is passive and returns `{status:'catalog',catalog}`
using the [shared catalog contract](terminal-preparation.md). Native argv4 supplies
only the owned observer database and private preferences directory. No project or
executable path comes from JavaScript. There is no mixed preset, custom limit,
task, prompt or login action. Additional properties are rejected. In
particular no paths, files, PID, proof, source or arbitrary Core method is accepted.
`review` uses only the native state's already prepared files. `create` uses native
pickers and the bundled Node 24, then runs the exact existing menu wizard.

Reply: `{status, snapshot?}`. Status is `ok`, `denied`, `focus_required`, `busy` or
`unavailable`. The snapshot contains only `generation`, `limit: 8`, `count` (0–8),
`busy`, `canCreate`, `canReview` and `selectionLocked`. It reveals no paths or
execution authority. `selectionLocked` means opening was attempted or a selected
host exists, including uncertainty; it does not prove a CLI started or succeeded.
Cancelling opening retains prepared files and permits another explicit review.
An uncertain write blocks creation; an opening attempt blocks fresh selection for
this application lifetime, including after retirement.

## Security review

- Capability is remote-only for exact owned loopback origin at `/` and `/studio`,
  with only `allow-studio-request` on actual `main` Webview. No shell/filesystem/
  dialog plugin capability, wildcard window permission or renderer-supplied identity.
- Native command checks the invoking Webview and its parent, actual URL/origin,
  exact supported document path, absent credentials/query/fragment, and native
  generation. Mutations reuse the AppKit first-responder check; the full context is
  checked again after that await and at atomic admission. JS activation is only
  defense in depth; read-only snapshot/catalog calls require no click.
- The menu and command share a single preparation latch. The fixed helper retains
  its existing bounded pipe, native pickers, Cancel-default configuration review,
  shared-effects acknowledgment, complete opening review and five-minute expiry.
  Native document reload/destruction/close, any Quit attempt and another owned window revoke the
  generation. The existing AppKit observer now also revokes preparation on actual
  deactivation/another key window while preserving the exact active main own-sheet.
- `presentation_blocked` and `is_running` fence pending Quit/selected-host states;
  the existing selection latch is set before Core admission. Core remains the sole
  owner of journals, signed start/input/MCP/retirement and process evidence.
- Accepted native work retains completion ownership even if its invocation future
  disappears. No automatic retry, adoption, reconciliation, deletion or uncertain
  capacity release is introduced. The renderer ignores late/unmounted replies and
  does not let own-sheet focus refresh replace an in-flight mutation result.
- Bridge HTTP/WS/cookies/Host/Origin/CSP, source ingestion, credentials and public
  observer APIs are unchanged. Existing uncertain fixtures and evidence remain intact.

The renderer component is `TauriStudioPreparation({native?: TauriStudio})`; it can
mount in the Studio preparation drawer. It has no Feature workspace/sidebar,
terminal renderer, CSS layout or process ownership. Without the facade its controls
stay unavailable. User-agent detection may select truthful explanatory text, never
a capability. Tauri must not display Electron's mixed Codex/OpenCode controls or
its older-Desktop/relaunch warning.

Native WebKit/own-sheet execution, provider behavior, final Quit and platform
packaging acceptance remain separate from pure/renderer checks.

## Selected operational opening

`create-selected` uses no picker. Its one native provisioning/selection review
precedes a distinct exact operational Open review in the dedicated terminal
document. The additional `terminal_open_prepared` command is granted only to
`terminal-*`, never the dashboard. It accepts no arguments. Native-held profile,
document generation, presentation epoch and 60-second deadline are captured before
focus awaits and checked again before the one-use dispatch. Revocation consumes
the intent, with no automatic rearming. The [broker contract](terminal-operational-open.md)
retains three independently signed grants and incomplete attempt identity.

Current source still fences fresh selection while a host exists. A second
independently chosen terminal requires live enrollment into the same Core; it is
not implemented or accepted by this increment. See [workflow and checks](../development/terminal-product-open.md).

## Passive admission and startup failure extension — 2026-11-04

The public request union is unchanged and rejects owner/epoch/files/Core context.
Native argv5 alone supplies optional `{owner,epoch,initialFiles}` from the current
owned Core. The inherited ready additionally binds `id`, `admissionOwner` and
`initialFiles`; none of these private fields is forwarded to Studio. New failure
stages/codes and effect rules are specified in the
[admission diagnostic contract](../development/terminal-admission-diagnostics.md).
Previous reservations require evidence-backed review, never automatic clearing.
Studio uses its existing in-window notice with optional stage details; native-menu
error notices are nonblocking. Completion only releases transient busy state, not
uncertain commit/open/ownership latches. No new renderer capability is introduced.

## Native document wait ownership — 2026-11-04

Preparation and Feature document identity snapshot native state before UI getters,
release application mutexes for the wait, then revalidate source/version. Feature
replies retain Core epoch, presentation/document and exact request ownership checks
before consumption. This adds no renderer authority or public fields. See the
[combined source review and native limits](../development/tauri-opening-source-integration.md).

A catalog scope mismatch detected by the renderer shows a local denial notice.
Native guard diagnostics use closed, sanitized outcomes and do not accept renderer reports.

The native preparation boundary can return `rate_limited` without starting a
helper or applying an action. Equal admitted in-flight catalog requests for the
same scope and native generation share the result. See the [admission limits and
diagnostic behavior](../development/local-diagnostics.md#renderer-admission-and-lock-test-limitation).
