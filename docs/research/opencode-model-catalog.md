# OpenCode model catalogue and native consent review — 2026-11-04

Base `df0da2c` plus the accepted Codex catalogue fix `4eeeea2` (published in
`7bfdca3`, packaged at `f056c3a`). Reuse-first review for the two reported
problems: OpenCode offering only “CLI default”, and oversized native macOS sheets
when opening a terminal. No provider process, server, Core, PTY, app, auth
database or native UI was executed for this increment.

## Reusable candidates inspected at fixed revisions

| Candidate                          | Exact source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | License                                     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode model preference document | [`packages/tui/src/model-preference.ts`](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/tui/src/model-preference.ts), `ModelPreference`, `decodeModelPreference`, `models`, `variants`, `modelPreferenceKey`, `recentModels`, `normalizeModelVariant`; path built by [`context/local.tsx`](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/tui/src/context/local.tsx) `createModelPreferenceRepository(path.join(paths.state, "model.json"))`; roots in [`packages/util/src/global-roots.ts`](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/util/src/global-roots.ts) `roots`; duplicated for headless use in [`packages/cli/src/mini-host.ts`](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/cli/src/mini-host.ts) | MIT, no NOTICE file at this pin             | **Adapt (bounded subset).** Reimplemented in ORQST's existing bounded passive reader: `decodeOpenCodeState`/`openCodeStateDigest` in `packages/core/src/terminal/model-selection.ts`. Only the preference schema, key form and variant normalisation were reused; the Effect/Flock/watcher repository was not. Attribution is kept in the source comment.                                                                                                                                                                                                |
| OpenCode interactive model list    | [`packages/cli/src/commands/handlers/models.ts`](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/cli/src/commands/handlers/models.ts) (`ServerConnection.resolve()` then `client.model.list({location:{directory}})`), [`services/server-connection.ts`](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/cli/src/services/server-connection.ts) `resolve`, `resolveManaged`                                                                                                                                                                                                                                                                                                                                                                                                                                        | MIT                                         | **Do not use passively.** `models` requires a resolved endpoint: an existing background service or `Service.ensure`, i.e. a server lifecycle with migrations, credentials and persistent state. Calling it from discovery would be a probe that starts a server. Contract for a consented path is below.                                                                                                                                                                                                                                                 |
| OpenCode models.dev cache          | [`packages/core/src/models-dev.ts`](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/core/src/models-dev.ts) `cacheKey` (`models-dev:v2:catalog`), `Cache`; [`packages/core/src/kv.ts`](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/core/src/kv.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | MIT                                         | **Do not use.** The cache is a row in provider SQLite shared with sessions/credentials; reading it means opening the provider database. No safe guessed JSON path exists.                                                                                                                                                                                                                                                                                                                                                                                |
| Tucano OpenCode V2 engine          | [`src/core/engines/opencode-v2.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/engines/opencode-v2.ts), `opencodeV2Env`, `startServer`, `opencodeV2Args`, `mcpReady`, `runOpencodeV2`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Apache-2.0, root LICENSE, no tracked NOTICE | **Adapt only behind the consented path below.** Its proven pattern — private `opencode serve --port 0` on loopback, own `XDG_CONFIG_HOME`/`XDG_STATE_HOME`, private password, `SIGTERM`→`SIGKILL` stop, session delete in `finally` — is exactly the ownership discipline a model probe needs. It is a _turn_ driver, though: no model listing, and it deliberately isolates config while keeping the person's data dir (auth). Not copied into this increment because ORQST forbids creating a parallel provider server without explicit authorization. |
| Anywh                              | `546f189c04415c3c5af5f40e3931a0a90b9aba31`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Apache-2.0, no tracked NOTICE               | **No OpenCode driver exists at this pin** (`relay/src/runtimes/defs` covers Codex and Claude only). `probeModelCatalog` is a process probe, not a passive reader. Nothing to reuse for OpenCode; the earlier picker audit remains valid.                                                                                                                                                                                                                                                                                                                 |

Concrete incompatibilities, not preferences:

1. `opencode models` cannot be described as a passive read. `ServerConnection.resolve`
   either discovers a running background service or ensures one, verifying version and
   applying startup effects. A “cheap” probe here would contradict
   `docs/development/opencode-startup-safety.md`.
2. Tucano's own harness keeps the person's data directory on purpose, so a discovery
   server started by ORQST would share native login and SQLite with the person's
   sessions. Making that acceptable needs an explicit consent, an ownership receipt and
   a guaranteed single-flight stop, not a read-only facade.
3. Anywh has no OpenCode runtime, so its launcher/catalogue code cannot supply real
   OpenCode model identifiers.

## What “only CLI default” actually was

`discoverTerminalModels` read two sources for OpenCode: the native `opencode.json`/
`opencode.jsonc` `model` (string or V2 object) and `providers.*.models` (plus the
migrated legacy `provider.*` map). A person who never wrote those keys — the normal
case, since OpenCode stores the chosen model in its own state, not in config — produced
exactly one option: `cli-default`. The label was correct; the catalogue was incomplete,
and nothing told the person why.

The fix reuses OpenCode's own preference document. `favorite`, then `recent`, then
saved `variant` keys become real `provider/model[#variant]` choices with
`source: 'native-state'` and `availability: 'unverified'`. Availability is never
claimed: the CLI resolves login and entitlement at startup.

## Consented dynamic catalogue — contract, not executed

Authorizing this needs no new runtime if it reuses the existing signed native
confirmation and Core ownership. The concrete contract proposed to the root:

- **Trigger**: an explicit person action in the Studio panel (_Load all models_), never
  during discovery, refresh or repair. No automatic retry.
- **Process**: one disposable private server per attempt via the reviewed 2.2.5 binary,
  `serve --hostname 127.0.0.1 --port 0`, own `XDG_CONFIG_HOME`/`XDG_STATE_HOME`/
  `XDG_CACHE_HOME` (adapting Tucano `opencodeV2Env`), the person's data dir retained for
  authentication, a per-attempt random password in the environment only.
- **Effects disclosed before start**: a provider server starts, native database
  migrations may apply, native config/agents/plugins/MCP may load and may incur
  activity or cost, the person's login is shared, the process is ORQST-owned.
- **Bounds**: 20 s startup, one concurrent probe, ≤ 128 models, no stdin prompt, no
  task, no provider turn.
- **Ownership**: ORQST kills only the PID it spawned (`SIGTERM`, then `SIGKILL` after
  2 s), never a discovered background service, never a person's own `opencode` process.
  Uncertain startup stays recorded, is never adopted and never retried automatically.
- **Output**: `provider/model` strings only, mapped into the existing catalogue with
  `availability: 'unverified'`; no credentials, prices, identities or raw stderr.
- **Refusal**: cancelling consent, a failed health response or a version mismatch leaves
  the passive catalogue exactly as today.

Until the root authorizes that scope (`apps/tauri` signed confirmation + Core-owned
child process + receipt), no probe is attempted and the UI keeps saying the catalogue is
partial.

## Native sheet size — root cause

`terminal_creation.rs` built one AppKit sheet as `message` + `\n\n` + `detail`, where
`detail` was the complete compact review JSON of the plan (`plan.pages`, capped at
4096 characters per page; the pair produced two such sheets). One click therefore
opened a sheet containing ~4 KB of single-line JSON plus a ~500-character consent
paragraph — the “huge native alert” the person reported. The failure sheet had the same
shape, with four labelled lines including stage and reason.

Current behaviour: the selected/pair consent sheet carries the localised effects text
only; the failure sheet carries one outcome sentence plus one reason sentence. The
complete configuration is written to each terminal's `terminal.json` (owner-only,
`0600`) inside the private managed root before the separate Open review, so it stays
inspectable without a multi-kilobyte modal. Stage detail remains in the in-window
notice. Nothing about focus, generation, commit latch, grants, revalidation, receipts or
the Open confirmation changed, and no information about startup, shared native
identity or MCP was removed from the consent text.

The pair now has one consent sheet instead of one sheet per configuration page:
`cancel-second` coverage became redundant with `cancel` and was replaced by an exact
assertion that a pair performs exactly one `mcpPair` confirmation.
