import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '@orqst/protocol';

const sourceId = 'synthetic-browser-session';
const otherId = 'synthetic-navigation-session';
const draftText = 'Synthetic private draft — <script>window.orqstInjected=true</script>\n';

async function fixture(page: Page) {
  await page.route('**/api/snapshot', async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    const original = snapshot.sessions.find((session) => session.id === sourceId)!;
    const workspace = snapshot.workspaces.find((item) => item.id === original.workspaceId)!;
    snapshot.sessions.push({ ...original, id: otherId, agentName: 'Synthetic navigation agent' });
    snapshot.workspaces.push({
      ...workspace,
      id: 'synthetic-navigation-workspace',
      name: 'Synthetic navigation workspace',
      path: '/synthetic/navigation',
      sessions: 0,
    });
    snapshot.notifications = [
      {
        id: 'synthetic-navigation-alert',
        sessionId: otherId,
        type: 'agent.failed',
        timestamp: original.lastActivity,
        read: false,
      },
    ];
    await route.fulfill({ response, json: snapshot });
  });
}

async function openDraft(page: Page) {
  await fixture(page);
  await page.goto(`/#session=${sourceId}`);
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const panel = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await panel.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await panel.getByRole('textbox').fill(draftText);
  return panel;
}

function discardDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Discard artifact draft?', exact: true });
}

async function confirmNavigation(page: Page) {
  await discardDialog(page)
    .getByRole('button', { name: 'Discard draft and continue', exact: true })
    .click();
}

test('view navigation waits for confirmation; cancellation preserves exact text and source without persistence', async ({
  page,
}) => {
  let extractions = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/artifacts/extract') extractions++;
  });
  const panel = await openDraft(page);
  const provenance = await panel.locator('.artifact-provenance').innerText();
  const settings = page.getByRole('link', { name: 'Settings', exact: true });
  await settings.click();
  const dialog = discardDialog(page);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(page).toHaveURL(/#overview$/);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(settings).toBeFocused();
  await expect(panel.getByRole('textbox')).toHaveValue(draftText);
  await expect(panel.locator('.artifact-provenance')).toHaveText(provenance, {
    useInnerText: true,
  });
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain('Synthetic private draft');
  expect(extractions).toBe(1);
  expect(await page.evaluate(() => Reflect.get(window, 'orqstInjected'))).toBeUndefined();
  await settings.click();
  await confirmNavigation(page);
  await expect(page).toHaveURL(/#settings$/);
  await expect(panel).toHaveCount(0);
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  await expect(panel.locator('pre.artifact-content')).not.toContainText('Synthetic private draft');
});

test('same-view/session/workspace actions and inspector tabs keep the draft; workspace changes are guarded', async ({
  page,
}) => {
  const panel = await openDraft(page);
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.getByRole('link', { name: 'ORQST', exact: true }).click();
  await page
    .getByRole('button', { name: 'View session Synthetic browser agent', exact: true })
    .click();
  await page.locator('.sidebar').getByRole('button', { name: 'browser-test', exact: true }).click();
  await page.getByRole('button', { name: 'Latest result', exact: true }).click();
  await expect(panel.getByRole('textbox')).toHaveValue(draftText);
  await expect(discardDialog(page)).toHaveCount(0);
  const workspace = page
    .locator('.sidebar')
    .getByRole('button', { name: 'Synthetic navigation workspace', exact: true });
  await workspace.click();
  await discardDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(workspace).toBeFocused();
  await expect(panel.getByRole('textbox')).toHaveValue(draftText);
  await workspace.click();
  await confirmNavigation(page);
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.breadcrumbs')).toContainText('Synthetic navigation workspace');
  await expect(page.getByRole('region', { name: 'Session details', exact: true })).toHaveCount(0);
});

test('table session changes and notification source links share the guard and apply only the confirmed target', async ({
  page,
}) => {
  const panel = await openDraft(page);
  const other = page.getByRole('button', {
    name: 'View session Synthetic navigation agent',
    exact: true,
  });
  await other.click();
  await page.keyboard.press('Escape');
  await expect(other).toBeFocused();
  await expect(panel.getByRole('textbox')).toHaveValue(draftText);
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await page.locator('.notification-item').click();
  await expect(page.getByRole('dialog', { name: 'Notifications', exact: true })).toHaveCount(0);
  await expect(
    discardDialog(page).getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('heading', { name: 'Manual artifact', exact: true })).toBeFocused();
  await expect(panel.getByRole('textbox')).toHaveValue(draftText);
  await other.click();
  await confirmNavigation(page);
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Session details', exact: true })).toContainText(
    otherId,
  );
});

