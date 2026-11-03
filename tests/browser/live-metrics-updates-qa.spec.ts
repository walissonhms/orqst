import { test, expect, type Page } from '@playwright/test';

// Independent QA for the confirmed-update highlight. Synthetic metrics only.
const sessionId = 'synthetic-browser-session';
const hash = 'a'.repeat(64);

const metrics = (
  sequence: number,
  usage: { input: number; output: number; cached: number; total: number },
  occurredAt = '2026-11-02T12:00:00.000Z',
) => ({
  availability: 'available',
  value: {
    contract: 'orqst.live-metrics',
    contractVersion: 1,
    identity: {
      sessionRef: {
        machineId: 'synthetic-machine',
        adapterId: 'codex',
        nativeSessionId: sessionId,
      },
      agentId: 'synthetic-agent',
      sourceWorkspaceId: 'synthetic-workspace',
    },
    usage,
    usageKind: 'session_cumulative',
    normalization: 'codex_session_snapshot',
    fieldPresence: 'not_preserved',
    evidence: {
      kind: 'compact_evidence',
      eventId: `event-${sequence}`,
      sequence,
      occurredAt,
      observedAt: { availability: 'unavailable', reason: 'not_recorded' },
      sourceVerification: 'not_rechecked',
      source: {
        file: 'synthetic/metrics.jsonl',
        offset: 1,
        line: 1,
        hash,
        recordType: 'token_usage_record',
      },
      turnId: null,
      responseId: null,
    },
  },
});

interface Harness {
  set(payload: unknown): void;
  header: ReturnType<Page['locator']>;
}

async function harness(page: Page): Promise<Harness> {
  let payload: unknown = metrics(1, { input: 100, output: 20, cached: 40, total: 120 });
  await page.route('**/api/sessions/*/metrics', (route) =>
    route.fulfill({ json: payload, headers: { 'content-type': 'application/json' } }),
  );
  await page.goto(`/#session=${sessionId}`);
  await expect(page.getByRole('region', { name: 'Session details', exact: true })).toBeVisible();
  const header = page.locator('.session-detail > .live-metrics');
  await expect(header.locator('.live-metric-values strong').first()).toHaveText('100');
  return {
    set(next: unknown) {
      payload = next;
    },
    header,
  };
}

test('a real newer reading highlights only the changed fields and then settles', async ({
  page,
}) => {
  const app = await harness(page);
  const header = app.header;
  await expect(header.locator('.live-metric-updated')).toHaveCount(0);

  app.set(metrics(2, { input: 150, output: 25, cached: 40, total: 175 }));
  await expect
    .poll(async () => header.locator('.live-metric-values strong').first().innerText(), {
      timeout: 12000,
    })
    .toBe('150');

  // input, output and total changed; cached did not.
  await expect(header.locator('.live-metric-updated')).toHaveCount(3);
  await expect(header.getByText('Confirmed value updated')).toHaveCount(3);
  await expect(header.locator('.live-metric-values strong').nth(2)).not.toHaveClass(
    /live-metric-updated/,
  );
  // Values are always the confirmed snapshot, never an intermediate count.
  await expect(header.locator('.live-metric-values strong').nth(3)).toHaveText('175');

  // The cue is brief and clears itself.
  await expect(header.locator('.live-metric-updated')).toHaveCount(0, { timeout: 5000 });
});

test('identical polls and an older replay never highlight', async ({ page }) => {
  const app = await harness(page);
  const header = app.header;
  await expect(header.locator('.live-metric-updated')).toHaveCount(0);

  // Same reading observed again: no cue.
  await page.waitForTimeout(5200);
  await expect(header.locator('.live-metric-updated')).toHaveCount(0);

  // Advance once, then replay an older sequence: the hook rejects it, no cue, values stay.
  app.set(metrics(2, { input: 150, output: 25, cached: 40, total: 175 }));
  await expect
    .poll(async () => header.locator('.live-metric-values strong').first().innerText(), {
      timeout: 12000,
    })
    .toBe('150');
  await expect(header.locator('.live-metric-updated')).toHaveCount(0, { timeout: 5000 });
  app.set(metrics(1, { input: 100, output: 20, cached: 40, total: 120 }));
  await page.waitForTimeout(5200);
  await expect(header.locator('.live-metric-updated')).toHaveCount(0);
  await expect(header.locator('.live-metric-values strong').first()).toHaveText('150');
});

test('disconnection clears the cue and equal recovery does not replay it', async ({ page }) => {
  let blocked = false;
  let socket: { close: () => Promise<void> } | undefined;
  await page.routeWebSocket(/\/ws/, (route) => {
    if (blocked) {
      void route.close();
      return;
    }
    socket = route;
    route.connectToServer();
  });
  const app = await harness(page);
  const header = app.header;
  app.set(metrics(2, { input: 150, output: 25, cached: 40, total: 175 }));
  await expect
    .poll(async () => header.locator('.live-metric-values strong').first().innerText(), {
      timeout: 12000,
    })
    .toBe('150');
  await expect(header.locator('.live-metric-updated').first()).toBeVisible();

  blocked = true;
  await socket!.close();
  await expect(header.locator('p.fine-print').filter({ hasText: 'Bridge offline' })).toBeVisible({
    timeout: 15000,
  });
  await expect(header.locator('.live-metric-updated')).toHaveCount(0);

  // Reconnection with the same reading is not an update.
  blocked = false;
  await expect(
    header.locator('p.fine-print').filter({ hasText: 'Last confirmed reading' }),
  ).toBeVisible({ timeout: 20000 });
  await expect(header.locator('.live-metric-updated')).toHaveCount(0);
});

test('reduced motion keeps a static cue and the panel never duplicates the live region', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const app = await harness(page);
  const header = app.header;
  await page
    .getByRole('region', { name: 'Session details', exact: true })
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const panel = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await expect(panel.locator('.live-metrics')).toBeVisible();

  app.set(metrics(2, { input: 150, output: 25, cached: 40, total: 175 }));
  await expect
    .poll(async () => header.locator('.live-metric-values strong').first().innerText(), {
      timeout: 12000,
    })
    .toBe('150');
  const updated = header.locator('.live-metric-updated').first();
  await expect(updated).toBeVisible();
  const style = await updated.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      animation: computed.animationName,
      outline: computed.outlineStyle,
      text: element.parentElement?.textContent ?? '',
    };
  });
  // No motion, but the cue stays perceivable through outline and text.
  expect(style.animation).toBe('none');
  expect(style.outline).not.toBe('none');
  expect(style.text).toContain('Confirmed value updated');

  // Exactly one announcement source, only in the header.
  await expect(page.locator('.session-detail [aria-live]')).toHaveCount(1);
  await expect(page.locator('.artifact-panel [aria-live]')).toHaveCount(0);
  const announcement = await page
    .locator('.session-detail p.sr-only[aria-live="polite"]')
    .textContent();
  expect(announcement).toContain('150');
  expect(announcement).toContain('175');
});
