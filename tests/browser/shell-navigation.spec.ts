import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { defaultFeatureId, featureNativeSnapshotSchema, type Snapshot } from '@orqst/protocol';

const sourceId = 'synthetic-browser-session';
const captureRoot = 'docs/development/spec-l1';
const screenSizes = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
] as const;
const approvedHtml = pathToFileURL(
  resolve('docs/design/v6/source/ORQST_workspace_v6_features.html'),
).href;

async function capture(page: Page, name: string) {
  if (process.env.ORQST_SPEC_L1_CAPTURES !== '1') return;
  const { width, height } = page.viewportSize()!;
  await page.screenshot({
    path: `${captureRoot}/${width}x${height}/${name}.png`,
    animations: 'disabled',
  });
}

async function studioFixture(page: Page) {
  const workspace = { id: 'synthetic-managed-workspace', name: 'Workspace de teste' };
  const slots = ['codex', 'claude', 'opencode', 'codex'].map((provider, slot) => ({
    slot,
    provider,
    terminalId: `00000000-0000-4000-8000-00000000001${slot}`,
  }));
  const features = ['General', 'Revisão de teste'].map((name, index) => ({
    featureId:
      index === 0 ? defaultFeatureId(workspace.id) : '00000000-0000-4000-8000-000000000003',
    workspaceId: workspace.id,
    name,
    description: '',
    status: 'active',
    revision: 1,
    terminalIds: index === 0 ? [] : slots.map((item) => item.terminalId),
    schemaVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  }));
  const snapshot = featureNativeSnapshotSchema.parse({
    contractVersion: 1,
    storage: 'core',
    generation: 1,
    workspace,
    features,
    activeFeatureId: features[0]!.featureId,
    view: {
      contractVersion: 1,
      storage: 'core',
      workspaceId: workspace.id,
      featureId: features[0]!.featureId,
      revision: 1,
    },
    slots,
    layoutSaved: true,
  });
  await page.addInitScript((snapshot) => {
    const calls: string[] = [];
    Reflect.set(window, 'syntheticFeatureCalls', calls);
    Object.defineProperty(window, 'orqstFeatures', {
      value: {
        contractVersion: 1,
        async request({ action, featureId }: { action: string; featureId?: string }) {
          calls.push(action);
          if (action === 'pane') return { status: 'ok', snapshot: structuredClone(snapshot) };
          if (action === 'snapshot') return { status: 'ok', snapshot: structuredClone(snapshot) };
          if (
            action !== 'select' ||
            !snapshot.features.some((item) => item.featureId === featureId)
          )
            return { status: 'denied' };
          snapshot.generation++;
          snapshot.activeFeatureId = snapshot.view.featureId = featureId!;
          snapshot.view.revision++;
          window.dispatchEvent(
            new CustomEvent('orqst-feature-state', { detail: structuredClone(snapshot) }),
          );
          return { status: 'ok', snapshot: structuredClone(snapshot) };
        },
      },
    });
  }, snapshot);
}