for (const query of ['Settings', 'Synthetic navigation agent', 'Synthetic navigation workspace']) {
  test(`palette target ${query} cannot bypass discard confirmation or steal its focus`, async ({
    page,
  }) => {
    const panel = await openDraft(page);
    await page.getByRole('button', { name: 'Search & commands', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Search & commands', exact: true })
      .getByRole('textbox')
      .fill(query);
    await page.keyboard.press('Enter');
    await expect(
      discardDialog(page).getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(
      panel.getByRole('heading', { name: 'Manual artifact', exact: true }),
    ).toBeFocused();
    await expect(panel.getByRole('textbox')).toHaveValue(draftText);
    await page.getByRole('button', { name: 'Search & commands', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Search & commands', exact: true })
      .getByRole('textbox')
      .fill(query);
    await page.keyboard.press('Enter');
    await confirmNavigation(page);
    await expect(panel).toHaveCount(0);
    if (query === 'Settings') await expect(page).toHaveURL(/#settings$/);
    else if (query === 'Synthetic navigation agent')
      await expect(
        page.getByRole('region', { name: 'Session details', exact: true }),
      ).toContainText(otherId);
    else await expect(page.locator('.breadcrumbs')).toContainText(query);
  });
}

test('session hashes, Back and Forward keep current context until a decision without duplicate prompts', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#agents');
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page
    .getByRole('button', { name: 'View session Synthetic browser agent', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const panel = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await panel.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await panel.getByRole('textbox').fill(draftText);
  await page.evaluate(() => history.back());
  await expect(discardDialog(page)).toBeVisible();
  await expect(page).toHaveURL(/#overview$/);
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('textbox')).toHaveValue(draftText);
  await page.evaluate(() => history.forward());
  await expect(discardDialog(page)).toHaveCount(0);
  await expect(panel.getByRole('textbox')).toHaveValue(draftText);
  await page.evaluate((id) => {
    location.hash = `session=${id}`;
  }, otherId);
  await expect(discardDialog(page)).toBeVisible();
  await expect(page).toHaveURL(/#overview$/);
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('textbox')).toHaveValue(draftText);
  await page.evaluate((id) => {
    location.hash = `session=${id}`;
  }, otherId);
  await confirmNavigation(page);
  await expect(page.getByRole('region', { name: 'Session details', exact: true })).toContainText(
    otherId,
  );
  await expect(page).toHaveURL(/#overview$/);
});

test('pending save blocks view, session and hash changes without replaying a delayed navigation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Reflect.set(window, 'orqstArtifacts', {
      contractVersion: 1,
      saveMarkdown: () =>
        new Promise((resolve) => {
          window.addEventListener(
            'synthetic-navigation-save',
            () => resolve({ status: 'cancelled' }),
            { once: true },
          );
        }),
    });
  });
  const panel = await openDraft(page);
  await panel.getByRole('button', { name: 'Save draft Markdown…', exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Finish or cancel' })).toBeVisible();
  await page
    .getByRole('button', { name: 'View session Synthetic navigation agent', exact: true })
    .click();
  await page.evaluate(() => {
    location.hash = 'agents';
  });
  await expect(page).toHaveURL(/#overview$/);
  await expect(discardDialog(page)).toHaveCount(0);
  await expect(panel.getByRole('textbox')).toHaveValue(draftText);
  await page.evaluate(() => window.dispatchEvent(new Event('synthetic-navigation-save')));
  await expect(panel.getByRole('status')).toHaveText(
    'Save cancelled. No file was created or changed.',
  );
  await expect(panel).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(discardDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
});

test('browser reload warns only while changed; cancelling preserves exact draft and restoration removes the handler', async ({
  page,
}) => {
  const panel = await openDraft(page);
  const warning = page.waitForEvent('dialog');
  await page.evaluate(() => {
    setTimeout(() => location.reload(), 0);
  });
  const dialog = await warning;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await expect(panel.getByRole('textbox')).toHaveValue(draftText);
  await panel.getByRole('button', { name: 'Restore draft from original…', exact: true }).click();
  await panel.getByRole('button', { name: 'Discard edits and restore draft', exact: true }).click();
  expect(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(discardDialog(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test('pt-BR navigation confirmation contains focus and fits 320px with maximum reading preferences', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript(() => {
    localStorage.setItem(
      'orqst.appearance.v1',
      JSON.stringify({
        contrast: 'high',
        density: 'comfortable',
        motion: 'reduced',
        textSize: 'extra-large',
        contentSize: 'extra-large',
        contentFont: 'sans',
      }),
    );
  });
  await openDraft(page);
  await page.getByLabel('Language', { exact: true }).selectOption('pt-BR');
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Descartar rascunho do artefato?', exact: true });
  const cancel = dialog.getByRole('button', { name: 'Cancelar', exact: true });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    dialog.getByRole('button', { name: 'Descartar rascunho e continuar', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(14);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath('artifact-navigation-pt-320.png') });
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('region', { name: 'Artefato manual', exact: true }).getByRole('textbox'),
  ).toHaveValue(draftText);
});

test('Desktop user agent keeps native unload policy while renderer navigation still guards edits', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: navigator.userAgent + ' ORQSTDesktop/0.1',
    });
  });
  const panel = await openDraft(page);
  expect(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(discardDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('textbox')).toHaveValue(draftText);
});
