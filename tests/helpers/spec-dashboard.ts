import { expect, type Page } from '@playwright/test';

export const coreStatus = (page: Page) => page.locator('.shell-core').getByRole('status');

export const settingsTabs = (page: Page) => page.locator('.spec-settings-nav');

export async function openModelsTab(page: Page) {
  await page
    .locator('.spec-tabs')
    .getByRole('button', { name: /^(Models|Modelos)$/ })
    .click();
}

export async function openAppearance(page: Page) {
  if (!(await settingsTabs(page).isVisible())) {
    await page.getByRole('link', { name: /^(Settings|Configurações)$/ }).click();
  }
  await settingsTabs(page)
    .getByRole('button', { name: /^(Appearance|Aparência)$/ })
    .click();
}

export async function changeLanguage(page: Page, language: 'en-US' | 'pt-BR') {
  const previous = page.url();
  const returnToView = !(await settingsTabs(page).isVisible());
  if (returnToView) {
    await page.getByRole('link', { name: /^(Settings|Configurações)$/ }).click();
  }
  await settingsTabs(page)
    .getByRole('button', { name: /^(General|Geral)$/ })
    .click();
  await page.getByRole('combobox', { name: /^(Language|Idioma)$/ }).selectOption(language);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  if (returnToView) {
    await page.goBack();
    await expect(page).toHaveURL(previous);
  }
}

export async function openObservedSessions(page: Page) {
  const disclosure = page
    .locator('summary')
    .filter({ hasText: /^(Observed sessions|Sessões observadas)$/ });
  if (!(await disclosure.evaluate((summary) => summary.parentElement?.hasAttribute('open')))) {
    await disclosure.click();
  }
}
