import { test, expect, type Locator, type Page } from '@playwright/test';

// Disposable synthetic Bridge fixture (tests/browser/server.ts). No user data.
// Other specs append records to the baseline session, so expected counts are read from
// the authenticated API instead of being hardcoded: the UI must render that exact reading.
const sessionId = 'synthetic-browser-session';
const enLabels = ['Input', 'Output', 'Cached input', 'Total tokens'];
const ptLabels = ['Entrada', 'Saída', 'Entrada em cache', 'Total de tokens'];
const confirmedStatus = 'Last confirmed reading. Usage after this metric time is unknown.';

interface ApiMetrics {
  availability: 'available' | 'unavailable';
  reason?: string;
  value?: {
    usage: { input: number; output: number; cached: number; total: number };
    evidence: { occurredAt: string; sequence: number; source: { recordType: string } };
  };
}

async function readMetrics(page: Page): Promise<ApiMetrics> {
  return (await page.evaluate(async (id) => {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/metrics`);
    return (await response.json()) as unknown;
  }, sessionId)) as ApiMetrics;
}

function counts(metrics: ApiMetrics): string[] {
  const usage = metrics.value!.usage;
  return [usage.input, usage.output, usage.cached, usage.total].map((value) =>
    new Intl.NumberFormat('en-US').format(value),
  );
}

function valueNodes(section: Locator): Locator {
  return section.locator('.live-metric-values > div');
}

/** Visual status only: the sr-only announcer repeats meaningful messages. */
function visualStatus(section: Locator, text: string): Locator {
  return section.locator('p.fine-print').filter({ hasText: text });
}

function liveRegion(page: Page): Locator {
  return page.locator('.session-detail p.sr-only[aria-live="polite"]');
}

async function announcementText(page: Page): Promise<string> {
  return (await liveRegion(page).textContent())?.replace(/\s+/g, ' ').trim() ?? '';
}

/** Each count is a description-list pair: <dt>label</dt><dd><strong>value</strong></dd>. */
async function expectConfirmedValues(
  section: Locator,
  values: string[],
  labels: string[] = enLabels,
): Promise<void> {
  const entries = valueNodes(section);
  await expect(entries).toHaveCount(4);
  for (const [index, label] of labels.entries()) {
    await expect(entries.nth(index).locator('dt')).toHaveText(label);
    await expect(entries.nth(index).locator('dd strong')).toHaveText(values[index]!);
  }
}

async function openSession(page: Page): Promise<Locator> {
  await page.goto(`/#session=${sessionId}`);
  await expect(page.getByRole('region', { name: 'Session details' })).toBeVisible();
  const header = page.locator('.session-detail > .live-metrics');
  await expect(header).toBeVisible();
  return header;
}

async function openConfirmed(page: Page): Promise<{ header: Locator; metrics: ApiMetrics }> {
  const header = await openSession(page);
  const metrics = await readMetrics(page);
  // The baseline fixture always records a cumulative snapshot: a regression must fail,
  // never skip. Exact counts come from the API so suite ordering cannot mask it.
  expect(metrics.availability, `baseline metrics: ${metrics.reason ?? 'unavailable'}`).toBe(
    'available',
  );
  await expect(visualStatus(header, confirmedStatus)).toBeVisible();
  await expectConfirmedValues(header, counts(metrics));

  // Exactly one announcement source, and it carries the confirmed counts.
  const live = liveRegion(page);
  await expect(live).toHaveCount(1);
  await expect(live).toHaveAttribute('aria-live', 'polite');
  await expect(live).toHaveAttribute('aria-atomic', 'true');
  for (const value of counts(metrics)) await expect(live).toContainText(value);
  return { header, metrics };
}

test('header and artifact panel render the confirmed API reading with token time', async ({
  page,
}) => {
  const requested: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/metrics')) requested.push(request.url());
  });

  const { header, metrics } = await openConfirmed(page);
  const value = metrics.value!;
  await expect(header).toHaveAttribute('aria-label', 'Confirmed session tokens');
  await expect(header).toHaveAttribute('aria-busy', 'false');
  // Cache is a subset of input; total is input + output, never a second addition.
  expect(value.usage.total).toBe(value.usage.input + value.usage.output);
  expect(value.usage.cached).toBeLessThanOrEqual(value.usage.input);

  const time = header.locator('time');
  await expect(time).toHaveCount(1);
  await expect(time).toHaveAttribute('datetime', value.evidence.occurredAt);
  await expect(time).toHaveAttribute('title', value.evidence.occurredAt);
  await expect(time).not.toHaveText('Invalid Date');
  await expect(header).toContainText(
    'Normalized cumulative session snapshot, not artifact usage. Cached input is included in input; total = input + output.',
  );

  const provenance = header.locator('details.live-metric-provenance');
  expect(await provenance.getAttribute('open')).toBeNull();
  await provenance.locator('summary').click();
  await expect(provenance).toContainText('Compact evidence, not a retained full event.');
  await expect(provenance).toContainText(sessionId);
  await expect(provenance).toContainText(value.evidence.source.recordType);
  await expect(provenance).toContainText('Observation time is unavailable');

  // The artifact panel reuses the session reading; it never derives usage from the artifact.
  await page
    .getByRole('region', { name: 'Session details' })
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const panel = page.getByRole('region', { name: 'Manual artifact', exact: true });
  const panelMetrics = panel.locator('.live-metrics');
  await expect(panelMetrics).toBeVisible();
  await expectConfirmedValues(panelMetrics, counts(metrics));
  await expect(panelMetrics.locator('time')).toHaveAttribute('datetime', value.evidence.occurredAt);
  expect(await panelMetrics.locator('img, script, iframe, object, embed').count()).toBe(0);
  await expect(panelMetrics.locator('dl.live-metric-values')).toHaveCount(1);

  // A single announcement source per session: the duplicated panel must stay silent.
  await expect(page.locator('.session-detail [aria-live]')).toHaveCount(1);
  await expect(page.locator('.artifact-panel [aria-live]')).toHaveCount(0);

  // One query per selected session: the artifact never triggers its own metrics read.
  expect(requested.length).toBeGreaterThan(0);
  for (const url of requested)
    expect(new URL(url).pathname).toBe(`/api/sessions/${sessionId}/metrics`);
});

test('each count is a programmatically associated description-list pair', async ({ page }) => {
  const { header, metrics } = await openConfirmed(page);
  const list = header.locator('dl.live-metric-values');
  await expect(list).toHaveCount(1);
  await expect(list).toHaveAttribute('aria-label', 'Token usage');
  await expect(list).toHaveAttribute('role', 'group');
  await expect(list.locator('dt')).toHaveCount(4);
  await expect(list.locator('dd')).toHaveCount(4);
  // Ordered input, output, cached, total: never reordered or merged.
  await expectConfirmedValues(header, counts(metrics));
  // One reading per session, scoped to the session header.
  await expect(page.locator('.session-detail > .live-metrics')).toHaveCount(1);
  await expect(page.locator('.artifact-panel .live-metrics')).toHaveCount(0);
});

test('slow refresh keeps values and the prior announcement while the artifact is open', async ({
  page,
}) => {
  let slow = false;
  await page.route('**/api/sessions/*/metrics', async (route) => {
    if (slow) await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.continue().catch(() => undefined);
  });

  const { header, metrics } = await openConfirmed(page);
  const expected = counts(metrics);
  // Capture the meaningful announcement BEFORE any refresh so pending can be compared
  // against a real baseline instead of against itself.
  const announcement = await announcementText(page);
  expect(announcement.length).toBeGreaterThan(0);

  await page
    .getByRole('region', { name: 'Session details' })
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const panelMetrics = page
    .getByRole('region', { name: 'Manual artifact', exact: true })
    .locator('.live-metrics');
  await expect(panelMetrics).toBeVisible();
  await expectConfirmedValues(panelMetrics, expected);
  expect(await announcementText(page)).toBe(announcement);

  slow = true;
  // The shared snapshot poll (5s) is the only refetch trigger: no extra metrics timer.
  const loading = 'Refreshing metrics; previous readings may be out of date.';
  await expect(visualStatus(header, loading)).toBeVisible({ timeout: 12000 });
  await expect(visualStatus(panelMetrics, loading)).toBeVisible();
  await expect(header).toHaveAttribute('aria-busy', 'true');
  await expect(panelMetrics).toHaveAttribute('aria-busy', 'true');

  // Periodic polling must not re-announce: one live region, and its text is unchanged.
  await expect(page.locator('.session-detail [aria-live]')).toHaveCount(1);
  await expect(page.locator('.artifact-panel [aria-live]')).toHaveCount(0);
  const during = await announcementText(page);
  expect(during).toBe(announcement);
  expect(during).not.toContain('Refreshing metrics');

  await expectConfirmedValues(header, expected);
  await expectConfirmedValues(panelMetrics, expected);
  await expect(header.locator('time')).toHaveAttribute(
    'datetime',
    metrics.value!.evidence.occurredAt,
  );
  await expect(panelMetrics.locator('time')).toHaveAttribute(
    'datetime',
    metrics.value!.evidence.occurredAt,
  );
});

test('failed refresh keeps the last confirmed values and reports failure', async ({ page }) => {
  let failing = false;
  await page.route('**/api/sessions/*/metrics', async (route) => {
    if (failing) {
      await route.fulfill({ status: 500, json: { error: 'internal' } });
      return;
    }
    await route.continue().catch(() => undefined);
  });

  const { header, metrics } = await openConfirmed(page);
  const live = liveRegion(page);
  const before = await announcementText(page);
  failing = true;
  await expect(
    visualStatus(header, 'Metrics could not be refreshed. Previous readings are out of date.'),
  ).toBeVisible({ timeout: 12000 });
  await expect(header).toHaveAttribute('aria-busy', 'false');
  await expectConfirmedValues(header, counts(metrics));

  // A meaningful state change still reaches assistive technology.
  await expect(live).not.toHaveText(before);
  expect((await announcementText(page)).length).toBeGreaterThan(0);
});

test('unavailable metrics after a confirmed reading stay labelled stale', async ({ page }) => {
  let unavailable = false;
  await page.route('**/api/sessions/*/metrics', async (route) => {
    if (unavailable) {
      await route.fulfill({ json: { availability: 'unavailable', reason: 'identity_conflict' } });
      return;
    }
    await route.continue().catch(() => undefined);
  });

  const { header, metrics } = await openConfirmed(page);
  unavailable = true;
  await expect(
    visualStatus(header, 'Current metrics are unavailable. Previous readings are out of date.'),
  ).toBeVisible({ timeout: 12000 });
  await expect(
    visualStatus(header, 'Metrics evidence conflicts with the observed session identity.'),
  ).toBeVisible();
  await expectConfirmedValues(header, counts(metrics));
});

test('an out-of-order response is rejected instead of replacing the newer reading', async ({
  page,
}) => {
  let older = false;
  await page.route('**/api/sessions/*/metrics', async (route) => {
    if (!older) {
      await route.continue().catch(() => undefined);
      return;
    }
    const response = await route.fetch();
    const body = (await response.json()) as {
      availability: string;
      value?: { evidence: { sequence: number; occurredAt: string } };
    };
    if (body.availability === 'available' && body.value) {
      body.value.evidence.sequence = 1;
      body.value.evidence.occurredAt = '2020-01-01T00:00:00.000Z';
    }
    await route.fulfill({ response, json: body });
  });

  const { header, metrics } = await openConfirmed(page);
  older = true;
  await expect(
    visualStatus(header, 'Metrics could not be refreshed. Previous readings are out of date.'),
  ).toBeVisible({ timeout: 12000 });
  await expect(header.locator('time')).toHaveAttribute(
    'datetime',
    metrics.value!.evidence.occurredAt,
  );
  await expectConfirmedValues(header, counts(metrics));
});

test('offline keeps the last reading and reconnection restores the confirmed state', async ({
  page,
}) => {
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

  const { header, metrics } = await openConfirmed(page);
  const expected = counts(metrics);

  // The Bridge stays reachable over HTTP; only the live stream drops. The last confirmed
  // reading must stay visible and must stop claiming to be live.
  blocked = true;
  await socket!.close();
  await expect(
    visualStatus(header, 'Bridge offline or reconnecting. Previous readings are out of date.'),
  ).toBeVisible({ timeout: 15000 });
  await expect(header).toHaveAttribute('aria-busy', 'false');
  await expectConfirmedValues(header, expected);

  blocked = false;
  await expect(visualStatus(header, confirmedStatus)).toBeVisible({ timeout: 20000 });
  await expectConfirmedValues(header, expected);
});

test('pt-BR translation and narrow layout keep the reading accessible', async ({ page }) => {
  const { header, metrics } = await openConfirmed(page);
  const expected = counts(metrics);

  await page.getByLabel('Language', { exact: true }).selectOption('pt-BR');
  await expect(header.locator('p.eyebrow')).toHaveText('Tokens confirmados da sessão');
  await expect(
    visualStatus(
      header,
      'Última leitura confirmada. O consumo após o horário da métrica é desconhecido.',
    ),
  ).toBeVisible();
  await expectConfirmedValues(header, expected, ptLabels);
  await expect(header).toContainText('Horário da última métrica confirmada:');
  await expect(header).toContainText('Cache já integra a entrada');

  await page.setViewportSize({ width: 360, height: 800 });
  await expectConfirmedValues(header, expected, ptLabels);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motion = await header.evaluate((element) => {
    const style = getComputedStyle(element);
    return { animation: style.animationName, transition: style.transitionDuration };
  });
  expect(motion.animation).toBe('none');
  expect(motion.transition).toBe('0s');

  await page.getByLabel('Idioma', { exact: true }).selectOption('en-US');
  await expect(visualStatus(header, confirmedStatus)).toBeVisible();
});
