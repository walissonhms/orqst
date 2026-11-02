import { test, expect } from '@playwright/test';

async function selectArtifact(page: import('@playwright/test').Page) {
  await page.goto('/#session=synthetic-browser-session');
  await expect(page.getByRole('region', { name: 'Session details' })).toBeVisible();
  const extract = page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first();
  await extract.click();
  const panel = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await expect(
    panel.getByRole('button', { name: 'Copy original Markdown', exact: true }),
  ).toBeVisible();
  return panel;
}

test('manual source, inert preview and separate memory draft stay integrated with session and accessible', async ({
  page,
  context,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const panel = await selectArtifact(page);
  await expect(panel.getByRole('heading', { name: 'Manual artifact' })).toBeFocused();
  const original = await panel.locator('pre.artifact-content').innerText();
  await expect(panel.locator('dl.artifact-provenance')).toContainText('synthetic-browser-session');
  await expect(panel.getByText(/Source was not rechecked/)).toBeVisible();
  await panel.getByRole('button', { name: 'Copy original Markdown', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('Copied to clipboard.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(original);
  await panel.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const draft =
    '# Synthetic edited draft\n- item\n```html\n<script>window.orqstInjected=true</script>\n```\n![remote](https://example.invalid/remote.png)\n[link](javascript:alert(1))\n<iframe src="file:///private/test"></iframe>';
  await panel.getByLabel('Separate draft (memory only)', { exact: true }).fill(draft);
  await panel.getByRole('button', { name: 'Draft preview', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Synthetic edited draft' })).toBeVisible();
  await expect(panel.locator('li')).toHaveText('item');
  await expect(panel.locator('code')).toContainText('<script>');
  expect(await panel.locator('a,img,iframe,script,object,embed,video,audio').count()).toBe(0);
  expect(await page.evaluate(() => Reflect.get(window, 'orqstInjected'))).toBeUndefined();
  expect(requests.some((url) => url.includes('example.invalid'))).toBe(false);
  await panel.getByRole('button', { name: 'Copy draft Markdown', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(draft);
  await panel.getByRole('button', { name: 'Copy readable draft text', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    draft.replace('# ', '').replace('- item', 'item').replace('```html\n', '').replace('\n```', ''),
  );
  await panel.getByRole('button', { name: 'Original source', exact: true }).click();
  await expect(panel.locator('pre.artifact-content')).toHaveText(original);
  await page.getByRole('button', { name: 'Latest result', exact: true }).click();
  await expect(panel).toBeVisible();
  await page.getByRole('button', { name: 'Execution timeline', exact: true }).click();
  await panel
    .getByRole('button', { name: 'Close artifact and discard draft', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Extract artifact manually', exact: true }).first(),
  ).toBeFocused();
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  await panel.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await expect(panel.getByRole('textbox')).toHaveValue(original);
});

test('clipboard failure, UTF-8 draft rejection and pt-BR controls are explicit', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('Synthetic denied clipboard');
        },
      },
    });
  });
  const panel = await selectArtifact(page);
  await panel.getByRole('button', { name: 'Copy original Markdown', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Clipboard copy failed');
  await panel.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const editor = panel.getByRole('textbox');
  const original = await editor.inputValue();
  await editor.fill('é'.repeat(16385));
  await expect(panel.getByRole('alert').filter({ hasText: 'Draft exceeds' })).toBeVisible();
  await expect(editor).toHaveValue(original);
  await page.getByLabel('Language', { exact: true }).selectOption('pt-BR');
  await expect(page.getByRole('region', { name: 'Artefato manual', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Copiar Markdown original', exact: true }),
  ).toBeVisible();
  const localizedPanel = page.getByRole('region', { name: 'Artefato manual', exact: true });
  await expect(localizedPanel.getByText(/exige o cliente ORQST Desktop/)).toBeVisible();
  await expect(localizedPanel.getByRole('button', { name: /Salvar|abrir/ })).toHaveCount(0);
});

test('expired selection and malformed response fail visibly without stale source or copy actions', async ({
  page,
}) => {
  await page.route('**/api/artifacts/extract', (route) =>
    route.fulfill({
      json: {
        availability: 'unavailable',
        reason: 'event_not_retained',
      },
    }),
  );
  await page.goto('/#session=synthetic-browser-session');
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const panel = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await expect(panel.getByRole('status')).toContainText('no longer retained');
  await expect(panel.locator('.artifact-content')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /Copy/ })).toHaveCount(0);
  await panel
    .getByRole('button', { name: 'Close artifact and discard draft', exact: true })
    .click();
  await page.unroute('**/api/artifacts/extract');
  await page.route('**/api/artifacts/extract', (route) =>
    route.fulfill({
      json: {
        availability: 'available',
        value: { unsafe: '<script>bad()</script>' },
      },
    }),
  );
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  await expect(panel.getByRole('alert')).toContainText('Unable to load');
  await expect(panel.getByRole('button', { name: /Copy/ })).toHaveCount(0);
});

test('artifact panel fits a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await selectArtifact(page);
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
