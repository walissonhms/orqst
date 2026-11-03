import { expect, test, type Page } from '@playwright/test';

async function openArtifact(page: Page) {
  await page.goto('/#session=synthetic-browser-session');
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const panel = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await expect(panel.locator('pre.artifact-content')).toBeVisible();
  return panel;
}

test('draft comparison and confirmed restoration preserve the retained original without another extraction', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  let extractions = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/artifacts/extract') extractions++;
  });
  const panel = await openArtifact(page);
  const original = await panel.locator('pre.artifact-content').innerText();
  const provenance = await panel.locator('dl.artifact-provenance').innerText();
  const restore = panel.getByRole('button', { name: 'Restore draft from original…', exact: true });
  const confirm = panel.getByRole('button', {
    name: 'Discard edits and restore draft',
    exact: true,
  });
  await expect(
    panel.getByText('The draft matches the retained original.', { exact: false }),
  ).toBeVisible();
  await expect(restore).toBeDisabled();
  await panel.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const draft = '# Synthetic replacement draft\n<script>window.orqstInjected=true</script>\n';
  await panel.getByRole('textbox').fill(draft);
  await expect(
    panel.getByText('The draft differs from the retained original.', { exact: false }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Original source', exact: true }).click();
  await expect(panel.locator('pre.artifact-content')).toHaveText(original);
  await restore.click();
  await expect(panel.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(restore).toBeFocused();
  await expect(confirm).toHaveCount(0);
  await panel.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await expect(panel.getByRole('textbox')).toHaveValue(draft);
  // Rejected oversized text leaves the previous changed draft intact.
  await panel.getByRole('textbox').fill('é'.repeat(16385));
  await expect(panel.getByRole('alert')).toContainText('Draft exceeds');
  await expect(panel.getByRole('textbox')).toHaveValue(draft);
  await panel.getByRole('button', { name: 'Copy draft Markdown', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('Copied to clipboard.');
  await restore.click();
  await expect(panel.getByRole('textbox')).toBeDisabled();
  await confirm.click();
  await expect(panel.getByRole('button', { name: 'Edit draft', exact: true })).toBeFocused();
  await expect(panel.getByRole('textbox')).toHaveValue(original);
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.getByRole('status')).toHaveCount(0);
  await expect(restore).toBeDisabled();
  await expect(
    panel.getByText('The draft matches the retained original.', { exact: false }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Copy draft Markdown', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(original);
  await panel.getByRole('button', { name: 'Original source', exact: true }).click();
  await expect(panel.locator('pre.artifact-content')).toHaveText(original);
  await expect(panel.locator('dl.artifact-provenance')).toHaveText(provenance, {
    useInnerText: true,
  });
  expect(extractions).toBe(1);
  expect(await page.evaluate(() => Reflect.get(window, 'orqstInjected'))).toBeUndefined();
});

test('literal comparison, pt-BR restoration and Escape cancellation work by keyboard at mobile width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await openArtifact(page);
  const original = await panel.locator('pre.artifact-content').innerText();
  await page.getByLabel('Language', { exact: true }).selectOption('pt-BR');
  const localized = page.getByRole('region', { name: 'Artefato manual', exact: true });
  await localized.getByRole('button', { name: 'Editar rascunho', exact: true }).click();
  const editor = localized.getByRole('textbox');
  const restore = localized.getByRole('button', {
    name: 'Restaurar rascunho a partir do original…',
    exact: true,
  });
  await editor.fill(`${original} `);
  await expect(restore).toBeEnabled();
  await editor.fill(original);
  await expect(restore).toBeDisabled();
  await editor.fill('');
  await expect(
    localized.getByText('O rascunho difere do original retido.', { exact: false }),
  ).toBeVisible();
  await restore.focus();
  await page.keyboard.press('Enter');
  await expect(localized.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await expect(restore).toBeFocused();
  await expect(editor).toHaveValue('');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(
    localized.getByRole('button', { name: 'Descartar edições e restaurar rascunho', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(editor).toHaveValue(original);
  await expect(restore).toBeDisabled();
  await expect(
    localized.getByText('O rascunho corresponde ao original retido.', { exact: false }),
  ).toBeVisible();
  await expect(localized).not.toContainText('artifacts.restore');
});

test('restoration and native saving exclude each other; comparison never claims file save state', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Reflect.set(window, 'syntheticSaveCalls', 0);
    Reflect.set(window, 'orqstArtifacts', {
      contractVersion: 1,
      saveMarkdown: (request: unknown) => {
        Reflect.set(
          window,
          'syntheticSaveCalls',
          Number(Reflect.get(window, 'syntheticSaveCalls')) + 1,
        );
        Reflect.set(window, 'syntheticSaveRequest', request);
        return new Promise((resolve) => {
          window.addEventListener('synthetic-save-complete', () => resolve({ status: 'saved' }), {
            once: true,
          });
        });
      },
    });
  });
  const panel = await openArtifact(page);
  const original = await panel.locator('pre.artifact-content').innerText();
  await panel.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await panel.getByRole('textbox').fill('Synthetic draft to save');
  const restore = panel.getByRole('button', { name: 'Restore draft from original…', exact: true });
  const save = panel.getByRole('button', { name: 'Save draft Markdown…', exact: true });
  await save.click();
  await expect(restore).toBeDisabled();
  await expect(panel.getByRole('textbox')).toBeDisabled();
  const request = await page.evaluate(() => Reflect.get(window, 'syntheticSaveRequest'));
  expect(request).toMatchObject({
    contractVersion: 1,
    representation: 'draft',
    draft: 'Synthetic draft to save',
    openAfterSave: false,
  });
  await page.evaluate(() => window.dispatchEvent(new Event('synthetic-save-complete')));
  await expect(panel.getByRole('status')).toHaveText('Markdown file saved.');
  await expect(
    panel.getByText('The draft differs from the retained original.', { exact: false }),
  ).toBeVisible();
  await restore.click();
  await expect(save).toBeDisabled();
  await expect(
    panel.getByRole('button', { name: 'Save draft and open in default app…', exact: true }),
  ).toBeDisabled();
  await panel.getByRole('button', { name: 'Discard edits and restore draft', exact: true }).click();
  await expect(panel.getByRole('textbox')).toHaveValue(original);
  await expect(panel.getByRole('status')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, 'syntheticSaveCalls'))).toBe(1);
});

for (const outcome of ['resolve', 'reject'] as const) {
  test(`a late clipboard ${outcome} cannot report an obsolete draft after restoration`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: () =>
            new Promise((resolve, reject) => {
              window.addEventListener('synthetic-clipboard-resolve', () => resolve(undefined), {
                once: true,
              });
              window.addEventListener(
                'synthetic-clipboard-reject',
                () => reject(new Error('Synthetic denied copy')),
                { once: true },
              );
            }),
        },
      });
    });
    const panel = await openArtifact(page);
    await panel.getByRole('button', { name: 'Edit draft', exact: true }).click();
    await panel.getByRole('textbox').fill('Synthetic pending copy');
    await panel.getByRole('button', { name: 'Copy draft Markdown', exact: true }).click();
    await panel.getByRole('button', { name: 'Restore draft from original…', exact: true }).click();
    await panel
      .getByRole('button', { name: 'Discard edits and restore draft', exact: true })
      .click();
    await page.evaluate(
      (event) => window.dispatchEvent(new Event(event)),
      `synthetic-clipboard-${outcome}`,
    );
    await expect(panel.getByRole('status')).toHaveCount(0);
    await expect(panel.getByRole('alert')).toHaveCount(0);
    // A new user gesture still reports its own result.
    await panel.getByRole('button', { name: 'Copy draft Markdown', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('synthetic-clipboard-resolve')));
    await expect(panel.getByRole('status')).toHaveText('Copied to clipboard.');
  });
}
