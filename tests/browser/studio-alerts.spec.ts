import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { featureNativeSnapshotSchema, type FeatureNativeRequest } from '@orqst/protocol';

const terminalId = (index: number) => `00000000-0000-4000-8000-00000000000${index}`;
const firstFeature = '10000000-0000-4000-8000-000000000001';
const secondFeature = '10000000-0000-4000-8000-000000000002';
const workspace = { id: 'synthetic-alerts', name: 'Workspace de teste' };

async function openStudio(page: Page, locale = 'pt-BR') {
  const snapshot = featureNativeSnapshotSchema.parse({
    contractVersion: 1,
    storage: 'core',
    generation: 1,
    workspace,
    activeFeatureId: firstFeature,
    features: [firstFeature, secondFeature].map((featureId, index) => ({
      schemaVersion: 1,
      workspaceId: workspace.id,
      featureId,
      name: index ? 'Integração' : 'Aplicação',
      description: '',
      status: 'active',
      revision: 1,
      terminalIds: [terminalId(index + 1)],
      createdAt: 1,
      updatedAt: 1,
    })),
    view: {
      contractVersion: 1,
      storage: 'core',
      workspaceId: workspace.id,
      featureId: firstFeature,
      revision: 1,
    },
    slots: [
      { slot: 0, terminalId: terminalId(1), provider: 'codex' },
      { slot: 1, terminalId: terminalId(2), provider: 'claude' },
    ],
    layoutSaved: true,
  });
  await page.addInitScript(
    ({ snapshot, locale }) => {
      localStorage.setItem('i18nextLng', locale);
      const calls: FeatureNativeRequest[] = [];
      Reflect.set(window, 'studioAlertRequests', calls);
      Reflect.set(window, 'orqstFeatures', {
        contractVersion: 1,
        async request(input: FeatureNativeRequest) {
          calls.push(input);
          if (input.action === 'select') {
            if (snapshot.view.revision !== input.expectedRevision) return { status: 'stale' };
            snapshot.activeFeatureId = input.featureId;
            snapshot.view.featureId = input.featureId;
            snapshot.view.revision++;
            snapshot.generation++;
          }
          if (
            input.action === 'pane' &&
            !snapshot.features
              .find((feature) => feature.featureId === snapshot.activeFeatureId)
              ?.terminalIds.includes(input.terminalId)
          )
            return { status: 'denied' };
          const state = Reflect.get(window, 'studioLimits');
          return {
            status: 'ok',
            snapshot: structuredClone(snapshot),
            ...(state ? { accountLimits: state } : {}),
          };
        },
      });
    },
    { snapshot, locale },
  );
  await page.goto('/studio');
  await expect(page.locator('.feature-core')).toHaveAttribute('data-state', 'online');
}

async function reportLimits(page: Page, usedPercent: number, ageMs = 0) {
  await page.evaluate(
    ({ usedPercent, ageMs }) => {
      const readAt = Date.now();
      const previous = Reflect.get(window, 'studioLimits')?.accounts[0]?.windows[0]?.resetsAt;
      Reflect.set(window, 'studioLimits', {
        readAt,
        accounts: [
          {
            id: 'codex-default',
            provider: 'codex',
            index: 1,
            locked: false,
            label: 'Equipe de revisão',
            updatedAt: readAt - ageMs,
            windows: [
              {
                id: 'window-300m',
                label: '5h',
                usedPercent,
                resetsAt: previous ?? readAt + 4 * 3_600_000,
              },
            ],
          },
          {
            id: 'synthetic-claude',
            provider: 'claude',
            index: 1,
            locked: false,
            windows: [],
          },
        ],
      });
    },
    { usedPercent, ageMs },
  );
}

async function ownedAlerts(page: Page) {
  await page.evaluate(
    ({ one, two }) => {
      const frame = {
        kind: 'owned-turn-alert',
        contractVersion: 1,
        epoch: '10000000-0000-4000-8000-000000000007',
        turnId: '10000000-0000-4000-8000-000000000008',
        terminalId: two,
        slot: 1,
        category: 'waiting_for_user',
        observedAt: Date.now(),
        silent: true,
      };
      for (const detail of [
        frame,
        frame,
        { ...frame, terminalId: one, slot: 0, category: 'failed' },
        { ...frame, terminalId: one, slot: 0, category: 'completed' },
        { ...frame, terminalId: one, slot: 0, category: 'token_usage' },
        { ...frame, terminalId: one, slot: 0, turnId: one, observedAt: Date.now() - 20_000 },
      ])
        window.dispatchEvent(new CustomEvent('orqst-owned-turn-alert', { detail }));
    },
    { one: terminalId(1), two: terminalId(2) },
  );
}

