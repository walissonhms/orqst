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
