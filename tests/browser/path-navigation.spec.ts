import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '@orqst/protocol';

const sourceId = 'synthetic-browser-session';
const sessionPath = `/overview/sessions/${sourceId}`;
const draftText = 'Synthetic route draft — exact text\n<script>inert</script>';
const views = [
  ['overview', 'Overview'],
  ['workspaces', 'Workspace directory'],
  ['agents', 'Agents & integrations'],
  ['models', 'Most used models'],
  ['settings', 'Settings'],
  ['artifacts', 'Artifact library'],
] as const;

async function editDraft(page: Page) {
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const panel = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await panel.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await panel.getByRole('textbox').fill(draftText);
  return panel;
}
function dialog(page: Page) {
  return page.getByRole('dialog', { name: 'Discard artifact draft?', exact: true });
}
async function confirm(page: Page) {
  await dialog(page)
    .getByRole('button', { name: 'Discard draft and continue', exact: true })
    .click();
}

for (const [view, label] of views) {
  test(`${view} supports direct entry, reload and old hash links without a redirect history entry`, async ({
    page,
  }) => {
    await page.goto(`/${view}`);
    const link = page.getByRole('link', { name: label, exact: true });
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(link).toHaveAttribute('href', `/${view}`);
    await page.reload();
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveURL(`/${view}`);
    await page.goto(`/#${view}`);
    await expect(page).toHaveURL(`/${view}`);
    const length = await page.evaluate(() => history.length);
    const next = view === 'settings' ? 'overview' : 'settings';
    await page
      .getByRole('link', { name: next === 'settings' ? 'Settings' : 'Overview', exact: true })
      .click();
    expect(await page.evaluate(() => history.length)).toBe(length + 1);
    await page.goBack();
    await expect(page).toHaveURL(`/${view}`);
    await expect(link).toHaveAttribute('aria-current', 'page');
  });
}

test('root restores preferences, explicit routes win and SPA Back/Forward keeps the document', async ({
  page,
}) => {
  await page.goto('/settings');
  await page.getByLabel('Language', { exact: true }).selectOption('pt-BR');
  await page.goto('/');
  await expect(page).toHaveURL('/settings');
  await expect(page.getByLabel('Idioma', { exact: true })).toHaveValue('pt-BR');
  await page.goto('/agents');
  await expect(
    page.getByRole('link', { name: 'Agentes e integrações', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page.getByLabel('Idioma', { exact: true }).selectOption('en-US');
  await page.evaluate(() => Reflect.set(window, 'syntheticNavigationDocument', 'retained'));
  for (const [view, label] of views) {
    await page.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(`/${view}`);
  }
  await page.evaluate(() => history.go(-4));
  await expect(page).toHaveURL('/workspaces');
  await page.evaluate(() => history.go(2));
  await expect(page).toHaveURL('/models');
  expect(await page.evaluate(() => Reflect.get(window, 'syntheticNavigationDocument'))).toBe(
    'retained',
  );
});

test('legacy session identity waits for source evidence, survives reload and remains inert when invalid', async ({
  page,
}) => {
  let release = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/snapshot', async (route) => {
    await ready;
    await route.continue();
  });
  await page.goto(`/#session=${sourceId}`);
  await expect(page.getByRole('region', { name: 'Session details', exact: true })).toHaveCount(0);
  release();
  await expect(page).toHaveURL(sessionPath);
  await expect(page.getByRole('region', { name: 'Session details', exact: true })).toContainText(
    sourceId,
  );
  await page.reload();
  await expect(page.getByRole('region', { name: 'Session details', exact: true })).toContainText(
    sourceId,
  );
  for (const hash of ['#session=missing', '#session=%', '#session=' + 'x'.repeat(201)]) {
    await page.goto('/' + hash);
    await expect(page).toHaveURL('/overview');
    await expect(page.getByRole('region', { name: 'Session details', exact: true })).toHaveCount(0);
  }
});

test('cancelled Back and Forward preserve the exact history entries and draft, confirmation traverses once', async ({
  page,
}) => {
  await page.goto('/agents');
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page
    .getByRole('button', { name: 'View session Synthetic browser agent', exact: true })
    .click();
  let panel = await editDraft(page);
  const length = await page.evaluate(() => history.length);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate(() => history.back());
    await expect(dialog(page)).toBeVisible();
    await expect(page).toHaveURL(sessionPath);
    await page.keyboard.press('Escape');
    await expect(panel.getByRole('textbox')).toHaveValue(draftText);
  }
  await page.evaluate(() => history.back());
  await confirm(page);
  await expect(page).toHaveURL('/overview');
  await expect(page.getByRole('region', { name: 'Session details', exact: true })).toHaveCount(0);
  // Reopen the same source from the preserved forward entry, then test forward cancellation.
  await page.goForward();
  await expect(page).toHaveURL(sessionPath);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(sessionPath);
  panel = await editDraft(page);
  const withSettings = await page.evaluate(() => history.length);
  await page.evaluate(() => history.forward());
  await expect(dialog(page)).toBeVisible();
  await expect(page).toHaveURL(sessionPath);
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('textbox')).toHaveValue(draftText);
  await page.evaluate(() => history.forward());
  await confirm(page);
  await expect(page).toHaveURL('/settings');
  expect(await page.evaluate(() => history.length)).toBe(withSettings);
  expect(withSettings).toBe(length + 1);
  await page.goBack();
  await expect(page).toHaveURL(sessionPath);
  await page.goBack();
  await expect(page).toHaveURL('/overview');
  await page.goBack();
  await expect(page).toHaveURL('/agents');
});