test('observer Studio shows the Desktop requirement and keeps the shared navigation', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL('/studio');
  await expect(
    page.getByText('Terminals run in the ORQST Desktop app.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.feature-workspace')).toHaveCount(0);
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL('/studio');
  await expect(page.getByRole('link', { name: 'Studio', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
});

test('managed Studio route shares the unsaved draft guard on click and history traversal', async ({
  page,
}) => {
  await studioFixture(page);
  await page.goto('/studio');
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page
    .getByRole('button', { name: 'View session Synthetic browser agent', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const editor = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await editor.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await editor.getByRole('textbox').fill('Synthetic Studio route draft');
  const review = page.getByRole('dialog', { name: 'Discard artifact draft?' });
  const studio = page.getByRole('link', { name: 'Studio', exact: true });
  await studio.click();
  await expect(review).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor.getByRole('textbox')).toHaveValue('Synthetic Studio route draft');
  await page.evaluate(() => history.go(-2));
  await expect(review).toBeVisible();
  await expect(page).toHaveURL(`/overview/sessions/${sourceId}`);
  await review.getByRole('button', { name: 'Discard draft and continue' }).click();
  await expect(page).toHaveURL('/studio');
  await expect(page.locator('.feature-workspace')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#app-sidebar')).toHaveCSS('width', '46px');
  await expect(page.getByRole('link', { name: 'Overview', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await expect(page.locator('.topbar').getByLabel('Language', { exact: true })).toHaveCount(0);
});

for (const size of screenSizes) {
  test(`shared frame and approved geometry at ${size.width}×${size.height}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize(size);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await studioFixture(page);
    await fixture(page);
    await page.goto('/configuracoes');
    await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('pt-BR');
    const sidebar = page.locator('#app-sidebar');
    const topbar = page.locator('.topbar');
    const crumb = topbar.locator('.breadcrumbs');
    await expect(sidebar).toHaveCSS('width', '155px');
    await expect(sidebar.locator('.shell-brand')).toHaveCSS('height', '44px');
    await expect(topbar).toHaveCSS('height', '45px');
    await expect(sidebar.locator('.shell-feature-row').first()).toHaveCSS('height', '31px');
    await expect(topbar.getByLabel('Idioma')).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Geral', exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    );

    await sidebar.getByRole('button', { name: 'Revisão de teste', exact: true }).click();
    await expect(page).toHaveURL('/studio');
    await expect(crumb).toContainText('Workspace de teste / Revisão de teste');
    await expect(topbar).toContainText(/ativa/i);
    await expect(page.locator('.feature-sidebar, .ts-toolbar, .feature-topbar')).toHaveCount(0);
    await expect(topbar.locator('.studio-header-actions button')).toHaveText([
      /Grade/,
      /Restaurar/,
      /Delegar/,
      /Terminal/,
      /Limites/,
    ]);
    await expect(topbar.locator('.shell-account-limits')).toHaveCSS('border-left-width', '1px');
    await expect(topbar.locator('.shell-account-limits')).toHaveAttribute('data-empty', 'true');
    await expect(sidebar.getByRole('button', { name: 'browser-test' }).locator('small')).toHaveText(
      '0',
    );
    await expect(
      sidebar.getByRole('button', { name: 'Workspace de teste' }).locator('small'),
    ).toHaveText('2');
    await expect(sidebar.locator('.feature-permissions-disclosure')).toHaveCount(0);
    await sidebar
      .getByRole('button', { name: 'Revisão de teste', exact: true })
      .click({ button: 'right' });
    const featureMenu = page.getByRole('dialog', { name: 'Opções de Revisão de teste' });
    await expect(featureMenu.getByRole('button')).toHaveText([
      'Renomear',
      'Duplicar configuração',
      'Arquivar',
      'Remover',
    ]);
    await page.keyboard.press('Escape');
    await expect(page.locator('.ts-pane')).toHaveCount(4);
    await expect(page.locator('.ts-stage')).toHaveCSS('margin-top', '4px');
    await capture(page, 'dashboard-studio');

    const reference = await context.newPage();
    await reference.setViewportSize(size);
    await reference.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await reference.goto(approvedHtml);
    await expect(reference.locator('.sidebar')).toHaveCSS('width', '155px');
    await expect(reference.locator('.top')).toHaveCSS('height', '45px');
    await expect(reference.locator('.brand')).toHaveCSS('height', '44px');
    await capture(reference, 'approved-v6');
    await reference.close();

    for (const [label, path, name] of [
      ['Visão geral', '/visao-geral', 'overview'],
      ['Comunicação', '/comunicacao', 'communication'],
      ['Métricas', '/metricas', 'metrics'],
      ['Artefatos', '/artefatos', 'artifacts'],
      ['Configurações', '/configuracoes', 'settings'],
    ] as const) {
      await sidebar.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(path);
      await expect(crumb).toContainText('Workspace de teste / Revisão de teste');
      await expect(crumb).toContainText(label);
      await expect(topbar).toHaveCSS('height', '45px');
      await expect(sidebar).toHaveCSS('width', '155px');
      await expect(page.locator('.app-shell')).toHaveCount(1);
      await expect(
        page.locator('.status-bar, .app-footer, .side-section, .side-actions, .studio-route-links'),
      ).toHaveCount(0);
      await expect(sidebar.getByText('Sem Feature', { exact: true })).toHaveCount(0);
      await expect(topbar.getByText('PT-BR', { exact: true })).toHaveCount(0);
      if (name === 'overview')
        await expect(page.getByRole('heading', { name: /^Sessões observadas/ })).toBeVisible();
      if (name === 'metrics') {
        await expect(topbar.getByRole('button', { name: 'Atualizar', exact: true })).toBeVisible();
        await expect(page.locator('.analytics-stats')).toBeVisible();
      }
      if (size.width === 1440) await capture(page, `dashboard-${name}`);
    }
    await expect(
      sidebar.getByRole('link', { name: /Agentes|Kanban|Planned|Planejado/i }),
    ).toHaveCount(0);
    await page.getByRole('link', { name: 'Agentes', exact: true }).click();
    await expect(page).toHaveURL('/configuracoes/agentes');
    await expect(sidebar.getByRole('link', { name: 'Configurações', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const bell = sidebar.getByRole('button', { name: 'Notificações', exact: true });
    await expect(bell.locator('.shell-unread')).toHaveText('1');
    await bell.click();
    await expect(page.getByRole('dialog', { name: 'Notificações' })).toBeVisible();
    await expect(page).toHaveURL('/configuracoes/agentes');
    await page.keyboard.press('Escape');
    await expect(bell).toBeFocused();

    const search = sidebar.getByRole('button', { name: 'Busca e comandos', exact: true });
    await search.focus();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog');
    await palette.getByRole('textbox').fill('@T-001 Codex');
    await expect(palette.locator('.palette-result')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/studio');
    await expect(crumb).toContainText('Revisão de teste');
    await expect
      .poll(() =>
        page.evaluate(() =>
          (Reflect.get(window, 'syntheticFeatureCalls') as string[]).filter(
            (action) => action !== 'snapshot',
          ),
        ),
      )
      .toEqual(['select', 'pane']);

    await sidebar.getByRole('link', { name: 'Visão geral', exact: true }).click();
    await search.click();
    await palette.getByRole('textbox').fill('Delegar');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/studio');
    await expect(page.getByRole('dialog', { name: 'Delegar', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  });
}

test('Core offline shows one 28px banner and Try now reconnects', async ({ page }) => {
  let refused = true;
  await page.route('**/api/bootstrap', (route) => (refused ? route.abort() : route.continue()));
  await page.goto('/visao-geral');
  const banner = page.locator('.shell-offline');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveCSS('height', '28px');
  refused = false;
  await banner.getByRole('button', { name: 'Try now' }).click();
  await expect(page.locator('.shell-core')).toContainText('CORE ONLINE');
  await expect(banner).toHaveCount(0);
});

async function fixture(page: Page) {
  await page.route('**/api/snapshot', async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    snapshot.notifications = [
      {
        id: 'synthetic-shell-alert',
        sessionId: 'synthetic-browser-session',
        type: 'agent.failed',
        timestamp: '2026-11-02T12:00:00.000Z',
        read: false,
      },
    ];
    await route.fulfill({ response, json: snapshot });
  });
}

test('workspace directory, layout, sidebar and scope restore without claiming process restoration', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#workspaces');
  await expect(
    page.getByRole('heading', { name: 'Workspace directory', exact: true }),
  ).toBeVisible();
  const card = page.locator('.workspace-card').filter({ hasText: '/synthetic/browser-test' });
  await expect(card).toContainText('Observed sessions');
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await page.getByRole('combobox', { name: 'Sort by' }).selectOption('name');
  await page.reload();
  await expect(page.locator('.workspace-list')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveValue('name');
  await expect(page.locator('#app-sidebar')).toHaveCSS('width', '155px');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
  await page.evaluate(() => history.go(-2));
  await expect(page.getByRole('heading', { name: 'Workspace directory' })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Search workspace names or paths' })
    .fill('no such synthetic workspace');
  await expect(page.locator('.workspace-card')).toHaveCount(0);
  await expect(page.getByText('No workspaces match this search.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search workspace names or paths' }).fill('');
  await card.getByRole('button', { name: 'Open sessions' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  const workspace = await page.evaluate(
    () => JSON.parse(localStorage.getItem('orqst.shell.v1')!).workspaceId as string,
  );
  expect(workspace).toBeTruthy();
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('failed');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('failed');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('orqst.shell.v1')!).workspaceId),
  ).toBe(workspace);
});

test('command palette searches observed models and sessions, navigates and restores focus with keyboard', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#models');
  await expect(page.getByRole('status').filter({ hasText: 'CORE ONLINE' })).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Search & commands', exact: true });
  await trigger.focus();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search & commands' });
  const search = dialog.getByRole('textbox');
  await expect(search).toBeFocused();
  await search.fill('synthetic-test-model');
  await expect(dialog.locator('.palette-result')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(dialog.locator('.palette-result')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Session details' })).toBeVisible();
  await expect(page.locator('.session-model')).toContainText('synthetic-test-model');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('textbox').fill('No matching synthetic session');
  await expect(dialog.getByText('No matches')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('adapter inventory is truthful, bilingual and has no execution or model selection affordance', async ({
  page,
}) => {
  await page.goto('/#agents');
  await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
  const matrix = page.getByRole('region', { name: 'Observation capability matrix' });
  await expect(
    matrix.getByRole('row', {
      name: 'Session control Unavailable Unavailable Unavailable Unavailable',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    matrix.getByRole('row', {
      name: 'Mode Observation only Not observed yet Not observed yet Observation only',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    matrix.getByRole('row', {
      name: 'External session discovery Supported Unavailable Unavailable Supported',
      exact: true,
    }),
  ).toBeVisible();
  await expect(matrix).toContainText('not a machine installation scan');
  await expect(
    page.getByRole('button', { name: /Start|Resume|Stop|Install|Authenticate/ }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'General', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('pt-BR');
  await page.getByRole('link', { name: 'Agentes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agentes', exact: true })).toBeVisible();
  await expect(
    page.getByRole('row', {
      name: 'Controle de sessão Indisponível Indisponível Indisponível Indisponível',
      exact: true,
    }),
  ).toBeVisible();
});

test('workspace and notification dialogs contain focus, close with Escape and link back to source from Analytics', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#models');
  const add = page.getByRole('button', { name: 'New Workspace', exact: true });
  await add.click();
  const form = page.getByRole('dialog', { name: 'New Workspace' });
  await expect(form.getByLabel('Workspace name')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(form.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await expect(add).toBeFocused();
  const notifications = page.getByRole('button', { name: 'Notifications', exact: true });
  await notifications.click();
  await page.keyboard.press('Escape');
  await expect(notifications).toBeFocused();
  await notifications.click();
  await page
    .getByRole('dialog', { name: 'Notifications' })
    .getByRole('button', { name: /Execution failed/ })
    .click();
  await expect(page.getByRole('region', { name: 'Session details' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
});

test('new views and dialogs fit desktop, laptop and mobile with reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [1440, 1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ['workspaces', 'agents']) {
      await page.goto(`/#${view}`);
      await expect(page.locator('.workspace-directory, .adapter-panel')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({
        path: test.info().outputPath(`orqst-${view}-${width}.png`),
        fullPage: width > 700,
      });
    }
    await page.getByRole('button', { name: 'Search & commands' }).click();
    await expect(page.getByRole('dialog', { name: 'Search & commands' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.keyboard.press('Escape');
  }
});

test('compact token disclosure reuses confirmed readings, remains visible on scroll and qualifies stale or missing values', async ({
  page,
}) => {
  let unavailable = false;
  let failed = false;
  let requests = 0;
  await page.route('**/api/sessions/synthetic-browser-session/metrics', async (route) => {
    requests++;
    if (failed) return route.fulfill({ status: 503, json: { error: 'synthetic-unavailable' } });
    if (unavailable)
      return route.fulfill({
        json: {
          availability: 'unavailable',
          reason: 'usage_not_recorded',
        },
      });
    return route.continue();
  });
  await page.goto('/#session=synthetic-browser-session');
  const badge = page.locator('.session-token-badge');
  const header = page.locator('.session-detail > .live-metrics');
  await expect(header.locator('.live-metric-values strong')).toHaveCount(4);
  const values = await header.locator('.live-metric-values strong').allTextContents();
  await expect(badge.locator('strong')).toHaveText(values[3]!);
  // The compact context adds no duplicate metrics query; only the inspector owns it.
  expect(requests).toBe(1);
  await badge.locator('summary').click();
  await expect(badge.locator('dd')).toHaveText(values.slice(0, 3));
  await expect(badge).toContainText('Cached input is included in input');
  await page.locator('#main-content').evaluate((main) => main.scrollTo(0, main.scrollHeight));
  await expect(badge.locator('summary')).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('orqst-session-sticky-context.png') });
  failed = true;
  await expect(header).toContainText('Metrics could not be refreshed');
  await expect(badge.locator('summary')).toContainText('Out of date');
  await expect(badge.locator('strong')).toHaveText(values[3]!);
  await badge.locator('summary').click();
  await page
    .locator('.session-detail')
    .getByRole('button', { name: 'Close', exact: true })
    .press('Enter');
  await expect(badge).toHaveCount(0);
  failed = false;
  unavailable = true;
  await page.goto('/#session=synthetic-browser-session');
  await expect(badge.locator('summary')).toContainText('Unavailable');
  await expect(badge.locator('strong')).toHaveText('—');
  await expect(header).toContainText('No cumulative token snapshot was recorded.');
  await page.setViewportSize({ width: 390, height: 844 });
  await badge.locator('summary').click();
  await expect(badge).toContainText('no confirmed session snapshot');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('notification filters preserve source categories without inventing alerts', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#agents');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Notifications' });
  await expect(dialog.locator('.notification-item')).toHaveCount(1);
  await expect(dialog.locator('.notification-item')).toHaveClass(/notification-agent-failed/);
  await dialog
    .getByRole('combobox', { name: 'Notification filter' })
    .selectOption('agent.completed');
  await expect(dialog.locator('.notification-item')).toHaveCount(0);
  await expect(dialog).toContainText('No notifications match this filter.');
  await dialog.getByRole('combobox', { name: 'Notification filter' }).selectOption('unread');
  await expect(dialog.locator('.notification-item')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('orqst-notifications-filtered.png') });
});
