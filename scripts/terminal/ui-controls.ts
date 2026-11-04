// Acceptance navigation only; never supplies process authority or synthetic success.
import type { Page } from '@playwright/test';

export async function openTerminalPaneMenu(page: Page): Promise<void> {
  if ((await page.locator('#pane-menu').getAttribute('open')) === null)
    await page.locator('#pane-menu-toggle').click();
}

export async function openTerminalPaneSettings(page: Page): Promise<void> {
  await openTerminalPaneMenu(page);
  if ((await page.locator('.layout-options').getAttribute('open')) === null)
    await page.locator('.layout-options > summary').click();
}
