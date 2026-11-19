import { expect, test } from '@playwright/test';
import { changeLanguage, openObservedSessions } from '../helpers/spec-dashboard.js';

test('opening and dismissing route search preserves the exact active artifact draft and its navigation guard', async ({
  page,
}) => {
  const draft = 'Synthetic overview draft <script>window.orqstInjected=true</script>\n';
  await page.goto('/overview/sessions/synthetic-browser-session');
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const artifact = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await artifact.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await artifact.getByRole('textbox').fill(draft);
  await artifact.locator('.spec-artifact-source > summary').click();
  const provenance = await artifact.locator('.artifact-provenance').innerText();
  const search = page.getByRole('button', { name: 'Search & commands', exact: true });
  await search.click();
  await expect(
    page.getByRole('dialog', { name: 'Search & commands' }).getByRole('textbox'),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await expect(artifact.getByRole('textbox')).toHaveValue(draft);
  await expect(artifact.locator('.artifact-provenance')).toHaveText(provenance, {
    useInnerText: true,
  });
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Discard artifact draft?', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(artifact.getByRole('textbox')).toHaveValue(draft);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain(draft);
  expect(await page.evaluate(() => Reflect.get(window, 'orqstInjected'))).toBeUndefined();
});

test('the fixed Overview preserves observed evidence at maximum reading sizes in both languages', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    // Old layout preferences must not hide the specification's fixed sections.
    localStorage.setItem(
      'orqst.overview.v1',
      JSON.stringify({ hidden: ['activity', 'attention', 'diagnostics', 'usage'] }),
    );
    localStorage.setItem(
      'orqst.appearance.v1',
      JSON.stringify({
        theme: 'light',
        contrast: 'high',
        density: 'comfortable',
        motion: 'reduced',
        textSize: 'extra-large',
        contentSize: 'extra-large',
        contentFont: 'sans',
      }),
    );
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/visao-geral');
  for (const width of [1440, 1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const localized = width < 700;
    await changeLanguage(page, localized ? 'pt-BR' : 'en-US');
    await expect(page.locator('.spec-counters dd')).toHaveText(Array(5).fill('—'));
    await expect(page.locator('main h2')).toHaveCount(3);
    const observed = page
      .locator('summary')
      .filter({ hasText: /^(Observed sessions|Sessões observadas)$/ });
    await expect(observed).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Synthetic browser agent', exact: true }),
    ).toHaveCount(0);
    await openObservedSessions(page);
    await expect(
      page.getByRole('link', { name: 'Synthetic browser agent', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({ path: testInfo.outputPath(`overview-${width}.png`), fullPage: true });
    await observed.click();
  }
});
