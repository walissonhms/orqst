# Isolated browser test ports

Browser tests start their own synthetic fixture bridge and use unique temporary
storage. They never reuse an existing server (`reuseExistingServer: false`).
The default loopback port is 4318. To run alongside another test execution, first
check that a different port is free, then set the same port for the whole command:

```bash
lsof -nP -iTCP:4320 -sTCP:LISTEN
ORQST_BROWSER_PORT=4320 pnpm test:browser
```

An empty `lsof` result means no listener was found at that instant; Playwright still
refuses to run if another process acquires the port. Do not terminate an unrelated
listener or enable server reuse to bypass this check. `ORQST_BROWSER_PORT` is shared
by Playwright's base URL, readiness URL and fixture server. Only integer ports from
1024 to 65535 are accepted, excluding the production port 4317. Invalid values fail
before the fixture opens its port or storage.

Each invocation generates a unique temporary fixture-state path and disposable
source/database directories. Do not override `ORQST_BROWSER_STATE` to a shared path
when running concurrently. Production port configuration is unchanged.

## Settings and accessibility coverage

After `pnpm build`, run the focused shared-dashboard checks with:

```bash
pnpm test:browser tests/browser/settings.spec.ts tests/browser/shell-navigation.spec.ts
```

The synthetic Settings suite covers navigation, local preference restoration and
cross-tab updates, denied/malformed storage, offline controls, notification save
rollback, locale switching, reset confirmation/focus, OS and explicit reduced
motion, comfortable target sizes and viewport containment. It captures higher
contrast/comfortable layouts at 1440px, 1280px and 390px, including pt-BR mobile.
Images stay in generated test output. Inspect them for wrapping, control visibility
and focus; the automated checks do not establish manual screen-reader acceptance
or native Desktop/OS notification delivery. Ingestion and real session sources are
not changed by these UI preferences.

## Dashboard paths and draft history

After `pnpm build`, run the route and neighboring guard/preference coverage:

```bash
ORQST_BROWSER_PORT=4347 pnpm test:browser tests/browser/path-navigation.spec.ts tests/browser/artifact-navigation.spec.ts tests/browser/shell-navigation.spec.ts tests/browser/settings.spec.ts
```

The synthetic route suite covers direct entry/reload for all six exact paths,
legacy aliases without extra entries, root preference restoration, language,
same-document multi-entry Back/Forward, deferred source-backed session links and
invalid identities, canonical session encoding, address-bar fragment navigation
and inherited history indexes with duplicate popstate/hashchange delivery. Draft cases repeat cancellation in both directions, verify
exact text, confirm one traversal and retain the forward destination. Neighboring
suites cover pending saves, workspace/palette/notification guards, browser unload
warnings, offline and persisted preferences. No installed service, source sessions
or owner storage is used. Native window close/quit/reload protection and durable
draft recovery remain unimplemented; Chromium coverage does not establish other
browser or OS acceptance. `pnpm test` includes exact Bridge fallback and Electron
navigation/sender allowlist negatives; `pnpm test:desktop` uses a disposable native
profile and synthetic Bridge.

## Artifact source-library coverage

After building, run the source library and neighboring manual/draft/route coverage:

```bash
ORQST_BROWSER_PORT=4601 pnpm test:browser tests/browser/artifact-library.spec.ts tests/browser/artifacts.spec.ts tests/browser/artifact-navigation.spec.ts tests/browser/path-navigation.spec.ts tests/browser/shell-navigation.spec.ts
```

The library suite uses disposable synthetic observations. It checks actual retained-message
extraction through the existing panel, loaded-text search, source identity/retention errors,
older pagination, workspace/session scope and obsolete requests, explicit capacity,
failure/offline recovery, draft guards and localized containment/screenshots in dark/light
at 1440/1280/390/320px with maximum reading sizes. Node cases cover source admission,
UTF-8 limits and malformed/unordered/cross-session pages. These do not establish full-archive
search performance, other browsers, manual screen-reader or native Desktop visual acceptance.
