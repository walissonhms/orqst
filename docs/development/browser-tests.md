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
