import { test, expect, type Page } from '@playwright/test';
import { sessionMetricsResultSchema, type SessionMetricsResult } from '@orqst/protocol';

// Controlled responses from the disposable synthetic Bridge; no user sessions or storage.
const sessionId = 'synthetic-browser-session';
const fixedClock = new Date('2026-11-02T12:00:00Z');

async function setup(page: Page) {
  await page.clock.install({ time: fixedClock });
  await page.clock.pauseAt(fixedClock);
  let result: SessionMetricsResult | undefined;
  let reads = 0;
  await page.route('**/api/sessions/*/metrics', async (route) => {
    result ??= sessionMetricsResultSchema.parse(await (await route.fetch()).json());
    reads++;
    await route.fulfill({ json: result });
  });
  await page.goto(`/#session=${sessionId}`);
  const header = page.locator('.session-detail > .live-metrics');
  await expect(header.locator('.live-metric-values strong')).toHaveCount(4);
  await expect(header).toHaveAttribute('aria-busy', 'false');
  const baseline = result;
  if (baseline?.availability !== 'available') throw new Error('Missing synthetic baseline');
  const refresh = async () => {
    const before = reads;
    // The existing five-second poll schedules a 250ms reconciliation debounce.
    await page.clock.runFor(5251);
    await expect.poll(() => reads).toBeGreaterThan(before);
    await expect(header).toHaveAttribute('aria-busy', 'false');
  };
  const next = () => ({
    ...baseline,
    value: {
      ...baseline.value,
      usage: {
        ...baseline.value.usage,
        output: baseline.value.usage.output + 5,
        total: baseline.value.usage.total + 5,
      },
      evidence: { ...baseline.value.evidence, sequence: baseline.value.evidence.sequence + 1 },
    },
  });
  const format = new Intl.NumberFormat('en-US');
  const expected = (['input', 'output', 'cached', 'total'] as const).map((key) =>
    format.format(next().value.usage[key]),
  );
  const changed = [expected[1]!, expected[3]!];
  return {
    header,
    baseline,
    refresh,
    next,
    expected,
    changed,
    setResult: (value: SessionMetricsResult) => {
      result = value;
    },
  };
}

test('only changed confirmed fields receive an exact-value cue that expires without replay', async ({
  page,
}) => {
  const { header, baseline, refresh, next, setResult, changed } = await setup(page);
  const cues = header.locator('.live-metric-updated');
  await expect(cues).toHaveCount(0);
  await refresh();
  await expect(cues).toHaveCount(0);

  // Same sequence with different counts cannot claim a newly confirmed update.
  setResult({ ...next(), value: { ...next().value, evidence: baseline.value.evidence } });
  await refresh();
  await expect(cues).toHaveCount(0);
  setResult(baseline);
  await refresh();

  setResult(next());
  await refresh();
  await expect(cues).toHaveText(changed);
  await expect(header.getByText('Confirmed value updated', { exact: true })).toHaveCount(2);
  await expect(header.locator('time')).toHaveAttribute(
    'datetime',
    baseline.value.evidence.occurredAt,
  );
  await expect(page.locator('.session-detail [aria-live]')).toHaveCount(1);
  await expect(header.locator('[aria-live]')).toContainText(`Output ${changed[0]}.`);
  expect(await cues.first().evaluate((node) => getComputedStyle(node).animationName)).toBe(
    'live-metric-confirmed-update',
  );
  await page.clock.runFor(1601);
  await expect(cues).toHaveCount(0);
  await refresh();
  await expect(cues).toHaveCount(0);

  // New evidence without changed counts is not a count update.
  setResult({
    ...next(),
    value: {
      ...next().value,
      evidence: { ...next().value.evidence, sequence: baseline.value.evidence.sequence + 2 },
    },
  });
  await refresh();
  await expect(cues).toHaveCount(0);
});

test('reduced motion keeps static translated cues and a newly opened artifact stays silent', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { header, refresh, next, setResult, expected } = await setup(page);
  await page.getByLabel('Language', { exact: true }).selectOption('pt-BR');
  setResult(next());
  await refresh();
  const cue = header.locator('.live-metric-updated').first();
  await expect(header.getByText('Valor confirmado atualizado', { exact: true })).toHaveCount(2);
  const style = await cue.evaluate((node) => {
    const css = getComputedStyle(node);
    const expected = document.createElement('span');
    expected.style.backgroundColor = 'color-mix(in srgb, #b45cff 12%, #141329)';
    document.body.append(expected);
    const expectedBackground = getComputedStyle(expected).backgroundColor;
    expected.remove();
    return {
      animation: css.animationName,
      outline: css.outlineStyle,
      background: css.backgroundColor,
      expectedBackground,
    };
  });
  expect(style.animation).toBe('none');
  expect(style.outline).toBe('solid');
  expect(style.background).toBe(style.expectedBackground);

  await page
    .getByRole('region', { name: 'Detalhes da sessão', exact: true })
    .getByRole('button', { name: 'Extrair artefato manualmente', exact: true })
    .first()
    .click();
  const artifact = page.locator('.artifact-panel .live-metrics');
  await expect(artifact.locator('.live-metric-values strong')).toHaveText(expected);
  await expect(artifact.locator('.live-metric-updated')).toHaveCount(0);
  await expect(artifact.locator('[aria-live]')).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await header.screenshot({
    path: test.info().outputPath('confirmed-update-reduced-motion-pt.png'),
  });
  await page.clock.runFor(1601);
  await expect(header.locator('.live-metric-updated')).toHaveCount(0);
});

test('unavailable refresh preserves confirmed counts and recovery cannot replay the cue', async ({
  page,
}) => {
  const { header, refresh, next, setResult, expected } = await setup(page);
  setResult(next());
  await refresh();
  await expect(header.locator('.live-metric-updated')).toHaveCount(2);
  setResult({ availability: 'unavailable', reason: 'identity_conflict' });
  await refresh();
  await expect(header.locator('.live-metric-updated')).toHaveCount(0);
  await expect(header.locator('.live-metric-values strong')).toHaveText(expected);
  await expect(header).toContainText('Current metrics are unavailable.');
  setResult(next());
  await refresh();
  await expect(header.locator('.live-metric-updated')).toHaveCount(0);
  await expect(header.locator('.live-metric-values strong')).toHaveText(expected);
});