test('view hashes on clean paths share draft confirmation and accepted session links remain reloadable', async ({
  page,
}) => {
  await page.goto(sessionPath);
  const panel = await editDraft(page);
  await page.evaluate(() => {
    location.hash = 'settings';
  });
  await expect(dialog(page)).toBeVisible();
  await expect(page).toHaveURL(sessionPath);
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('textbox')).toHaveValue(draftText);
  await page.evaluate(() => {
    location.hash = 'settings';
  });
  await confirm(page);
  await expect(page).toHaveURL('/settings');
  await page.goBack();
  await expect(page).toHaveURL(sessionPath);
  await expect(page.getByRole('region', { name: 'Session details', exact: true })).toContainText(
    sourceId,
  );
});

test('address-bar legacy session navigation and copied-index duplicate events apply once through the draft guard', async ({
  page,
}) => {
  await page.goto('/overview');
  const length = await page.evaluate(() => history.length);
  // Same-document page.goto follows Chromium's address-bar fragment navigation.
  await page.goto(`/overview#session=${sourceId}`);
  await expect(page).toHaveURL(sessionPath);
  await expect(page.getByRole('region', { name: 'Session details', exact: true })).toContainText(
    sourceId,
  );
  expect(await page.evaluate(() => history.length)).toBe(length + 1);
  const panel = await editDraft(page);
  const copyIndexAndNavigate = () =>
    page.evaluate(() => {
      // Deterministically reproduce a native fragment entry inheriting current state.
      const oldURL = location.href;
      history.pushState(history.state, '', location.pathname + '#settings');
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }));
    });
  await copyIndexAndNavigate();
  await expect(dialog(page)).toHaveCount(1);
  await expect(dialog(page)).toBeVisible();
  await expect(page).toHaveURL(sessionPath);
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('textbox')).toHaveValue(draftText);
  await copyIndexAndNavigate();
  await expect(dialog(page)).toHaveCount(1);
  await confirm(page);
  await expect(page).toHaveURL('/settings');
  await page.goBack();
  await expect(page).toHaveURL(sessionPath);
  await page.goBack();
  await expect(page).toHaveURL('/overview');
  await page.goForward();
  await expect(page).toHaveURL(sessionPath);
  await page.goForward();
  await expect(page).toHaveURL('/settings');
});

test('safe Unicode session IDs use canonical paths while unsafe historical IDs keep their exact fragment', async ({
  page,
}) => {
  const ids = ['synthetic ?# sessão', 'synthetic /#? sessão', 'synthetic%2Fid'];
  await page.route('**/api/snapshot', async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    const source = snapshot.sessions.find((session) => session.id === sourceId)!;
    snapshot.sessions.push(
      ...ids.map((id) => ({ ...source, id, agentName: 'Synthetic encoded session' })),
    );
    await route.fulfill({ response, json: snapshot });
  });
  for (const [index, id] of ids.entries()) {
    const encoded = encodeURIComponent(id);
    await page.goto('/#session=' + encoded);
    await expect(page).toHaveURL(
      index === 0 ? '/overview/sessions/' + encoded : '/overview#session=' + encoded,
    );
    await expect(page.getByRole('region', { name: 'Session details', exact: true })).toContainText(
      id,
    );
    await page.reload();
    await expect(page.getByRole('region', { name: 'Session details', exact: true })).toContainText(
      id,
    );
  }
});