test('alerts deduplicate, navigate by immutable terminal ID and persist read and clear', async ({
  page,
}) => {
  await openStudio(page, 'en-US');
  await ownedAlerts(page);
  const bell = page.getByRole('button', { name: 'Notifications', exact: true });
  await expect(bell).toHaveAttribute('title', /2 unread/);
  await bell.click();
  const drawer = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(drawer.getByRole('listitem')).toHaveCount(2);
  const waiting = drawer.getByRole('button', { name: /Waiting for you T-002.*Integração/ });
  await waiting.click();
  await expect(drawer).toBeHidden();
  await expect(page.locator(`[data-pane-id="${terminalId(2)}"]`)).toBeFocused();
  const calls = await page.evaluate(
    () => Reflect.get(window, 'studioAlertRequests') as FeatureNativeRequest[],
  );
  expect(calls).toContainEqual(
    expect.objectContaining({ action: 'select', featureId: secondFeature }),
  );
  expect(calls).toContainEqual(
    expect.objectContaining({ action: 'pane', command: 'focus', terminalId: terminalId(2) }),
  );
  await expect(bell).toHaveAttribute('title', /1 unread/);
  await page.reload();
  await expect(bell).toHaveAttribute('title', /1 unread/);
  await bell.click();
  await drawer.getByRole('button', { name: 'Mark all read' }).click();
  await expect(drawer.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
  await drawer.getByRole('button', { name: 'Clear all' }).click();
  await expect(drawer.getByRole('listitem')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(bell).toBeFocused();
  await page.reload();
  await expect(bell).toHaveAttribute('title', /0 unread/);
});

test('limits use localized account fallbacks and the provider report age in English', async ({
  page,
}) => {
  await openStudio(page, 'en-US');
  await reportLimits(page, 45, 125_000);
  const chip = page.locator('.al-trigger');
  await expect(chip).toContainText('Claude');
  await expect(chip).not.toContainText('Claude Code');
  await chip.click();
  const dialog = page.getByRole('dialog', { name: 'Account limits' });
  await expect(dialog.getByText('Account 1', { exact: true })).toBeVisible();
  await expect(dialog.getByText('— no CLI data')).toHaveAttribute(
    'title',
    'No limits reported yet',
  );
  await expect(dialog.locator('time')).toHaveText('CLI · 2m ago');
});

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
] as const) {
  test(`limits and drawer at ${width} × ${height}`, async ({ page, browser }) => {
    await page.setViewportSize({ width, height });
    await openStudio(page);
    const root = `docs/development/spec-l6/${width}x${height}`;
    const capture = async (name: string) => {
      if (process.env.ORQST_CAPTURE_SPEC_L6 === '1')
        await page.screenshot({ path: `${root}/${name}.png`, animations: 'disabled' });
    };
    const chip = page.locator('.al-trigger');
    await expect(chip).toHaveText(/—/);
    await chip.click();
    const popover = page.locator('.al-panel');
    await expect(popover.getByText('— sem dados da CLI')).toHaveAttribute(
      'title',
      'Nenhum limite informado ainda',
    );
    await expect(popover.locator('time')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await capture('01-limits-unavailable');
    await reportLimits(page, 55);
    await expect(chip).toContainText(/Codex\s*55\s*%\s*· 5h/);
    await reportLimits(page, 62);
    await expect(chip).toContainText(/Codex\s*62\s*%\s*· 5h/);
    await expect(chip).toContainText(/Claude.*—/);
    await capture('02-limits-reported');
    await chip.click();
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(/renova em/i);
    const claude = popover
      .locator('.al-provider')
      .filter({ has: page.getByRole('heading', { name: 'Claude', exact: true }) });
    await expect(claude.getByText('Conta 1', { exact: true })).toBeVisible();
    await expect(claude.getByText('— sem dados da CLI')).toHaveAttribute(
      'title',
      'Nenhum limite informado ainda',
    );
    await expect(claude.getByRole('button')).toHaveCount(0);
    const codex = popover
      .locator('.al-provider')
      .filter({ has: page.getByRole('heading', { name: 'Codex', exact: true }) });
    await expect(codex.getByText('Equipe de revisão', { exact: true })).toBeVisible();
    await expect(codex.getByRole('button')).toHaveCount(1);
    const refresh = codex.getByRole('button', { name: 'Ler os limites de novo', exact: true });
    await expect(refresh).toHaveAttribute('title', 'Ler os limites de novo');
    await expect(popover.locator('time')).toHaveText('CLI · agora');
    await expect(popover.locator('time')).toHaveAttribute(
      'datetime',
      await page.evaluate(() =>
        new Date(Reflect.get(window, 'studioLimits').accounts[0].updatedAt).toISOString(),
      ),
    );
    await expect(chip).not.toContainText('Claude Code');
    await expect(popover.getByRole('button', { name: 'Escolher contas' })).toHaveCount(0);
    await expect(popover.getByRole('button', { name: 'Ajustar tetos' })).toHaveCount(0);
    await refresh.click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (Reflect.get(window, 'studioAlertRequests') as FeatureNativeRequest[]).some(
            (input) =>
              input.action === 'accountLimits' &&
              input.command === 'refresh' &&
              input.accountId === 'codex-default',
          ),
        ),
      )
      .toBe(true);
    await capture('03-limits-popover');
    await page.keyboard.press('Escape');
    await expect(chip).toBeFocused();
    await ownedAlerts(page);
    const bell = page.getByRole('button', { name: 'Notificações', exact: true });
    await bell.click();
    const drawer = page.getByRole('dialog', { name: 'Notificações', exact: true });
    await expect(drawer.getByRole('listitem')).toHaveCount(3);
    await expect(drawer.getByText('Limite de uso atingido')).toBeVisible();
    await capture('04-notifications');
    await drawer.getByRole('button', { name: 'Limpar tudo' }).click();
    await capture('05-notifications-empty');

    if (process.env.ORQST_CAPTURE_SPEC_L6 === '1') {
      const reference = await browser.newPage({ viewport: { width, height } });
      try {
        await reference.setContent(
          await readFile('docs/design/v6/source/ORQST_workspace_v6_features.html', 'utf8'),
        );
        await reference.screenshot({ path: `${root}/00-v6-reference.png`, animations: 'disabled' });
      } finally {
        await reference.close();
      }
    }
  });
}
