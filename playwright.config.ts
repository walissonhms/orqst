import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserBaseURL } from './tests/helpers/browser-port.js';
process.env.ORQST_BROWSER_STATE ??= join(tmpdir(), `orqst-browser-state-${randomUUID()}.json`);
export default defineConfig({
  testDir: './tests/browser',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: 'list',
  use: { baseURL: browserBaseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec tsx tests/browser/server.ts',
    url: browserBaseURL,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
