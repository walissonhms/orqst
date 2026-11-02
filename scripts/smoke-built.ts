import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { once } from 'node:events';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import type { Snapshot, ModelAnalyticsSummary } from '@orqst/protocol';

/** Bounded smoke of the built application, using only disposable copies of real session data. */
export async function smokeBuilt(
  sessionsDir: string,
  dataDir: string,
  expectedSessions: number,
): Promise<void> {
  const port = randomInt(10000, 60000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['dist/bridge.mjs'], {
    env: {
      ...process.env,
      ORQST_PORT: String(port),
      ORQST_DATA_DIR: join(dataDir, 'built-smoke'),
      ORQST_CODEX_SESSIONS: sessionsDir,
      ORQST_DEV: '0',
    },
    stdio: 'ignore',
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    let ready = false;
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      if (child.exitCode !== null) throw new Error('Built bridge exited before validation');
      try {
        const bootstrap = await fetch(base + '/api/bootstrap', {
          signal: AbortSignal.timeout(1000),
        });
        const cookie = bootstrap.headers.get('set-cookie')?.split(';')[0] ?? '';
        const response = await fetch(base + '/api/snapshot', {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(1000),
        });
        const snapshot = (await response.json()) as Snapshot;
        if (snapshot.sessions?.length === expectedSessions && !snapshot.diagnostics.scanning) {
          assert.equal(snapshot.diagnostics.errors, 0);
          ready = true;
          break;
        }
      } catch {
        /* Startup can briefly refuse connections. Only aggregate readiness is inspected. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Built bridge did not finish bounded real-session discovery');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByRole('heading', { name: 'Your agents, in focus.' }).waitFor();
    await page.locator('.agent-cell').first().waitFor();
    assert.equal(await page.locator('.agent-cell').count(), expectedSessions);
    await page.locator('.agent-cell').first().click();
    await page.getByRole('region', { name: 'Session details' }).waitFor();
    await page.locator('.session-detail .timeline-event').first().waitFor();
    const response = await page.request.get(base + '/api/snapshot');
    assert.equal(response.status(), 200);
    // Exercise the colocated production worker bundle, not only the dev/tsx entry.
    const analyticsResponse = await page.request.get(base + '/api/analytics/models');
    assert.equal(analyticsResponse.status(), 200);
    const analytics = (await analyticsResponse.json()) as ModelAnalyticsSummary;
    assert.equal(analytics.contract, 'orqst.model-analytics');
    assert.equal(analytics.contractVersion, 1);
    assert.equal(analytics.coverage.sessions, expectedSessions);
    // No screenshots or captured conversation text are exported from this check.
  } finally {
    await browser?.close();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      timer.unref();
      await exited;
      clearTimeout(timer);
    }
  }
}
